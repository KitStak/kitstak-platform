/**
 * Against the shared dev Postgres (DATABASE_URL, default the local kitstak DB). Read only apart
 * from one event that is written inside a transaction and rolled back. Skipped when the database
 * or the pulse schema is not available.
 *
 * Proves: totals equal the sum of their rows to the cent, a margin is profit over revenue, money
 * is hidden for a person who may not see it, a stranger gets "no access", and an event collapses.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import {
  emitBridgeEvent,
  getAttentionCount,
  getClientProfit,
  getJobSummaries,
  getJobsForRecord,
  getOrgSummary,
  getSetupSignals,
  listJobsNeedingAttention,
  resolvePulseAccess,
  rowsOf,
  type BridgeExecutor,
  type PulseJobSummary,
} from './index';

const url = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/kitstak';
const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 1500 });

interface Seed {
  orgId: string;
  ownerId: string;
  linkType: string;
  linkId: string;
  clientId: string;
}

async function findSeed(): Promise<Seed | null> {
  try {
    const { rows } = await pool.query<{ ok: boolean }>("select to_regclass('pulse.job_stats') is not null and to_regclass('pulse.bridge_events') is not null as ok");
    if (rows[0]?.ok !== true) return null;
    const found = await pool.query<{ org_id: string; user_id: string; target_type: string; target_id: string; client_id: string }>(
      `select l.org_id, mr.user_id, l.target_type, l.target_id, j.client_id
         from pulse.job_links l
         join pulse.jobs j on j.id = l.job_id and j.deleted_at is null and j.client_id is not null
         join pulse.job_stats st on st.job_id = j.id and st.revenue_cents > 0
         join pulse.member_roles mr on mr.org_id = l.org_id and mr.role = 'owner'
         join core.member m on m.organization_id = mr.org_id and m.user_id = mr.user_id
        where l.target_type in ('crm_deal', 'wms_work_order')
        limit 1`,
    );
    const row = found.rows[0];
    return row ? { orgId: row.org_id, ownerId: row.user_id, linkType: row.target_type, linkId: row.target_id, clientId: row.client_id } : null;
  } catch {
    return null;
  }
}

const seed = await findSeed();
vi.setConfig({ testTimeout: 30_000 });
afterAll(() => pool.end());

class Rollback extends Error {}

describe.skipIf(!seed)('pulse-bridge (database)', () => {
  const db = drizzle(pool) as unknown as BridgeExecutor;
  const who = () => ({ orgId: seed!.orgId, userId: seed!.ownerId });

  it('resolves the owner and refuses a stranger', async () => {
    expect((await resolvePulseAccess(db, who())).role).toBe('owner');
    const stranger = { orgId: seed!.orgId, userId: '00000000-0000-4000-8000-000000000000' };
    expect((await resolvePulseAccess(db, stranger)).role).toBe('none');
    expect(await getOrgSummary(db, stranger)).toEqual({ available: false, reason: 'no_access' });
    expect(await getJobsForRecord(db, stranger, { type: 'crm_deal', id: seed!.linkId })).toEqual({ available: false, reason: 'no_access' });
    expect(await getAttentionCount(db, stranger)).toBe(0);
  });

  it('job totals equal the sum of the jobs, and margin is profit over revenue', async () => {
    const result = await getJobsForRecord(db, who(), { type: seed!.linkType as 'crm_deal', id: seed!.linkId }, { limit: 100 });
    if (!result.available) throw new Error('bridge not available');
    expect(result.jobs.length).toBeGreaterThan(0);
    const sum = (pick: (job: PulseJobSummary) => number | null): number => result.jobs.reduce((total, job) => total + (pick(job) ?? 0), 0);
    expect(result.totals.jobs).toBe(result.jobs.length);
    expect(result.totals.revenueCents).toBe(sum((job) => job.revenueCents));
    expect(result.totals.costCents).toBe(sum((job) => job.costCents));
    expect(result.totals.profitCents).toBe(sum((job) => job.profitCents));
    for (const job of result.jobs) {
      if (job.revenueCents !== null && job.costCents !== null) expect(job.profitCents).toBe(job.revenueCents - job.costCents);
      expect(job.path).toBe(`/jobs/${encodeURIComponent(job.number)}`);
    }
    const revenue = BigInt(result.totals.revenueCents ?? 0);
    const profit = BigInt(result.totals.profitCents ?? 0);
    if (revenue > BigInt(0)) {
      const two = BigInt(2);
      const magnitude = profit < BigInt(0) ? -profit : profit;
      const rounded = (two * magnitude * BigInt(10000) + revenue) / (two * revenue);
      expect(result.totals.marginBp).toBe(Number(profit < BigInt(0) ? -rounded : rounded));
    }
  });

  it('the batched read returns the same job as the single read', async () => {
    const single = await getJobsForRecord(db, who(), { type: seed!.linkType as 'crm_deal', id: seed!.linkId });
    const batch = await getJobSummaries(db, who(), { type: seed!.linkType as 'crm_deal', ids: [seed!.linkId, 'nothing-here'] });
    if (!single.available || !batch.available) throw new Error('bridge not available');
    expect(batch.byRecord[seed!.linkId]).toEqual(single.jobs[0]);
    expect(batch.byRecord['nothing-here']).toBeUndefined();
  });

  it('client profit matches the rows of pulse.fact_days', async () => {
    const result = await getClientProfit(db, who(), { pulseClientId: seed!.clientId }, { from: '2026-01-01', to: '2026-12-31', trendMonths: 3, longDays: 365 });
    if (!result.available) throw new Error('bridge not available');
    const { rows } = await pool.query<{ revenue: string; cost: string }>(
      `select coalesce(sum(amount_cents) filter (where kind like 'revenue_%'), 0)::text as revenue,
              coalesce(sum(amount_cents) filter (where kind in ('labor','material','other','shared')), 0)::text as cost
         from pulse.fact_days where org_id = $1 and client_id = $2 and work_date between '2026-01-01' and '2026-12-31'`,
      [seed!.orgId, seed!.clientId],
    );
    expect(result.client?.id).toBe(seed!.clientId);
    expect(result.period.revenueCents).toBe(Number(rows[0]!.revenue));
    expect(result.period.costCents).toBe(Number(rows[0]!.cost));
    expect(result.period.profitCents).toBe(Number(rows[0]!.revenue) - Number(rows[0]!.cost));
    expect(result.trend).toHaveLength(3);
    expect(result.longPeriod).not.toBeNull();
  });

  it('an unknown client is an empty answer, not an error', async () => {
    const result = await getClientProfit(db, who(), { coreCustomerId: '00000000-0000-4000-8000-000000000001' });
    expect(result).toMatchObject({ available: true, client: null, openJobs: 0 });
  });

  it('hides every money field from a person who may not see money', async () => {
    await drizzle(pool)
      .transaction(async (tx) => {
        const executor = tx as unknown as BridgeExecutor;
        await tx.execute(sql`update pulse.member_roles set role = 'supervisor', sees_money = false where org_id = ${seed!.orgId}::uuid and user_id = ${seed!.ownerId}::uuid`);
        const access = await resolvePulseAccess(executor, who());
        expect(access).toMatchObject({ role: 'supervisor', seesMoney: false, canLog: true, canManageJobs: false });
        const results = [
          await getJobsForRecord(executor, who(), { type: seed!.linkType as 'crm_deal', id: seed!.linkId }),
          await getClientProfit(executor, who(), { pulseClientId: seed!.clientId }, { trendMonths: 6, longDays: 365 }),
          await getOrgSummary(executor, who()),
          await listJobsNeedingAttention(executor, who(), { limit: 10 }),
        ];
        for (const result of results) {
          expect(result).toMatchObject({ available: true, moneyHidden: true });
          const leaks: string[] = [];
          JSON.stringify(result, (key, value) => {
            if (/(Cents|MarginBp|marginBp)$/.test(key) && value !== null) leaks.push(key);
            return value;
          });
          expect(leaks).toEqual([]);
        }
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });
  });

  it('counts for the setup guide and the workspace summary', async () => {
    const signals = await getSetupSignals(db, seed!.orgId);
    expect(signals && signals.jobs > 0 && signals.links > 0).toBe(true);
    const summary = await getOrgSummary(db, who(), { from: '2026-01-01', to: '2026-12-31' });
    if (!summary.available) throw new Error('bridge not available');
    expect(summary.totalJobs).toBeGreaterThanOrEqual(summary.openJobs);
    expect(summary.profitCents).toBe((summary.revenueCents ?? 0) - (summary.costCents ?? 0));
  });

  it('a burst of events for one record collapses into one waiting row', async () => {
    await drizzle(pool)
      .transaction(async (tx) => {
        const executor = tx as unknown as BridgeExecutor;
        const target = 'bridge-test-record';
        expect(await emitBridgeEvent(executor, { orgId: seed!.orgId }, { kind: 'wms_work_order_changed', targetId: target, payload: { status: 'Open' } })).toEqual({ queued: true });
        expect(await emitBridgeEvent(executor, { orgId: seed!.orgId }, { kind: 'wms_work_order_changed', targetId: target, payload: { status: 'Completed' } })).toEqual({ queued: true });
        const waiting = rowsOf<{ payload: { status: string } }>(
          await tx.execute(sql`select payload from pulse.bridge_events where org_id = ${seed!.orgId}::uuid and target_id = ${target}`),
        );
        expect(waiting).toHaveLength(1);
        expect(waiting[0]!.payload.status).toBe('Completed');
        expect(await emitBridgeEvent(executor, { orgId: 'not-an-org' }, { kind: 'wms_work_order_changed', targetId: target })).toEqual({ queued: false });
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });
  });
});
