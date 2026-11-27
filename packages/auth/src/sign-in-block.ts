/**
 * "Switched off" as a fact the shared sign in layer reads (billing review round 4, security).
 *
 * Before: a person was switched off by deleting their password row in `core.account` (auth review
 * 2026-11-11, H3). That rule broke the day a person could get a new password by email: "Forgot
 * password" made a new password row and the person was back in, with their old role. It also meant
 * two things at once, because a person who signs in with an emailed code has no password row and is
 * not switched off.
 *
 * Now: one row in `core.sign_in_blocks` means switched off. `createAuth` mounts the two halves of
 * the rule on EVERY instance (Portal, CRM, WMS, Projects, Pulse), so no app can leave a door open:
 *
 *  1. Hard stops in the database hooks. No session row and no account row (password, Google,
 *     Microsoft) is ever created for a switched off person, whichever endpoint tried. This is what
 *     makes the rule hold for doors nobody thought of.
 *  2. Neutral answers in front of the doors that take an email address. A switched off person who
 *     asks for a reset code, a sign in code or a sign in gets the same answer as an address with
 *     no account, and no email is sent.
 *
 * The WMS writes the row when it deactivates a person (`blockSignIn`) and removes it when it
 * activates them again (`unblockSignIn`).
 */
import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { sql } from 'drizzle-orm';
import {
  INVALID_CREDENTIALS_CODE,
  INVALID_CREDENTIALS_MESSAGE,
  type RawSqlExecutor,
} from './password-policy-plugin';
import { burnDummyPasswordVerify } from './timing';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rows of a raw query, whichever driver ran it (node-postgres and PGlite: `{ rows }`, postgres-js: an array). */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

