/**
 * Support for database tests in this package (never imported by app code). Tests run against the
 * local dev Postgres from docs/billing/DEV.md and are skipped when it is not reachable. Each test
 * file makes its own organizations and people, and removes them again when it is done.
 */
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createBillingRuntime } from '../server/runtime';
import type { BillingDb, BillingRuntime } from '../server/db';

export const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5544/kitstak';
export const TEST_PORTAL_URL = 'http://localhost:3300';
const TEST_SECRET = 'test-only-secret-test-only-secret-test-only-secret';

export interface TestDb {
  readonly pool: pg.Pool;
  readonly db: BillingDb;
  readonly available: boolean;
}

/** Opens a pool and checks that migration 0007 is applied. `available` is false otherwise. */
export async function openTestDb(): Promise<TestDb> {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4, connectionTimeoutMillis: 1500 });
  pool.on('error', () => undefined);
  let available = false;
  try {
    const { rows } = await pool.query<{ ok: boolean }>(
      `select to_regclass('core.billing_subscriptions') is not null
          and to_regclass('core.billing_test_objects') is not null
          and to_regclass('core.organization') is not null as ok`,
    );
    available = rows[0]?.ok === true;
  } catch {
    available = false;
  }
  return { pool, db: drizzle(pool) as unknown as BillingDb, available };
}

export interface TestPerson {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
}

export interface TestOrg {
  readonly orgId: string;
  readonly name: string;
  readonly owner: TestPerson;
  readonly people: readonly TestPerson[];
}

function token(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export async function addPerson(pool: pg.Pool, orgId: string | null, role: string, name?: string): Promise<TestPerson> {
  const tag = token();
  const email = `billing-test-${tag}@kitstak-test.example`;
  const fullName = name ?? `Test ${role} ${tag.slice(0, 4)}`;
  const user = await pool.query<{ id: string }>(
    `insert into core."user" (name, email, email_verified) values ($1, $2, true) returning id`,
    [fullName, email],
  );
  const id = user.rows[0]!.id;
  if (orgId) {
    await pool.query(
      `insert into core.member (organization_id, user_id, role, created_at) values ($1, $2, $3, now())`,
      [orgId, id, role],
    );
  }
  return { id, name: fullName, email, role };
}

/** A new organization with an owner (Maya Chen) and any extra roles asked for. */
export async function createTestOrg(pool: pg.Pool, extraRoles: readonly string[] = []): Promise<TestOrg> {
  const tag = token();
  const name = `Billing Test ${tag.slice(0, 6)}`;
  const org = await pool.query<{ id: string }>(
    `insert into core.organization (name, slug, created_at) values ($1, $2, now()) returning id`,
    [name, `billing-test-${tag}`],
  );
  const orgId = org.rows[0]!.id;
  const owner = await addPerson(pool, orgId, 'owner', 'Maya Chen');
  const people: TestPerson[] = [owner];
  for (const role of extraRoles) people.push(await addPerson(pool, orgId, role));
  return { orgId, name, owner, people };
}

/** Removes everything a test made for an org, including rows that do not cascade. */
export async function removeTestOrg(pool: pg.Pool, org: TestOrg, extraUserIds: readonly string[] = []): Promise<void> {
  const userIds = [...org.people.map((person) => person.id), ...extraUserIds];
  await pool.query(`delete from core.billing_events where org_id = $1`, [org.orgId]);
  await pool.query(`delete from core.billing_trial_uses where org_id = $1 or user_id = any($2::uuid[])`, [org.orgId, userIds]);
  await pool.query(`delete from core.rate_limit where key like $1`, [`billing:%${org.orgId}%`]);
  await pool.query(`delete from core.organization where id = $1`, [org.orgId]);
  await pool.query(`delete from core."user" where id = any($1::uuid[])`, [userIds]);
}

/** A runtime in test gateway mode. Pass `now` to move the clock for the pure parts. */
export function testRuntime(db: BillingDb, options?: { now?: () => Date; env?: NodeJS.ProcessEnv }): BillingRuntime {
  return createBillingRuntime({
    db,
    env: options?.env ?? ({ NODE_ENV: 'test', BETTER_AUTH_SECRET: TEST_SECRET } as NodeJS.ProcessEnv),
    portalUrl: TEST_PORTAL_URL,
    ...(options?.now ? { now: options.now } : {}),
  });
}
