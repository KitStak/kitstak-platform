/**
 * The CRM reader against the real local database, read only. Runs the real deal queries on the
 * seeded demo workspace that has CRM deals (Northwind), so a query that Postgres refuses fails
 * here instead of quietly reading as "no deals". Skipped when no database or no CRM data answers.
 */
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { databaseReady, TEST_DATABASE_URL } from '@/test/db';
import type { DomainContext } from '@/server/domain/_shared';
import { crmReady, getDeals, listWonDeals, searchDeals } from './crm';
import { softFailLine } from './log';

async function crmOrg(): Promise<DomainContext | null> {
  if (!(await databaseReady())) return null;
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  try {
    await client.connect();
    const found = await client.query<{ id: string; slug: string }>(
      `select o.id, o.slug from core.organization o
        where to_regclass('crm.items') is not null
          and exists (select 1 from crm.items i join crm.boards b on b.id = i.board_id where i.org_id = o.id and b.kind::text = 'deals' and i.deleted_at is null)
        order by (o.slug = 'northwind-robotics') desc, o.slug limit 1`,
    );
    const row = found.rows[0];
    return row ? { orgId: row.id, orgSlug: row.slug, userId: '00000000-0000-4000-8000-000000000001', userName: 'Reader', orgRole: 'owner', actorKind: 'system' } : null;
  } catch {
    return null;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const ctx = await crmOrg();
const ready = ctx !== null && (await crmReady(ctx));

describe('soft fail log line', () => {
  it('names the workspace, the reader and the database message', () => {
    const wrapped = new Error('Failed query: select 1', { cause: Object.assign(new Error('column d.won does not exist'), { code: '42703' }) });
    expect(softFailLine('org-1', 'crm.searchDeals', wrapped)).toEqual({ orgId: 'org-1', reader: 'crm.searchDeals', message: 'column d.won does not exist (Failed query: select 1)', code: '42703' });
    expect(softFailLine(null, 'detect.tableExists', 'boom')).toMatchObject({ orgId: null, message: 'boom', code: null });
  });
});

describe.skipIf(!ready)('CRM deal reader on real data', () => {
  afterEach(() => vi.restoreAllMocks());

  it('search finds deals, won ones first, without a query error', async () => {
    const errors = vi.spyOn(console, 'error');
    const all = await searchDeals(ctx!, '', 50);
    expect(errors).not.toHaveBeenCalled();
    expect(all.length).toBeGreaterThan(0);
    const firstLost = all.findIndex((deal) => !deal.won);
    if (firstLost >= 0) expect(all.slice(firstLost).every((deal) => !deal.won)).toBe(true);
    const named = all[0]!;
    const hit = await searchDeals(ctx!, named.name.slice(0, 12));
    expect(hit.map((deal) => deal.id)).toContain(named.id);
    expect(errors).not.toHaveBeenCalled();
  });

  it('won deals and deals by id run without a query error', async () => {
    const errors = vi.spyOn(console, 'error');
    const won = await listWonDeals(ctx!, { limit: 20, sinceDays: 3650 });
    const some = (await searchDeals(ctx!, '', 3)).map((deal) => deal.id);
    const byId = await getDeals(ctx!, some);
    expect(byId.map((deal) => deal.id).sort()).toEqual([...some].sort());
    expect(won.every((deal) => deal.won)).toBe(true);
    expect(errors).not.toHaveBeenCalled();
  });
});
