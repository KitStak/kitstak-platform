/**
 * One-off WMS identity migration (BLUEPRINT.md §1.4 / §2.4, Phase 4).
 *
 * For every `wms.users` row:
 *   - upsert `core."user"` by email — the WMS id (a uuid stored as text) is KEPT as the
 *     core user id, so every wms.* FK and `SessionUser.id` stays valid;
 *   - insert a `core.account` credential row (`provider_id='credential'`) carrying the
 *     bcrypt `password_hash` VERBATIM — the shared passwordCompat verifier accepts
 *     `$2a$/$2b$/$2y$` hashes, so nobody's password changes. ONLY for ACTIVE users
 *     (auth review 2026-11-11, round 2 NEW-1): an `is_active = false` row gets NO
 *     credential, and any existing credential row for that user is DELETED — otherwise
 *     the migration would hand every deactivated WMS user a working password on every
 *     instance (CRM included, which has no is_active gate). The core user / member /
 *     wms.user_profiles rows ARE still created so reactivation (admin password reset)
 *     works without re-running the migration;
 *   - insert a `core.member` row in the platform organization (slug `kitstak`,
 *     created from wms.company_settings.display_name when absent), role mapped
 *     admin→member, manager→member, operator→member, viewer→viewer — a WMS admin is a
 *     warehouse admin, NOT a platform org admin (auth review 2026-11-11, H3: org admin
 *     grants Better Auth member-management powers on every app). Only an explicitly
 *     chosen platform owner is ever given org owner/admin, manually;
 *   - insert `wms.user_profiles` (legacy_role, user_type, is_api_user, all_clients,
 *     preferences + preserved first/last name, password_changed_at, last_login_at).
 *
 * `wms.user_sessions` and `wms.password_reset_tokens` are cleared (everyone signs in
 * again once; invite/reset links are re-issued). If a core user ALREADY exists under the
 * same email with a DIFFERENT id (a CRM account), the row is reported for manual
 * reconciliation and skipped — silently rebinding would break wms.* FKs.
 *
 * Run with: pnpm --filter @kitstak/db migrate:wms-identity [connection-string]
 * Connection: first positional arg, else DIRECT_URL, else DATABASE_URL. Idempotent:
 * re-running updates in place and never duplicates accounts/members/profiles.
 *
 * Escape hatch (default OFF): `--include-inactive-credentials` migrates credential rows
 * for inactive users too, restoring the pre-review behaviour. Use it ONLY when a
 * downstream system intentionally verifies inactive users' passwords and you accept
 * that a deactivated user can sign in on instances without an is_active gate.
 */
import postgres from 'postgres';

const ORG_SLUG = 'kitstak';

type Sql = postgres.Sql;

interface WmsUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly password_hash: string;
  readonly role: 'admin' | 'manager' | 'operator' | 'viewer';
  readonly user_type: string;
  readonly is_api_user: boolean;
  readonly all_clients: boolean;
  readonly is_active: boolean;
  readonly preferences: Record<string, unknown> | null;
  readonly password_changed_at: string | null;
  readonly last_login_at: string | null;
  readonly created_at: string;
}

/** H3: WMS admin → org MEMBER (never org admin); see the header comment. */
function orgRole(role: WmsUser['role']): 'member' | 'viewer' {
  return role === 'viewer' ? 'viewer' : 'member';
}

interface CliOptions {
  readonly connection: string;
  /** NEW-1 escape hatch, default off: also migrate credentials of inactive users. */
  readonly includeInactiveCredentials: boolean;
}

function cliOptions(argv: readonly string[] = process.argv.slice(2)): CliOptions {
  const flags = argv.filter((arg) => arg.startsWith('--'));
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const unknown = flags.filter((flag) => flag !== '--include-inactive-credentials');
  if (unknown.length > 0) throw new Error(`Unknown flag(s): ${unknown.join(', ')}`);
  const url = positional[0] ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('Pass a connection string, or set DIRECT_URL / DATABASE_URL.');
  }
  return {
    connection: url.trim(),
    includeInactiveCredentials: flags.includes('--include-inactive-credentials'),
  };
}