/** True for "relation does not exist": a database that has no such table has no rows in it. */
function isMissingTable(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    if ((current as { code?: unknown }).code === '42P01') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Runs a read against a table from migration 0011. A database that does not have the table yet
 * (a product test database, or the minutes between a deploy and its migration) holds no rows, so
 * the read answers with none. Every other failure is thrown: the caller then refuses.
 */
export async function readOrEmpty<T>(db: RawSqlExecutor, query: ReturnType<typeof sql>): Promise<T[]> {
  try {
    return rowsOf<T>(await db.execute(query));
  } catch (error: unknown) {
    if (isMissingTable(error)) return [];
    throw error;
  }
}

/** True when this person is switched off. An id that is not an id is nobody, so not blocked. */
export async function isSignInBlocked(db: RawSqlExecutor, userId: string | null | undefined): Promise<boolean> {
  if (!userId || !UUID_SHAPE.test(userId)) return false;
  const rows = await readOrEmpty<{ blocked: number }>(
    db,
    sql`SELECT 1 AS blocked FROM core.sign_in_blocks WHERE user_id = CAST(${userId} AS uuid) LIMIT 1`,
  );
  return rows.length > 0;
}

/** True when the account with this address is switched off. An address with no account is not. */
export async function isSignInBlockedForEmail(db: RawSqlExecutor, email: string | null | undefined): Promise<boolean> {
  const address = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (address === '') return false;
  const rows = await readOrEmpty<{ blocked: number }>(
    db,
    sql`SELECT 1 AS blocked
          FROM core.sign_in_blocks b
          JOIN core."user" u ON u.id = b.user_id
         WHERE lower(u.email) = ${address}
         LIMIT 1`,
  );
  return rows.length > 0;
}

/**
 * Switches a person off: writes the block row and ends every session they have, in every app. Safe
 * to call twice. Run it inside the caller's transaction when there is one (pass the transaction
 * handle), so the block and the caller's own change land together.
 */
export async function blockSignIn(
  db: RawSqlExecutor,
  input: { readonly userId: string; readonly blockedBy?: string | null; readonly reason?: string },
): Promise<void> {
  if (!UUID_SHAPE.test(input.userId)) throw new Error('blockSignIn needs a user id');
  const blockedBy = input.blockedBy && UUID_SHAPE.test(input.blockedBy) ? input.blockedBy : null;
  await db.execute(sql`
    INSERT INTO core.sign_in_blocks (user_id, reason, blocked_by)
    VALUES (CAST(${input.userId} AS uuid), ${input.reason ?? 'deactivated'}, CAST(${blockedBy} AS uuid))
    ON CONFLICT (user_id) DO NOTHING
  `);
  await db.execute(sql`DELETE FROM core.session WHERE user_id = CAST(${input.userId} AS uuid)`);
}

/** Switches a person back on. Their password is not brought back: they set a new one. */
export async function unblockSignIn(db: RawSqlExecutor, userId: string): Promise<void> {
  if (!UUID_SHAPE.test(userId)) return;
  await db.execute(sql`DELETE FROM core.sign_in_blocks WHERE user_id = CAST(${userId} AS uuid)`);
}

/* ===== the organization a new session starts in ===== */

export interface OrgMembershipFact {
  readonly orgId: string;
  /** The stored role string: 'owner', 'admin,billing', 'deactivated:member'. */
  readonly role: string;
  readonly orgName: string;
  readonly joinedAt: Date | string | null;
}

const DEACTIVATED_PREFIX = 'deactivated:';

function time(value: Date | string | null): number {
  if (value === null) return Number.MAX_SAFE_INTEGER;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

/**
 * PURE. The organization a person lands in when their session names none (a new sign in), or names
 * one they are no longer in: the one they worked in last, else one they own (the oldest), else the
 * one they joined first. Never "the first by name": that sent an owner to an organization where
 * she is only a member (billing review round 4). Deactivated memberships never count.
 */
export function pickDefaultOrg(memberships: readonly OrgMembershipFact[], lastOrgId: string | null | undefined): string | null {
  const active = memberships.filter((row) => !row.role.trim().toLowerCase().startsWith(DEACTIVATED_PREFIX));
  if (active.length === 0) return null;
  if (lastOrgId) {
    const last = active.find((row) => row.orgId === lastOrgId);
    if (last) return last.orgId;
  }
  const byAge = [...active].sort((a, b) => time(a.joinedAt) - time(b.joinedAt) || a.orgName.localeCompare(b.orgName));
  const owned = byAge.find((row) =>
    row.role
      .split(',')
      .some((part) => part.trim().toLowerCase() === 'owner'),
  );
  return (owned ?? byAge[0])?.orgId ?? null;
}

/** The organization this person worked in last, or null. */
export async function getLastOrgId(db: RawSqlExecutor, userId: string): Promise<string | null> {
  if (!UUID_SHAPE.test(userId)) return null;
  const rows = await readOrEmpty<{ org_id: string }>(
    db,
    sql`SELECT org_id FROM core.user_last_org WHERE user_id = CAST(${userId} AS uuid) LIMIT 1`,
  );
  return rows[0]?.org_id ?? null;
}

/** Remembers the organization a person just picked. Never throws: a lost note must not fail a request. */
export async function rememberLastOrg(db: RawSqlExecutor, userId: string, orgId: string): Promise<void> {
  if (!UUID_SHAPE.test(userId) || !UUID_SHAPE.test(orgId)) return;
  try {
    await db.execute(sql`
      INSERT INTO core.user_last_org (user_id, org_id, updated_at)
      VALUES (CAST(${userId} AS uuid), CAST(${orgId} AS uuid), now())
      ON CONFLICT (user_id) DO UPDATE SET org_id = EXCLUDED.org_id, updated_at = now()
        WHERE core.user_last_org.org_id IS DISTINCT FROM EXCLUDED.org_id
    `);
  } catch (error: unknown) {
    if (!isMissingTable(error)) console.error('[auth] could not remember the last organization', error);
  }
}

/** The organization a new session of this person should start in, or null when they are in none. */
export async function defaultOrgIdFor(db: RawSqlExecutor, userId: string): Promise<string | null> {
  if (!UUID_SHAPE.test(userId)) return null;
  const memberships = rowsOf<{ org_id: string; role: string; name: string; created_at: Date | string | null }>(
    await db.execute(sql`
      SELECT m.organization_id AS org_id, m.role AS role, o.name AS name, m.created_at AS created_at
        FROM core.member m
        JOIN core.organization o ON o.id = m.organization_id
       WHERE m.user_id = CAST(${userId} AS uuid)
    `),
  );
  if (memberships.length === 0) return null;
  const lastOrgId = await getLastOrgId(db, userId);
  return pickDefaultOrg(
    memberships.map((row) => ({ orgId: row.org_id, role: row.role, orgName: row.name, joinedAt: row.created_at })),
    lastOrgId,
  );
}

/* ===== the hard stops: database hooks ===== */

function refusedSignIn(): APIError {
  // The one answer a failed sign in ever gives (auth review M5): it never says why.
  return new APIError('UNAUTHORIZED', { code: INVALID_CREDENTIALS_CODE, message: INVALID_CREDENTIALS_MESSAGE });
}

type DatabaseHooks = NonNullable<BetterAuthOptions['databaseHooks']>;

/**
 * Database hooks every instance gets from `createAuth`:
 *  - no session and no account row for a switched off person (the hard stop behind every door),
 *  - a new session starts in the organization the person worked in last (`pickDefaultOrg`),
 *  - the organization a person picks is remembered for their next sign in.
 */
export function signInDatabaseHooks(db: RawSqlExecutor): DatabaseHooks {
  return {
    session: {
      create: {
        before: async (session) => {
          const userId = typeof session.userId === 'string' ? session.userId : null;
          if (await isSignInBlocked(db, userId)) throw refusedSignIn();
          const named = (session as { activeOrganizationId?: string | null }).activeOrganizationId;
          if (!userId || named) return;
          try {
            const orgId = await defaultOrgIdFor(db, userId);
            if (orgId) return { data: { ...session, activeOrganizationId: orgId } };
          } catch (error: unknown) {
            // A sign in must not fail because the starting organization could not be read.
            console.error('[auth] could not pick the starting organization for a new session', error);
          }
          return;
        },
      },
      update: {
        after: async (session) => {
          const row = session as { userId?: unknown; activeOrganizationId?: unknown } | null;
          if (!row || typeof row.userId !== 'string' || typeof row.activeOrganizationId !== 'string') return;
          await rememberLastOrg(db, row.userId, row.activeOrganizationId);
        },
      },
    },
    account: {
      create: {
        before: async (account) => {
          const userId = typeof account.userId === 'string' ? account.userId : null;
          // A new password row, or a new Google or Microsoft link, would switch the person back on.
          if (await isSignInBlocked(db, userId)) throw refusedSignIn();
        },
      },
    },
  };
}

/* ===== the neutral answers: one plugin in front of the doors that take an address ===== */

/** Doors that mail a code or a link to an address. A switched off address gets "ok" and no email. */
const SEND_PATHS = new Set([
  '/email-otp/send-verification-otp',
  '/email-otp/request-password-reset',
  '/forget-password/email-otp',
]);
/** The link based reset of Better Auth itself. No app sends such a link today; the rule is here for the day one does. */
const LINK_RESET_PATHS = new Set(['/request-password-reset', '/forget-password']);
/** Doors that take a code. A switched off address gets the answer a wrong code gets. */
const CODE_PATHS = new Set(['/sign-in/email-otp', '/email-otp/reset-password', '/email-otp/check-verification-otp']);
const PASSWORD_SIGN_IN_PATH = '/sign-in/email';

const GUARDED = new Set<string>([...SEND_PATHS, ...LINK_RESET_PATHS, ...CODE_PATHS, PASSWORD_SIGN_IN_PATH]);

function emailOf(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const value = (body as { email?: unknown }).email;
  return typeof value === 'string' && value.trim() !== '' ? value.trim().toLowerCase() : null;
}

/**
 * Answers for a switched off address, at the doors that take one. Each answer is the answer an
 * address with no account gets at that door, so nothing tells the two apart. Mounted by
 * `createAuth` on every instance, before the app's own plugins.
 */
export function signInBlockPlugin(db: RawSqlExecutor): BetterAuthPlugin {
  return {
    id: 'kitstak-sign-in-block',
    hooks: {
      before: [
        {
          matcher: (ctx) => typeof ctx.path === 'string' && GUARDED.has(ctx.path),
          handler: createAuthMiddleware(async (ctx) => {
            const email = emailOf(ctx.body);
            if (!email) return;
            if (!(await isSignInBlockedForEmail(db, email))) return;
            const path = ctx.path;
            if (path === PASSWORD_SIGN_IN_PATH) {
              // Costs what a real password check costs, then the one generic answer.
              await burnDummyPasswordVerify((ctx.body as { password?: unknown } | undefined)?.password);
              throw refusedSignIn();
            }
            if (SEND_PATHS.has(path)) return ctx.json({ success: true });
            if (LINK_RESET_PATHS.has(path)) {
              return ctx.json({ status: true, message: 'If this email exists in our system, check your email for the reset link' });
            }
            // A code door: the answer a wrong code gets.
            throw new APIError('BAD_REQUEST', { code: 'INVALID_OTP', message: 'Invalid OTP' });
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
