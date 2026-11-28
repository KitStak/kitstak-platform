/**
 * Helpers for tests that run against the local database. Each suite makes its own throwaway
 * organization (so suites can run next to people using the dev database) and removes it at the
 * end; the org cascade removes every `ledger` row with it.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { DomainContext } from '@/server/domain/_shared';
import type { OrgRole } from '@/lib/permissions';

export const TEST_DATABASE_URL = process.env.DATABASE_URL ?? '';

/** True when the database answers and the `ledger` schema is migrated. Never throws. */
export async function databaseReady(): Promise<boolean> {
  if (!TEST_DATABASE_URL) return false;
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    const result = await client.query("select to_regclass('ledger.accounts') as jobs, to_regclass('core.organization') as org");
    return Boolean(result.rows[0]?.jobs && result.rows[0]?.org);
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export interface TestOrg {
  readonly orgId: string;
  readonly slug: string;
  /** Adds a person to the org with an org role and returns their context. */
  readonly member: (orgRole: OrgRole, name?: string) => Promise<DomainContext>;
  /** Runs a raw statement (setup and assertions only). */
  readonly query: <T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]) => Promise<T[]>;
  /** Removes the org, its people and every `ledger` row. */
  readonly destroy: () => Promise<void>;
}

/** Makes a throwaway organization. The first member you ask for is usually the owner. */
export async function createTestOrg(label = 'ledger-test'): Promise<TestOrg> {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
  const orgId = randomUUID();
  const slug = `${label}-${orgId.slice(0, 8)}`;
  const userIds: string[] = [];
  await pool.query('insert into core.organization (id, name, slug, created_at) values ($1, $2, $3, now())', [orgId, `Test ${slug}`, slug]);
  const query: TestOrg['query'] = async (text, values) => (await pool.query(text, values)).rows;
  return {
    orgId,
    slug,
    query,
    member: async (orgRole, name = `Test ${orgRole}`) => {
      const userId = randomUUID();
      userIds.push(userId);
      await pool.query('insert into core."user" (id, name, email, email_verified, created_at, updated_at) values ($1, $2, $3, true, now(), now())', [userId, name, `${userId}@ledger-test.example`]);
      await pool.query('insert into core.member (id, organization_id, user_id, role, created_at) values ($1, $2, $3, $4, now())', [randomUUID(), orgId, userId, orgRole]);
      return { orgId, orgSlug: slug, userId, userName: name, orgRole, actorKind: 'user' };
    },
    destroy: async () => {
      await pool.query('delete from core.organization where id = $1', [orgId]);
      if (userIds.length > 0) await pool.query('delete from core."user" where id = any($1::uuid[])', [userIds]);
      await pool.end();
    },
  };
}
