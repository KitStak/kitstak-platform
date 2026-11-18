/**
 * The drill down rows (`GET /api/v1/profit/facts`) never stop short without saying so: a page
 * carries `truncated` and `nextOffset`, the pages put together are the whole list with no row
 * twice, and their total is the total of the rollup. Runs on a seeded throwaway organization.
 * Skipped when no database answers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import { seedMinimal } from '@/server/db/seed/minimal';
import { collectPages } from '@/lib/paging';
import type { FactRowDTO } from '@/lib/types';
import type { DomainContext } from './_shared';
import { FACTS_PAGE_DEFAULT, FACTS_PAGE_MAX, listFacts, listFactsPage } from './test-exports';

const ready = await databaseReady();
const RANGE = { from: '2000-01-01', to: '2099-12-31' };
const key = (row: FactRowDTO): string => `${row.sourceTable}:${row.sourceId}:${row.kind}`;

describe.skipIf(!ready)('profit facts are paged, with a flag when the list is cut', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let total: number;

  beforeAll(async () => {
    org = await createTestOrg('pulse-facts-page');
    owner = await org.member('owner', 'Paging Owner');
    await seedMinimal(owner);
    total = Number((await org.query<{ n: string }>(`select count(*) as n from pulse.v_facts f left join pulse.jobs j on j.id = f.job_id where f.org_id = $1 and (f.job_id is null or j.deleted_at is null)`, [org.orgId]))[0]?.n ?? 0);
  }, 180_000);

  afterAll(async () => {
    await org?.destroy();
  }, 60_000);

  it('seeded more rows than a small page holds', () => {
    expect(total).toBeGreaterThan(40);
  });

  it('a page that stops early says so and names the next offset', async () => {
    const first = await listFactsPage(owner, { ...RANGE, limit: 7 });
    expect(first.rows).toHaveLength(7);
    expect(first).toMatchObject({ truncated: true, limit: 7, offset: 0, nextOffset: 7 });
    const second = await listFactsPage(owner, { ...RANGE, limit: 7, offset: first.nextOffset ?? 0 });
    expect(second).toMatchObject({ truncated: true, limit: 7, offset: 7, nextOffset: 14 });
    // No row is on both pages.
    expect(new Set([...first.rows, ...second.rows].map(key)).size).toBe(14);
  });

  it('the last page is not marked as cut', async () => {
    const all = await listFactsPage(owner, { ...RANGE, limit: FACTS_PAGE_MAX });
    expect(all).toMatchObject({ truncated: false, nextOffset: null, offset: 0 });
    expect(all.rows).toHaveLength(total);
    const tail = await listFactsPage(owner, { ...RANGE, limit: 7, offset: total - 3 });
    expect(tail.rows).toHaveLength(3);
    expect(tail).toMatchObject({ truncated: false, nextOffset: null });
  });

  it('the page size has a default and a ceiling', async () => {
    expect((await listFactsPage(owner, RANGE)).limit).toBe(FACTS_PAGE_DEFAULT);
    expect((await listFactsPage(owner, { ...RANGE, limit: 999_999 })).limit).toBe(FACTS_PAGE_MAX);
    expect((await listFactsPage(owner, { ...RANGE, limit: 0, offset: -5 }))).toMatchObject({ limit: 1, offset: 0 });
  });

  it('reading every page gives every row once, and the total of the rollup', async () => {
    const paged = await collectPages<FactRowDTO>(async (offset) => {
      const page = await listFactsPage(owner, { ...RANGE, limit: 13, offset });
      return { data: page.rows, meta: page };
    });
    expect(paged.truncated).toBe(false);
    expect(paged.rows).toHaveLength(total);
    expect(new Set(paged.rows.map(key)).size).toBe(total);
    const sum = (rows: readonly FactRowDTO[], kind: string): number => rows.filter((row) => row.kind === kind).reduce((cents, row) => cents + (row.amountCents ?? 0), 0);
    const rollup = await org.query<{ kind: string; cents: string }>(`select kind, sum(amount_cents)::text as cents from pulse.fact_days where org_id = $1 group by kind`, [org.orgId]);
    expect(rollup.length).toBeGreaterThan(3);
    for (const line of rollup) expect(sum(paged.rows, line.kind), line.kind).toBe(Number(line.cents));
    // One small page alone comes up short: this is the mistake the flag is there to prevent.
    const onePage = await listFacts(owner, { ...RANGE, limit: 13 });
    expect(sum(onePage, 'labor')).toBeLessThan(sum(paged.rows, 'labor'));
  }, 60_000);

  it('the kinds filter pages the same way', async () => {
    const labor = await collectPages<FactRowDTO>(async (offset) => {
      const page = await listFactsPage(owner, { ...RANGE, kinds: ['labor'], limit: 5, offset });
      return { data: page.rows, meta: page };
    });
    expect(labor.rows.length).toBeGreaterThan(5);
    expect(labor.rows.every((row) => row.kind === 'labor')).toBe(true);
  });
});
