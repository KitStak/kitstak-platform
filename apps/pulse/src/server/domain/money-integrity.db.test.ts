/**
 * Money integrity against the local database (round one critic, issues 1 to 3):
 *   1. a deleted job's hours leave every rollup (shared cost, overhead absorbed, direct hours,
 *      the company bridge and the summary), and restore brings them back;
 *   2. two autosaves of one grid row at the same version: exactly one wins, the other gets CONFLICT;
 *   3. the production list says when it stopped early.
 * The suite makes its own organization and removes it at the end. Skipped when no database answers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import { isDomainError } from '@/server/errors';
import type { DomainContext } from './_shared';
import {
  createClient,
  createJob,
  createLaborClass,
  createLaborRate,
  deleteJob,
  getCompanyBridge,
  getJob,
  getSummary,
  inTx,
  listProductionPage,
  listSites,
  recalcOrg,
  restoreJob,
  saveIndirectEntry,
  savePaidHours,
  saveProductionEntry,
  updateSettings,
} from './test-exports';

const ready = await databaseReady();
const DAY = '2026-05-05';
const RANGE = { from: '2026-05-01', to: '2026-05-31' };

describe.skipIf(!ready)('pulse money integrity (database)', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let clientId: string;
  let packer: string;

  beforeAll(async () => {
    org = await createTestOrg('pulse-money');
    owner = await org.member('owner', 'Olive Owner');
    await listSites(owner);
    clientId = (await createClient(owner, { name: 'Apex Kits' })).id;
    packer = (await createLaborClass(owner, { code: 'PACK', name: 'Packer' })).id;
    await createLaborRate(owner, { laborClassId: packer, effectiveFrom: '2026-01-01', wageCents: 1600, payrollTaxBp: 900, benefitsBp: 1200, otherBurdenBp: 0, overheadPerHourCents: 240, overtimeMultiplier: '1.50' });
  }, 60_000);

  afterAll(async () => {
    if (!org) return;
    await org.destroy();
  }, 60_000);

  describe('a deleted job leaves every rollup', () => {
    let jobA: string;
    const snapshot = async () => {
      const summary = await getSummary(owner, RANGE);
      const bridge = await getCompanyBridge(owner, RANGE);
      const a = await getJob(owner, jobA);
      const [day] = await org.query<{ direct_hours: string; shared: string; overhead: string; missing: string; gross: string }>(
        `select direct_hours::text, shared_applied_cents::text as shared, overhead_absorbed_cents::text as overhead, missing_cents::text as missing, gross_pay_cents::text as gross
           from pulse.company_days where org_id = $1 and work_date = $2`,
        [org.orgId, DAY],
      );
      return {
        total: summary.total,
        bridge: summary.bridge,
        directBridge: bridge,
        jobAShared: a.stats.sharedCents,
        jobAProfit: a.stats.profitCents,
        day,
      };
    };

    beforeAll(async () => {
      // Every pool kind: indirect time, paid hours with time nobody logged, and overhead per hour.
      await updateSettings(owner, { sharedCostRule: 'full' });
      jobA = (await createJob(owner, { name: 'Steady job', clientId, status: 'active', plannedUnits: '5000', unitPrice: '2.0000' })).id;
      await saveProductionEntry(owner, { jobId: jobA, workDate: DAY, laborClassId: packer, unitsGood: '800', headcount: '5', hours: '40' });
      await saveIndirectEntry(owner, { workDate: DAY, laborClassId: packer, reason: 'meeting', hours: '6' });
      await savePaidHours(owner, { workDate: DAY, laborClassId: packer, paidHours: '90' });
    }, 60_000);

    it('deleting a job puts the summary, the bridge and every other job back to the cent', async () => {
      const before = await snapshot();
      expect(Number(before.jobAShared)).toBeGreaterThan(0);

      const jobB = (await createJob(owner, { name: 'Short job', clientId, status: 'active', plannedUnits: '1000', unitPrice: '2.0000' })).id;
      await saveProductionEntry(owner, { jobId: jobB, workDate: DAY, laborClassId: packer, unitsGood: '400', headcount: '4', hours: '32' });
      const during = await snapshot();
      expect(during.jobAShared).not.toBe(before.jobAShared);
      expect(during.day!.direct_hours).toBe('72.00');

      await deleteJob(owner, jobB);
      const after = await snapshot();
      expect(after).toEqual(before);
      // The deleted job's line carries no share of anything.
      const [leak] = await org.query<{ shared: string }>('select coalesce(sum(shared_cents), 0)::text as shared from pulse.production_entries where job_id = $1 and deleted_at is null', [jobB]);
      expect(leak!.shared).toBe('0');
      // Shared cost given out equals the pool, so the gap is zero, and the gap matches the parts.
      const b = after.directBridge;
      // Under the "full" rule the pool is time not on a job plus paid time nobody logged.
      expect(b.sharedAppliedCents).toBe((b.indirectCents ?? 0) + Number(after.day!.missing));
      expect(b.sharedGapCents).toBe(0);
      expect(b.companyProfitCents).toBe((b.workProfitCents ?? 0) - (b.sharedGapCents ?? 0) - (b.missingCostCents ?? 0) - (b.overheadGapCents ?? 0));

      // Restore brings the job and its share back exactly.
      await restoreJob(owner, jobB);
      expect(await snapshot()).toEqual(during);

      // Rows that leaked before this fix (job marked deleted with no rollup) are cleaned by a recalc.
      await org.query('update pulse.jobs set deleted_at = now() where id = $1', [jobB]);
      await inTx((tx) => recalcOrg(tx, owner));
      expect(await snapshot()).toEqual(before);
    }, 60_000);
  });

  describe('two saves of one row at the same version', () => {
    it('exactly one wins and the other gets CONFLICT', async () => {
      const job = (await createJob(owner, { name: 'Race job', clientId, status: 'active', plannedUnits: '1000', unitPrice: '1.0000' })).id;
      const { entry } = await saveProductionEntry(owner, { jobId: job, workDate: '2026-05-06', laborClassId: packer, unitsGood: '10', hours: '8' });
      const save = (units: string) => saveProductionEntry(owner, { id: entry.id, jobId: job, workDate: '2026-05-06', laborClassId: packer, unitsGood: units, hours: '8', version: entry.version }, { requireVersion: true });
      const results = await Promise.allSettled([save('111'), save('222')]);
      const won = results.filter((result) => result.status === 'fulfilled');
      const lost = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(isDomainError(lost[0]!.reason) && lost[0]!.reason.code).toBe('CONFLICT');
      const [row] = await org.query<{ version: number; units_good: string }>('select version, units_good::text from pulse.production_entries where id = $1', [entry.id]);
      expect(row!.version).toBe(entry.version + 1);
      const winner = (won[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof saveProductionEntry>>>).value;
      expect(Number(row!.units_good)).toBe(Number(winner.entry.unitsGood));
    }, 60_000);

    it('an edit of an existing row without a version is a CONFLICT, not an overwrite', async () => {
      const job = (await createJob(owner, { name: 'No version job', clientId, status: 'active', plannedUnits: '1000', unitPrice: '1.0000' })).id;
      const { entry } = await saveProductionEntry(owner, { jobId: job, workDate: '2026-05-07', laborClassId: packer, unitsGood: '10', hours: '8' });
      for (const input of [
        { id: entry.id, version: null },
        { id: null, version: null },
      ]) {
        let caught: unknown;
        try {
          await saveProductionEntry(owner, { ...input, jobId: job, workDate: '2026-05-07', laborClassId: packer, unitsGood: '999', hours: '8' }, { requireVersion: true });
        } catch (error) {
          caught = error;
        }
        expect(isDomainError(caught) && caught.code).toBe('CONFLICT');
      }
      const [row] = await org.query<{ units_good: string }>('select units_good::text from pulse.production_entries where id = $1', [entry.id]);
      expect(Number(row!.units_good)).toBe(10);
    }, 60_000);
  });

  describe('the production list', () => {
    it('flags a page that stopped early and gives the next offset', async () => {
      const job = (await createJob(owner, { name: 'Paged job', clientId, status: 'active', plannedUnits: '1000', unitPrice: '1.0000' })).id;
      for (const date of ['2026-05-11', '2026-05-12', '2026-05-13']) await saveProductionEntry(owner, { jobId: job, workDate: date, laborClassId: packer, unitsGood: '1', hours: '1' });
      const first = await listProductionPage(owner, { jobId: job, limit: 2 });
      expect(first.rows).toHaveLength(2);
      expect(first).toMatchObject({ truncated: true, limit: 2, offset: 0, nextOffset: 2 });
      const second = await listProductionPage(owner, { jobId: job, limit: 2, offset: 2 });
      expect(second.rows).toHaveLength(1);
      expect(second).toMatchObject({ truncated: false, nextOffset: null });
    }, 60_000);
  });
});
