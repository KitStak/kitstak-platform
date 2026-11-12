/**
 * The hosted bootstrap loads the bundled demo snapshot (seed-snapshot/) with restoreSnapshot.
 * Restoring into a migrated database must reconcile the ledger and leave constraints/triggers
 * exactly as the migrations define them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { dbAll, dbGet } from '@/server/db/sql';
import { restoreSnapshot, type DataSnapshot } from '@/server/db/restore-snapshot';
import { verifyDatabase } from '@/server/db/seed/verify';
import { createTestDb, type TestDb } from '../../setup/test-db';

const SNAPSHOT = path.join(process.cwd(), 'seed-snapshot', 'snapshot.json.gz');
const haveSnapshot = fs.existsSync(SNAPSHOT);

describe.skipIf(!haveSnapshot)('restoreSnapshot (bundled demo snapshot)', () => {
  let t: TestDb;
  let snapshot: DataSnapshot;
  beforeEach(async () => {
    t = await createTestDb();
    snapshot = JSON.parse(gunzipSync(fs.readFileSync(SNAPSHOT)).toString('utf8')) as DataSnapshot;
  });
  afterEach(async () => {
    await t.close();
  });

  it('loads every row, reconciles the ledger and restores constraints and triggers', async () => {
    const expected = snapshot.tables.reduce((n, table) => n + table.rows.length, 0);
    const result = await restoreSnapshot(t.db, snapshot);
    expect(result.rows).toBe(expected);

    const { issues } = await verifyDatabase(t.db);
    expect(issues).toEqual([]);

    const deferrable = await dbGet<{ n: number }>(
      t.db,
      sql`
      SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace AND condeferrable`,
    );
    expect(deferrable?.n).toBe(0);
    const disabled = await dbAll<{ name: string }>(
      t.db,
      sql`
      SELECT tgname AS name FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace AND t.tgenabled = 'D'`,
    );
    expect(disabled).toEqual([]);

    const users = await dbGet<{ n: number }>(t.db, sql`SELECT count(*)::int AS n FROM users`);
    expect(users?.n).toBeGreaterThan(0);
  }, 120_000);

  it('is repeatable: a second restore replaces the data instead of duplicating it', async () => {
    await restoreSnapshot(t.db, snapshot);
    const second = await restoreSnapshot(t.db, snapshot);
    const users = await dbGet<{ n: number }>(t.db, sql`SELECT count(*)::int AS n FROM users`);
    const expectedUsers = snapshot.tables.find((table) => table.name === 'users')?.rows.length ?? 0;
    expect(users?.n).toBe(expectedUsers);
    expect(second.rows).toBeGreaterThan(0);
  }, 180_000);
});
