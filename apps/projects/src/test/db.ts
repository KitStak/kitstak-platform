/**
 * Helpers for tests that run against the local database (`*.db.test.ts`, the `db` vitest
 * project). Each suite makes its own throwaway organization, so suites can run next to the dev
 * servers and other people on the shared dev database (docs/programs/SPEC.md B.3), and removes it
 * at the end; the org cascade removes every `pm` row with it.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { DomainContext } from '@/server/domain/_shared';
import type { OrgRole } from '@/lib/permissions';

export const TEST_DATABASE_URL = process.env.DATABASE_URL ?? '';

/**
 * What to do when the database is not ready for a suite: in CI (`CI=true`) or with
 * `REQUIRE_DB=1` the suite fails, so acceptance tests are never skipped silently; anywhere else
 * a loud warning says why the suites are skipped.
 */
function reportNotReady(reason: string): void {
  const message = `DATABASE TESTS SKIPPED: ${reason}. Set DATABASE_URL to a migrated database to run them.`;
  if (process.env.CI === 'true' || process.env.REQUIRE_DB === '1') throw new Error(message);
  process.stderr.write(`\n\u001b[33m!!! ${message} !!!\u001b[0m\n\n`);
}

/**
 * True when the database answers and the `pm` schema is migrated (with Programs). Throws in CI (or
 * with REQUIRE_DB=1) instead of returning false, and warns loudly otherwise, so a skipped suite is
 * never silent.
 */
export async function databaseReady(tables: readonly string[] = ['pm.projects', 'core.organization']): Promise<boolean> {
  if (!TEST_DATABASE_URL) {
    reportNotReady('DATABASE_URL is not set');
    return false;
  }
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL, connectionTimeoutMillis: 2000 });
  let missing: string | null = null;
  try {
    await client.connect();
    for (const table of tables) {
      const result = await client.query('select to_regclass($1) is not null as ok', [table]);
      if (result.rows[0]?.ok !== true) {
        missing = `table ${table} is missing (run db:migrate)`;
        break;
      }
    }
  } catch (error) {
    missing = `the database does not answer (${error instanceof Error ? error.message : String(error)})`;
  } finally {
    await client.end().catch(() => undefined);
  }
  if (missing) {
    reportNotReady(missing);
    return false;
  }
  return true;
}

export interface TestOrg {
  readonly orgId: string;
  readonly slug: string;
  readonly pool: pg.Pool;
  /** Adds a person to the org with an org role and returns their context. */
  readonly member: (orgRole: OrgRole, name?: string) => Promise<DomainContext>;
  /** Runs a raw statement (setup and assertions only). */
  readonly query: <T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]) => Promise<T[]>;
  /** Runs `fn` in one transaction on one client: COMMIT on success, ROLLBACK (and rethrow) on error. */
  readonly tx: <T>(fn: (client: pg.PoolClient) => Promise<T>) => Promise<T>;
  /** Removes the org, its people and every `pm` row. */
  readonly destroy: () => Promise<void>;
}

/** Makes a throwaway organization. The first member you ask for is usually the owner. */
export async function createTestOrg(label = 'projects-test'): Promise<TestOrg> {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
  const orgId = randomUUID();
  const slug = `${label}-${orgId.slice(0, 8)}`;
  const userIds: string[] = [];
  await pool.query('insert into core.organization (id, name, slug, created_at) values ($1, $2, $3, now())', [orgId, `Test ${slug}`, slug]);
  const query: TestOrg['query'] = async (text, values) => (await pool.query(text, values)).rows;
  return {
    orgId,
    slug,
    pool,
    query,
    member: async (orgRole, name = `Test ${orgRole}`) => {
      const userId = randomUUID();
      userIds.push(userId);
      await pool.query('insert into core."user" (id, name, email, email_verified, created_at, updated_at) values ($1, $2, $3, true, now(), now())', [userId, name, `${userId}@projects-test.example`]);
      await pool.query('insert into core.member (id, organization_id, user_id, role, created_at) values ($1, $2, $3, $4, now())', [randomUUID(), orgId, userId, orgRole]);
      return { orgId, orgSlug: slug, userId, userName: name, orgRole, actorKind: 'user' };
    },
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn(client);
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    destroy: async () => {
      await pool.query('delete from core.organization where id = $1', [orgId]);
      if (userIds.length > 0) await pool.query('delete from core."user" where id = any($1::uuid[])', [userIds]);
      await pool.end();
    },
  };
}

/** The SQLSTATE of a failed statement. */
export function sqlState(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}
