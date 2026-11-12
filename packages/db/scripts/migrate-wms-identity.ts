/**
 * One-off WMS identity migration (BLUEPRINT.md §1.4 / §2.4, Phase 4).
 *
 * For every `wms.users` row:
 *   - upsert `core."user"` by email — the WMS id (a uuid stored as text) is KEPT as the
 *     core user id, so every wms.* FK and `SessionUser.id` stays valid;
 *   - insert a `core.account` credential row (`provider_id='credential'`) carrying the
 *     bcrypt `password_hash` VERBATIM — the shared passwordCompat verifier accepts
 *     `$2a$/$2b$/$2y$` hashes, so nobody's password changes;
 *   - insert a `core.member` row in the platform organization (slug `kitstak`,
 *     created from wms.company_settings.display_name when absent), role mapped
 *     admin→admin, manager→member, operator→member, viewer→viewer;
 *   - insert `wms.user_profiles` (legacy_role, user_type, is_api_user, all_clients,
 *     preferences + preserved first/last name, password_changed_at, last_login_at).
 *
 * `wms.user_sessions` and `wms.password_reset_tokens` are cleared (everyone signs in
 * again once; invite/reset links are re-issued). If a core user ALREADY exists under the
 * same email with a DIFFERENT id (a CRM account), the row is reported for manual
 * reconciliation and skipped — silently rebinding would break wms.* FKs.
 *
 * Run with: pnpm --filter @kitstak/db migrate:wms-identity [connection-string]
 * Connection: argv[2], else DIRECT_URL, else DATABASE_URL. Idempotent: re-running
 * updates in place and never duplicates accounts/members/profiles.
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

function orgRole(role: WmsUser['role']): 'admin' | 'member' | 'viewer' {
  if (role === 'admin') return 'admin';
  if (role === 'viewer') return 'viewer';
  return 'member';
}

function connectionString(): string {
  const url = process.argv[2] ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('Pass a connection string, or set DIRECT_URL / DATABASE_URL.');
  }
  return url.trim();
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
): Promise<'migrated' | 'email_conflict'> {
  const email = user.email.trim().toLowerCase();
  const clash = await sql<{ id: string }[]>`
    SELECT id FROM core."user" WHERE email = ${email} LIMIT 1`;
  if (clash[0] && clash[0].id !== user.id) return 'email_conflict';

  await sql`
    INSERT INTO core."user" (id, name, email, email_verified, created_at, updated_at)
    VALUES (${user.id}::uuid, ${user.name}, ${email}, true, ${user.created_at}::timestamptz, now())
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, updated_at = now()`;

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
  const sql = postgres(connectionString(), { prepare: false, max: 1, onnotice: () => {} });
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
      for (const user of users) {
        const result = await migrateUser(tx as unknown as Sql, orgId, user);
        if (result === 'email_conflict') conflicts.push(user.email);
        else migrated += 1;
      }
      // Legacy session/reset machinery is retired (§1.4): everyone re-authenticates once.
      await tx`DELETE FROM wms.user_sessions`;
      await tx`DELETE FROM wms.password_reset_tokens`;
      out(`migrate-wms-identity: ${migrated}/${users.length} users migrated into core (org ${orgId})`);
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