async function ensurePlatformOrg(sql: Sql): Promise<string> {
  const existing = await sql<{ id: string }[]>`
    SELECT id FROM core.organization WHERE slug = ${ORG_SLUG} LIMIT 1`;
  if (existing[0]) return existing[0].id;
  const company = await sql<{ display_name: string }[]>`
    SELECT display_name FROM wms.company_settings LIMIT 1`;
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO core.organization (id, name, slug, created_at)
    VALUES (gen_random_uuid(), ${company[0]?.display_name ?? 'KitStak'}, ${ORG_SLUG}, now())
    ON CONFLICT (slug) DO NOTHING
    RETURNING id`;
  if (inserted[0]) return inserted[0].id;
  const raced = await sql<{ id: string }[]>`
    SELECT id FROM core.organization WHERE slug = ${ORG_SLUG} LIMIT 1`;
  if (!raced[0]) throw new Error('Could not create the platform organization');
  return raced[0].id;
}

async function migrateUser(
  sql: Sql,
  orgId: string,
  user: WmsUser,
  includeInactiveCredentials: boolean,
): Promise<'migrated' | 'email_conflict'> {
  const email = user.email.trim().toLowerCase();
  const clash = await sql<{ id: string }[]>`
    SELECT id FROM core."user" WHERE email = ${email} LIMIT 1`;
  if (clash[0] && clash[0].id !== user.id) return 'email_conflict';

  await sql`
    INSERT INTO core."user" (id, name, email, email_verified, created_at, updated_at)
    VALUES (${user.id}::uuid, ${user.name}, ${email}, true, ${user.created_at}::timestamptz, now())
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, updated_at = now()`;

  // NEW-1: an inactive user is migrated WITHOUT a credential (and any credential row a
  // previous run inserted is removed), so password sign-in stays dead on every instance
  // (H3 model: no credential row = no sign-in; reactivation goes through an admin
  // password reset). `--include-inactive-credentials` restores the old behaviour.
  if (user.is_active || includeInactiveCredentials) {
    const account = await sql<{ id: string }[]>`
      SELECT id FROM core.account
      WHERE user_id = ${user.id}::uuid AND provider_id = 'credential' LIMIT 1`;
    if (account[0]) {
      await sql`
        UPDATE core.account SET password = ${user.password_hash}, updated_at = now()
        WHERE id = ${account[0].id}::uuid`;
    } else {
      await sql`
        INSERT INTO core.account (id, account_id, provider_id, user_id, password, created_at, updated_at)
        VALUES (gen_random_uuid(), ${user.id}, 'credential', ${user.id}::uuid, ${user.password_hash}, now(), now())`;
    }
  } else {
    await sql`
      DELETE FROM core.account
      WHERE user_id = ${user.id}::uuid AND provider_id = 'credential'`;
  }

  const membership = await sql<{ id: string }[]>`
    SELECT id FROM core.member
    WHERE organization_id = ${orgId}::uuid AND user_id = ${user.id}::uuid LIMIT 1`;
  if (membership[0]) {
    await sql`UPDATE core.member SET role = ${orgRole(user.role)} WHERE id = ${membership[0].id}::uuid`;
  } else {
    await sql`
      INSERT INTO core.member (id, organization_id, user_id, role, created_at)
      VALUES (gen_random_uuid(), ${orgId}::uuid, ${user.id}::uuid, ${orgRole(user.role)}, now())`;
  }

  const preferences = {
    ...(user.preferences ?? {}),
    ...(user.first_name ? { firstName: user.first_name } : {}),
    ...(user.last_name ? { lastName: user.last_name } : {}),
  };
  await sql`
    INSERT INTO wms.user_profiles
      (user_id, legacy_role, user_type, is_api_user, all_clients, preferences,
       password_changed_at, last_login_at)
    VALUES
      (${user.id}::uuid, ${user.role}, ${user.user_type}, ${user.is_api_user},
       ${user.all_clients}, ${sql.json(preferences)},
       ${user.password_changed_at}::timestamptz, ${user.last_login_at}::timestamptz)
    ON CONFLICT (user_id) DO UPDATE SET
      legacy_role = EXCLUDED.legacy_role,
      user_type = EXCLUDED.user_type,
      is_api_user = EXCLUDED.is_api_user,
      all_clients = EXCLUDED.all_clients,
      preferences = EXCLUDED.preferences,
      password_changed_at = EXCLUDED.password_changed_at,
      last_login_at = EXCLUDED.last_login_at`;
  return 'migrated';
}

async function main(): Promise<void> {
  const options = cliOptions();
  const sql = postgres(options.connection, { prepare: false, max: 1, onnotice: () => {} });
  const out = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };
  try {
    const required = ['core."user"', 'core.account', 'core.member', 'wms.user_profiles', 'wms.users'];
    for (const table of required) {
      const [row] = await sql<{ ok: boolean }[]>`SELECT to_regclass(${table}) IS NOT NULL AS ok`;
      if (!row?.ok) throw new Error(`${table} does not exist — run the app migrations first.`);
    }

    await sql.begin(async (tx) => {
      const orgId = await ensurePlatformOrg(tx as unknown as Sql);
      const users = await tx<WmsUser[]>`SELECT * FROM wms.users ORDER BY created_at`;
      const conflicts: string[] = [];
      let migrated = 0;
      let inactiveWithoutCredential = 0;
      for (const user of users) {
        const result = await migrateUser(
          tx as unknown as Sql,
          orgId,
          user,
          options.includeInactiveCredentials,
        );
        if (result === 'email_conflict') conflicts.push(user.email);
        else {
          migrated += 1;
          if (!user.is_active && !options.includeInactiveCredentials) inactiveWithoutCredential += 1;
        }
      }
      // Legacy session/reset machinery is retired (§1.4): everyone re-authenticates once.
      await tx`DELETE FROM wms.user_sessions`;
      await tx`DELETE FROM wms.password_reset_tokens`;
      out(`migrate-wms-identity: ${migrated}/${users.length} users migrated into core (org ${orgId})`);
      if (inactiveWithoutCredential > 0) {
        out(
          `${inactiveWithoutCredential} inactive user(s) migrated WITHOUT a credential (NEW-1): ` +
            'reactivate via admin password reset, or re-run with --include-inactive-credentials.',
        );
      }
      if (conflicts.length > 0) {
        out(
          `WARNING: ${conflicts.length} email(s) already belong to a core user with a different id ` +
            `(CRM account). Reconcile manually, then re-run: ${conflicts.join(', ')}`,
        );
      }
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`migrate-wms-identity failed: ${message}\n`);
  process.exitCode = 1;
});
