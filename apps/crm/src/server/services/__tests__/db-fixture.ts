/**
 * Integration-test fixture: isolated organizations + users created directly in the dev
 * database (embedded Postgres on 5544) and removed afterwards. Tests are skipped when the
 * database is not reachable so the unit suite stays runnable anywhere.
 */
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { inArray } from 'drizzle-orm';
import pg from 'pg';

// Next's env loader skips `.env.local` when NODE_ENV=test, so load it explicitly (never overrides).
loadDotenv({ path: path.resolve(process.cwd(), '.env.local'), quiet: true });

export async function databaseAvailable(): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1_500 });
  try {
    await client.connect();
    const result = await client.query<{ ok: boolean }>(
      "select to_regclass('crm.items') is not null as ok",
    );
    return result.rows[0]?.ok === true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

type Role = 'owner' | 'admin' | 'member' | 'viewer' | 'guest';

export interface TestOrg {
  readonly orgId: string;
  readonly users: Record<string, { id: string; role: Role }>;
}

export async function createTestOrgs(specs: ReadonlyArray<{ key: string; users: Record<string, Role> }>) {
  const { db } = await import('@/server/db');
  const { member, organization, user } = await import('@/server/db/schema');
  const suffix = Math.random().toString(36).slice(2, 10);
  const orgs: Record<string, TestOrg> = {};
  const userIds: string[] = [];
  const orgIds: string[] = [];
  for (const spec of specs) {
    const [org] = await db
      .insert(organization)
      .values({ name: `Test ${spec.key}`, slug: `test-${spec.key}-${suffix}`, createdAt: new Date() })
      .returning();
    if (!org) throw new Error('org insert failed');
    orgIds.push(org.id);
    const users: Record<string, { id: string; role: Role }> = {};
    for (const [userKey, role] of Object.entries(spec.users)) {
      const [created] = await db
        .insert(user)
        .values({ name: `${userKey} ${spec.key}`, email: `${userKey}.${spec.key}.${suffix}@test.example` })
        .returning();
      if (!created) throw new Error('user insert failed');
      userIds.push(created.id);
      await db
        .insert(member)
        .values({ organizationId: org.id, userId: created.id, role, createdAt: new Date() });
      users[userKey] = { id: created.id, role };
    }
    orgs[spec.key] = { orgId: org.id, users };
  }
  const cleanup = async () => {
    if (orgIds.length) await db.delete(organization).where(inArray(organization.id, orgIds));
    if (userIds.length) await db.delete(user).where(inArray(user.id, userIds));
  };
  return { orgs, cleanup };
}

export async function ctxFor(org: TestOrg, userKey: string) {
  const { db } = await import('@/server/db');
  const entry = org.users[userKey];
  if (!entry) throw new Error(`unknown test user ${userKey}`);
  return { db, orgId: org.orgId, userId: entry.id, roles: [entry.role] } as const;
}
