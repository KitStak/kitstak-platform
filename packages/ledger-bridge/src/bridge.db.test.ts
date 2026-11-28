/**
 * Against the shared dev Postgres (DATABASE_URL, default the local kitstak DB). Read only.
 * Skipped when the database or the ledger schema is not there.
 *
 * Proves: availability sees the schema, an org owner resolves to Ledger owner with every right,
 * a person who is not a member gets no access, and the claim step agrees with the resolver.
 */
import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { canClaim, ledgerAvailability, listLedgerAccess, NO_ACCESS, resolveLedgerAccess, type BridgeExecutor } from './index';

const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5544/kitstak';
const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 1500 });
const db = drizzle(pool) as unknown as BridgeExecutor;

async function findOwner(): Promise<{ orgId: string; userId: string } | null> {
  try {
    const { rows } = await pool.query<{ ok: boolean }>("select to_regclass('ledger.member_roles') is not null as ok");
    if (rows[0]?.ok !== true) return null;
    const found = await pool.query<{ organization_id: string; user_id: string }>(
      `select m.organization_id, m.user_id from core.member m
        where m.role ~ '(^|,)\\s*owner\\s*(,|$)'
          and not exists (select 1 from ledger.member_roles mr where mr.org_id = m.organization_id and mr.user_id = m.user_id)
        limit 1`,
    );
    const row = found.rows[0];
    return row ? { orgId: row.organization_id, userId: row.user_id } : null;
  } catch {
    return null;
  }
}

const seed = await findOwner();

afterAll(async () => {
  await pool.end();
});

describe.skipIf(!seed)('ledger bridge on the dev database', () => {
  it('sees the ledger schema', async () => {
    await expect(ledgerAvailability(db)).resolves.toEqual({ available: true });
  });

  it('an org owner with no explicit row is the Ledger owner', async () => {
    const access = await resolveLedgerAccess(db, seed!);
    expect(access.role).toBe('owner');
    expect(access.source).toBe('org');
    expect(access.rights).toContain('period:reopen');
  });

  it('a stranger to the org has no access', async () => {
    await expect(resolveLedgerAccess(db, { orgId: seed!.orgId, userId: '00000000-0000-4000-8000-000000000000' })).resolves.toEqual(NO_ACCESS);
  });

  it('lists members and refuses the claim while an owner exists', async () => {
    const members = await listLedgerAccess(db, seed!.orgId);
    expect(members.some((member) => member.userId === seed!.userId && member.access.role === 'owner')).toBe(true);
    expect(canClaim(members, seed!.userId)).toBe(false);
  });
});
