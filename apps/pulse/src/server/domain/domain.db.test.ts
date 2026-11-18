/**
 * Domain tests against the local database: stamps and the worked examples of SPEC section 4,
 * rate effective dating, job numbering, the month lock, permissions and money hiding, and the
 * rollup proofs (`fact_days` equals `v_facts`, `job_stats` equals the facts of the job).
 * The suite makes its own organization and removes it at the end. Skipped when no database answers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import { isDomainError } from '@/server/errors';
import type { DomainContext } from './_shared';
import { todayInZone } from './_shared';
import {
  addDaysForTest,
  closePeriod,
  createClient,
  createJob,
  createLaborClass,
  createLaborRate,
  createSite,
  deleteProductionEntries,
  evaluateAlerts,
  getCloseChecklist,
  getCompanyBridge,
  getJob,
  getOnboardingState,
  getSettings,
  getProfit,
  getSummary,
  listActivity,
  listAlerts,
  listJobs,
  listJobTypes,
  listLaborClasses,
  listLaborRates,
  listPeriods,
  listProduction,
  listSites,
  listVasServices,
  markDayComplete,
  reopenPeriod,
  restoreProductionEntries,
  saveIndirectEntry,
  saveProductionBulk,
  saveProductionEntry,
  setJobPrice,
  setJobStatus,
  setMemberRole,
  updateSettings,
} from './test-exports';
import * as domain from './test-exports';

const ready = await databaseReady();

/** Every money looking field or sentence in a DTO tree a reader without money received. */
function moneyLeaks(value: unknown, path: string, leaks: string[] = []): string[] {
  if (value === null || value === undefined) return leaks;
  if (typeof value === 'string') {
    if (/[$€£]\s?\d/.test(value) || /\d\s?%[^.]*margin|margin[^.]*\d\s?%/i.test(value) || /\bcents\b/i.test(value)) leaks.push(`${path}: "${value}"`);
    return leaks;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => moneyLeaks(item, `${path}[${index}]`, leaks));
    return leaks;
  }
  if (typeof value !== 'object') return leaks;
  for (const [key, inner] of Object.entries(value)) {
    if (/(cents|marginbp|marginfloorbp|marginbeforesharedbp|laborpctbp|payrolltaxbp|benefitsbp|burdenbp|unitprice|unitcost|materialcostperunit|unitamount|defaultprice|defaultcostperunit|wage)$/i.test(key) && inner !== null) leaks.push(`${path}.${key} = ${JSON.stringify(inner)}`);
    moneyLeaks(inner, `${path}.${key}`, leaks);
  }
  return leaks;
}

async function expectError(run: () => Promise<unknown>, code: string, message?: RegExp): Promise<void> {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(isDomainError(caught), `expected a ${code} error, got ${String(caught)}`).toBe(true);
  if (isDomainError(caught)) {
    expect(caught.code).toBe(code);
    if (message) expect(caught.message).toMatch(message);
  }
}

describe.skipIf(!ready)('pulse domain (database)', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let siteId: string;
  let clientId: string;
  let packer: string;

  beforeAll(async () => {
    org = await createTestOrg('pulse-domain');
    owner = await org.member('owner', 'Olive Owner');
    const sites = await listSites(owner);
    siteId = sites[0]!.id;
    clientId = (await createClient(owner, { name: 'Acme Foods' })).id;
    packer = (await createLaborClass(owner, { code: 'PACK', name: 'Packer' })).id;
    await createLaborRate(owner, { laborClassId: packer, effectiveFrom: '2026-01-01', wageCents: 1600, payrollTaxBp: 900, benefitsBp: 1200, otherBurdenBp: 0, overheadPerHourCents: 240, overtimeMultiplier: '1.50' });
  }, 60_000);

  afterAll(async () => {
    if (!org) return;
    await org.destroy();
  }, 60_000);

  it('makes the default site, the General job type and twelve system alert rules with the org', async () => {
    const [counts] = await org.query<{ sites: number; types: number; rules: number }>(
      `select (select count(*) from pulse.sites where org_id = $1 and is_default)::int as sites,
              (select count(*) from pulse.job_types where org_id = $1 and code = 'GENERAL' and is_builtin)::int as types,
              (select count(*) from pulse.alert_rules where org_id = $1 and is_system)::int as rules`,
      [org.orgId],
    );
    expect(counts).toEqual({ sites: 1, types: 1, rules: 12 });
  });

  it('stores the real cost of an hour of the Packer example: $21.76 regular, $30.48 overtime', async () => {
    const rates = await listLaborRates(owner, { laborClassId: packer });
    expect(rates[0]).toMatchObject({ wageCents: 1600, loadedRateCents: 2176, overtimeRateCents: 3048, wagesHidden: false });
  });

  describe('job numbering', () => {
    it('counts up from the sequence and skips a number that is already taken', async () => {
      const first = await createJob(owner, { name: 'Numbered one', clientId });
      const typed = await createJob(owner, { name: 'Typed number', clientId, number: `J-${Number(first.number.slice(2)) + 1}` });
      const next = await createJob(owner, { name: 'Numbered two', clientId });
      expect(first.number).toMatch(/^J-\d+$/);
      expect(Number(next.number.slice(2))).toBe(Number(typed.number.slice(2)) + 1);
      await expectError(() => createJob(owner, { name: 'Same number', clientId, number: first.number.toLowerCase() }), 'CONFLICT', /already uses that number/);
    });

    it('finds a job by id or by number without case', async () => {
      const job = await createJob(owner, { name: 'Lookup', clientId, number: 'WO000088' });
      expect((await getJob(owner, 'wo000088')).id).toBe(job.id);
      expect((await getJob(owner, job.id)).number).toBe('WO000088');
      await expectError(() => getJob(owner, 'no-such-job'), 'NOT_FOUND');
    });
  });

  describe('stamps (worked examples of SPEC 4.4, 4.6 and 4.8)', () => {
    it('stamps labor, overhead, gross pay, per unit revenue and standard material on one entry', async () => {
      const job = await createJob(owner, { name: 'Stamp check', clientId, status: 'active', plannedUnits: '10000', unitPrice: '2.7500', materialCostPerUnit: '0.4500' });
      const { entry, created } = await saveProductionEntry(owner, { jobId: job.id, workDate: '2026-03-02', laborClassId: packer, unitsGood: '3000', unitsScrap: '60', headcount: '12', hours: '96', overtimeHours: '4' });
      expect(created).toBe(true);
      expect(entry).toMatchObject({ rateCents: 2176, overtimeRateCents: 3048, laborCostCents: 212384, baseRevenueCents: 825000, stdMaterialCents: 137700, stdScrapCents: 2700, needsRate: false, sharedCents: 0 });
      const [row] = await org.query<{ overhead_cents: string; gross_pay_cents: string }>('select overhead_cents, gross_pay_cents from pulse.production_entries where id = $1', [entry.id]);
      expect(Number(row!.overhead_cents)).toBe(23040);
      expect(Number(row!.gross_pay_cents)).toBe(156800);
      const detail = await getJob(owner, job.id);
      expect(detail.stats).toMatchObject({ revenueCents: 825000, laborCents: 212384, materialCents: 137700, scrapCents: 2700, costCents: 350084, profitCents: 474916, unitsGood: '3000.000', hours: '96.00' });
    });

    it('a dated price never changes earlier days', async () => {
      const job = await createJob(owner, { name: 'Price change', clientId, status: 'active', plannedUnits: '1000', unitPrice: '2.0000' });
      await saveProductionBulk(owner, [
        { jobId: job.id, workDate: '2026-03-03', laborClassId: packer, unitsGood: '100', hours: '4' },
        { jobId: job.id, workDate: '2026-03-10', laborClassId: packer, unitsGood: '100', hours: '4' },
      ]);
      const result = await setJobPrice(owner, job.id, { effectiveFrom: '2026-03-09', unitPrice: '3.0000' });
      expect(result.moved).toBe(false);
      const entries = await listProduction(owner, { jobId: job.id });
      expect(entries.map((entry) => [entry.workDate, entry.baseRevenueCents])).toEqual([
        ['2026-03-10', 30000],
        ['2026-03-03', 20000],
      ]);
      expect(result.job.unitPrice).toBe('3.0000');
    });

    it('earns a fixed price by progress and trues it up when the job is completed', async () => {
      const job = await createJob(owner, { name: 'Fixed price', clientId, status: 'active', pricingModel: 'fixed', fixedPriceCents: 940000, plannedUnits: '2000' });
      await saveProductionBulk(owner, [
        { jobId: job.id, workDate: '2026-03-16', laborClassId: packer, unitsGood: '500', hours: '10' },
        { jobId: job.id, workDate: '2026-03-17', laborClassId: packer, unitsGood: '700', hours: '10' },
      ]);
      const stamps = async () => (await listProduction(owner, { jobId: job.id })).map((entry) => entry.baseRevenueCents).reverse();
      expect(await stamps()).toEqual([235000, 329000]);
      const done = await setJobStatus(owner, job.id, 'completed', { completedDate: '2026-03-18' });
      expect(done.stats.revenueCents).toBe(940000);
      const [trueUp] = await org.query<{ amount_cents: string }>("select amount_cents from pulse.revenue_entries where job_id = $1 and kind = 'fixed_true_up' and deleted_at is null", [job.id]);
      expect(Number(trueUp!.amount_cents)).toBe(376000);
      const reopened = await setJobStatus(owner, job.id, 'active');
      expect(reopened.stats.revenueCents).toBe(564000);
      await saveProductionEntry(owner, { jobId: job.id, workDate: '2026-03-18', laborClassId: packer, unitsGood: '900', hours: '10' });
      expect(await stamps()).toEqual([235000, 329000, 376000]);
      // Deleting the middle entry restamps the rest: 500 then 900 units of 2,000.
      const middle = (await listProduction(owner, { jobId: job.id })).find((entry) => entry.workDate === '2026-03-17')!;
      await deleteProductionEntries(owner, [middle.id]);
      expect(await stamps()).toEqual([235000, 423000]);
      await restoreProductionEntries(owner, [middle.id]);
      expect(await stamps()).toEqual([235000, 329000, 376000]);
    });

    it('spreads time not on a job by labor hours with the largest remainder method', async () => {
      const flat = (await createLaborClass(owner, { code: 'FLAT', name: 'Flat twenty' })).id;
      await createLaborRate(owner, { laborClassId: flat, effectiveFrom: '2026-01-01', wageCents: 2000, payrollTaxBp: 0, benefitsBp: 0, otherBurdenBp: 0, overheadPerHourCents: 0, overtimeMultiplier: '1.50' });
      const jobs = [];
      for (const name of ['Share A', 'Share B', 'Share C']) jobs.push(await createJob(owner, { name, clientId, status: 'active', unitPrice: '1.0000' }));
      await saveProductionBulk(owner, [
        { jobId: jobs[0]!.id, workDate: '2026-04-06', laborClassId: packer, unitsGood: '10', hours: '96' },
        { jobId: jobs[1]!.id, workDate: '2026-04-07', laborClassId: packer, unitsGood: '10', hours: '40' },
        { jobId: jobs[2]!.id, workDate: '2026-04-08', laborClassId: packer, unitsGood: '10', hours: '24.5' },
      ]);
      // A $100.00 pool: 5 hours at $20.00.
      await saveIndirectEntry(owner, { workDate: '2026-04-09', laborClassId: flat, reason: 'meeting', hours: '5' });
      const shared = [];
      for (const job of jobs) shared.push((await getJob(owner, job.id)).stats.sharedCents);
      expect(shared).toEqual([5981, 2492, 1527]);
      const bridge = await getCompanyBridge(owner, { from: '2026-04-06', to: '2026-04-12' });
      expect(bridge).toMatchObject({ indirectCents: 10000, sharedAppliedCents: 10000, sharedGapCents: 0 });
    });
  });

  describe('rate effective dating (SPEC 4.3)', () => {
    it('picks the latest row on or before the day, and a site row over an all sites row', async () => {
      const other = await createSite(owner, { name: 'Second site', timezone: 'America/Chicago' });
      const cls = (await createLaborClass(owner, { code: 'DATED', name: 'Dated class' })).id;
      const plain = { payrollTaxBp: 0, benefitsBp: 0, otherBurdenBp: 0, overheadPerHourCents: 0, overtimeMultiplier: '1.50' };
      await createLaborRate(owner, { laborClassId: cls, effectiveFrom: '2026-01-01', wageCents: 2000, ...plain });
      await createLaborRate(owner, { laborClassId: cls, effectiveFrom: '2026-06-01', wageCents: 2500, ...plain });
      await createLaborRate(owner, { laborClassId: cls, siteId, effectiveFrom: '2026-03-01', wageCents: 3000, ...plain });
      const rate = async (site: string, date: string) => (await org.query<{ rate_cents: number; source: string }>('select rate_cents, source from pulse.rate_for($1, $2, $3, $4)', [org.orgId, cls, site, date]))[0];
      expect(await rate(siteId, '2025-12-31')).toMatchObject({ source: 'none' });
      expect(await rate(siteId, '2026-02-15')).toMatchObject({ rate_cents: 2000, source: 'class' });
      expect(await rate(siteId, '2026-04-15')).toMatchObject({ rate_cents: 3000 });
      expect(await rate(siteId, '2026-07-01')).toMatchObject({ rate_cents: 3000 });
      expect(await rate(other.id, '2026-04-15')).toMatchObject({ rate_cents: 2000 });
      expect(await rate(other.id, '2026-07-01')).toMatchObject({ rate_cents: 2500 });
      await expectError(() => createLaborRate(owner, { laborClassId: cls, effectiveFrom: '2026-06-01', wageCents: 2600, ...plain }), 'CONFLICT', /already has a rate/);
    });

    it('flags hours with no rate, then clears the flag when a rate or the default rate arrives', async () => {
      const bare = (await createLaborClass(owner, { code: 'BARE', name: 'No rate yet' })).id;
      const job = await createJob(owner, { name: 'Needs a rate', clientId, status: 'active', unitPrice: '1.0000' });
      const first = await saveProductionEntry(owner, { jobId: job.id, workDate: '2026-05-04', laborClassId: bare, unitsGood: '100', hours: '10' });
      expect(first.entry).toMatchObject({ needsRate: true, laborCostCents: 0 });
      expect((await getJob(owner, job.id)).stats).toMatchObject({ riskStatus: 'no_data', laborMissing: true });
      await updateSettings(owner, { defaultLoadedRateCents: 2200 });
      let [entry] = await listProduction(owner, { jobId: job.id });
      expect(entry).toMatchObject({ needsRate: false, rateCents: 2200, laborCostCents: 22000 });
      await createLaborRate(owner, { laborClassId: bare, effectiveFrom: '2026-05-01', wageCents: 1800, payrollTaxBp: 0, benefitsBp: 0, otherBurdenBp: 0, overheadPerHourCents: 200, overtimeMultiplier: '1.50' });
      [entry] = await listProduction(owner, { jobId: job.id });
      expect(entry).toMatchObject({ needsRate: false, rateCents: 2000, laborCostCents: 20000 });
      await updateSettings(owner, { defaultLoadedRateCents: null });
    });
  });

  describe('month close (SPEC 4.16)', () => {
    it('locks the month in the domain and in the database, and reopens with a reason', async () => {
      const job = await createJob(owner, { name: 'February work', clientId, status: 'active', unitPrice: '1.0000' });
      const { entry } = await saveProductionEntry(owner, { jobId: job.id, workDate: '2026-02-10', laborClassId: packer, unitsGood: '50', hours: '2' });
      const period = await closePeriod(owner, '2026-02');
      expect(period).toMatchObject({ periodMonth: '2026-02-01', status: 'closed' });
      expect(period.snapshot).toHaveProperty('bridge');
      await expectError(() => saveProductionEntry(owner, { id: entry.id, jobId: job.id, workDate: '2026-02-10', unitsGood: '60' }), 'CONFLICT', /^February is closed\. Ask the owner to reopen it\.$/);
      await expectError(() => saveProductionEntry(owner, { jobId: job.id, workDate: '2026-02-11', laborClassId: packer, unitsGood: '5', hours: '1' }), 'CONFLICT', /February is closed/);
      await expectError(() => deleteProductionEntries(owner, [entry.id]), 'CONFLICT', /February is closed/);
      await expectError(() => createLaborRate(owner, { laborClassId: packer, effectiveFrom: '2026-02-01', wageCents: 1700 }), 'CONFLICT', /February is closed/);
      // The trigger refuses a write that skips the domain layer, stamp only updates included.
      await expect(org.query('update pulse.production_entries set shared_cents = 1 where id = $1', [entry.id])).rejects.toMatchObject({ code: 'KP001' });
      await expect(org.query("insert into pulse.cost_entries (org_id, scope, cost_date, category, amount_cents) values ($1, 'company', '2026-02-05', 'rent', 100)", [org.orgId])).rejects.toMatchObject({ code: 'KP001' });
      // A price that would start in the closed month is moved up to the first open day.
      const moved = await setJobPrice(owner, job.id, { effectiveFrom: '2026-02-15', unitPrice: '1.5000' });
      expect(moved).toMatchObject({ effectiveFrom: '2026-03-01', moved: true });
      expect((await listProduction(owner, { jobId: job.id }))[0]).toMatchObject({ baseRevenueCents: 5000, locked: true });
      await expectError(() => reopenPeriod(owner, '2026-02', '  '), 'VALIDATION');
      const reopened = await reopenPeriod(owner, '2026-02', 'A late timesheet came in');
      expect(reopened).toMatchObject({ status: 'open', reopenReason: 'A late timesheet came in' });
      const again = await saveProductionEntry(owner, { id: entry.id, jobId: job.id, workDate: '2026-02-10', unitsGood: '60' });
      expect(again.entry.unitsGood).toBe('60.000');
    });

    it('only an admin may close and only the owner may reopen', async () => {
      const admin = await org.member('member', 'Adam Admin');
      const manager = await org.member('member', 'Mona Manager');
      await setMemberRole(owner, admin.userId, { role: 'admin' });
      await setMemberRole(owner, manager.userId, { role: 'manager' });
      await expectError(() => closePeriod(manager, '2025-12'), 'FORBIDDEN');
      await closePeriod(admin, '2025-12');
      await expectError(() => reopenPeriod(admin, '2025-12', 'oops'), 'FORBIDDEN');
      await reopenPeriod(owner, '2025-12', 'Closed by mistake');
    });
  });

  describe('permissions and money hiding (SPEC section 3)', () => {
    let viewer: DomainContext;
    let moneyViewer: DomainContext;
    let manager: DomainContext;
    let supervisor: DomainContext;
    let stranger: DomainContext;

    beforeAll(async () => {
      viewer = await org.member('member', 'Vera Viewer');
      moneyViewer = await org.member('member', 'Mo Money');
      manager = await org.member('member', 'Mia Manager');
      supervisor = await org.member('member', 'Sam Supervisor');
      stranger = await org.member('member', 'Nora None');
      await setMemberRole(owner, viewer.userId, { role: 'viewer' });
      await setMemberRole(owner, moneyViewer.userId, { role: 'viewer', seesMoney: true });
      await setMemberRole(owner, manager.userId, { role: 'manager' });
      await setMemberRole(owner, supervisor.userId, { role: 'supervisor' });
    }, 60_000);

    it('a member with no role gets nothing', async () => {
      await expectError(() => listJobs(stranger), 'FORBIDDEN', /Ask an admin/);
    });

    it('a viewer reads every screen with no money in it, and cannot write', async () => {
      await evaluateAlerts(owner);
      const leaks: string[] = [];
      const walk = (value: unknown, path: string): void => {
        if (value === null || value === undefined) return;
        if (typeof value === 'string') {
          if (/[$€£]\s?\d/.test(value) || /\d\s?%[^.]*margin|margin[^.]*\d\s?%/i.test(value) || /\bcents\b/i.test(value)) leaks.push(`${path}: "${value}"`);
          return;
        }
        if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${path}[${index}]`));
        if (typeof value !== 'object') return;
        for (const [key, inner] of Object.entries(value)) {
          if (/(cents|marginbp|marginfloorbp|marginbeforesharedbp|laborpctbp|payrolltaxbp|benefitsbp|burdenbp|unitprice|unitcost|materialcostperunit|unitamount|defaultprice|defaultcostperunit)$/i.test(key) && inner !== null) leaks.push(`${path}.${key} = ${JSON.stringify(inner)}`);
          walk(inner, `${path}.${key}`);
        }
      };
      const jobs = await listJobs(viewer);
      expect(jobs.length).toBeGreaterThan(0);
      expect(jobs.every((job) => job.moneyHidden && job.stats.moneyHidden)).toBe(true);
      walk(jobs, 'jobs');
      walk(await getJob(viewer, jobs[0]!.id), 'job');
      walk(await listProduction(viewer, {}), 'production');
      walk(await getProfit(viewer, 'job', { from: '2026-01-01', to: '2026-12-31' }, { comparePrior: true, trend: true }), 'profit');
      walk(await getSummary(viewer, { from: '2026-01-01', to: '2026-12-31' }), 'summary');
      walk(await getCompanyBridge(viewer, { from: '2026-01-01', to: '2026-12-31' }), 'bridge');
      walk(await listAlerts(viewer, { status: 'all' }), 'alerts');
      walk((await listActivity(viewer, { limit: 200 })).items, 'activity');
      // Month close and settings, plus what the job, labor and welcome pages hand to the browser.
      await org.query(
        `insert into pulse.periods (org_id, period_month, status, checklist) values ($1, '2025-06-01', 'open', $2::jsonb)
         on conflict (org_id, period_month) do update set checklist = excluded.checklist`,
        [org.orgId, JSON.stringify({ periodMonth: '2025-06-01', payrollGapCents: 123456, ready: true })],
      );
      for (const who of [viewer, supervisor]) {
        walk(await listPeriods(who), 'periods');
        walk(await getCloseChecklist(who, '2026-02'), 'checklist');
        walk(await getSettings(who), 'settings');
        walk(await listLaborClasses(who, { includeArchived: true }), 'laborClasses');
        walk(await listVasServices(who), 'services');
        walk(await listJobTypes(who), 'jobTypes');
        walk(await listSites(who), 'sites');
        walk(await getOnboardingState(who), 'welcome');
      }
      expect(leaks).toEqual([]);
      expect((await getSettings(viewer)).moneyHidden).toBe(true);
      // Units, hours and pace are still there.
      const withWork = jobs.find((job) => Number(job.stats.unitsGood) > 0)!;
      expect(Number(withWork.stats.hours)).toBeGreaterThan(0);
      await expectError(() => listLaborRates(viewer), 'FORBIDDEN', /does not include money/);
      await expectError(() => createJob(viewer, { name: 'Nope', clientId }), 'FORBIDDEN');
      await expectError(() => saveProductionEntry(viewer, { jobId: jobs[0]!.id, workDate: '2026-03-02', unitsGood: '1' }), 'FORBIDDEN');
    });

    it('every other reader a viewer or supervisor without money can open has no money in it', async () => {
      const range = { from: '2026-01-01', to: '2026-12-31' };
      const [job] = await listJobs(owner);
      const [client] = await domain.listClients(owner);
      const readers: Record<string, (who: DomainContext) => Promise<unknown>> = {
        clients: (who) => domain.listClients(who),
        client: (who) => domain.getClient(who, client!.id),
        items: (who) => domain.listItems(who),
        attention: (who) => domain.listJobsNeedingAttention(who),
        jobPrices: (who) => domain.listJobPrices(who, job!.id),
        jobPlans: (who) => domain.getJobPlans(who, job!.id),
        jobProfit: (who) => domain.getJobProfit(who, job!.id),
        logGrid: (who) => domain.getLogGrid(who, {}),
        reviewQueue: (who) => domain.getReviewQueue(who, {}),
        paceBoard: (who) => domain.getPaceBoard(who, range),
        goals: (who) => domain.getGoalsBoard(who, {}),
        notifications: (who) => domain.listNotifications(who, {}),
        closeBoard: (who) => domain.getCloseBoard(who),
        closeDetail: (who) => domain.getCloseDetail(who, '2026-02'),
        closeEvents: (who) => domain.listCloseEvents(who),
        trend: (who) => domain.getProfitTrend(who, range),
        facts: (who) => domain.listFacts(who, range),
        pivot: (who) => domain.getProfitPivot(who, 'client', 'type', range),
        profitEntries: (who) => domain.listProfitEntries(who, range),
        badges: (who) => domain.getBadges(who),
        laborSummary: (who) => domain.getLaborSummary(who, range),
        punches: (who) => domain.listPunches(who, {}),
        quotes: (who) => domain.listQuoteScenarios(who, {}),
        calculator: (who) => domain.getCalculatorSetup(who),
        similar: (who) => domain.listSimilarJobs(who, {}),
        standards: (who) => domain.listStandards(who, {}),
        targets: (who) => domain.listTargets(who, {}),
        indirect: (who) => domain.listIndirect(who, {}),
        paidHours: (who) => domain.listPaidHours(who, {}),
        materials: (who) => domain.listMaterialUsage(who, {}),
        services: (who) => domain.listVasEntries(who, {}),
        costs: (who) => domain.listCosts(who, {}),
        revenue: (who) => domain.listRevenue(who, {}),
        dayReviews: (who) => domain.listDayReviews(who, {}),
        wall: (who) => domain.getWallBoard(who, {}),
        alertRules: (who) => domain.listAlertRules(who),
        sample: (who) => domain.getSampleState(who),
        productionPage: (who) => domain.listProductionPage(who, {}),
      };
      const leaks: string[] = [];
      const opened: string[] = [];
      for (const [who, label] of [[viewer, 'viewer'], [supervisor, 'supervisor']] as const) {
        for (const [name, read] of Object.entries(readers)) {
          let value: unknown;
          try {
            value = await read(who);
          } catch (error) {
            if (isDomainError(error) && (error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND')) continue;
            throw error;
          }
          opened.push(`${label}.${name}`);
          moneyLeaks(value, `${label}.${name}`, leaks);
        }
      }
      expect(opened.length).toBeGreaterThan(40);
      expect(leaks).toEqual([]);
    });

    it('the sees money switch shows money but never the wage, and a manager never receives the wage either', async () => {
      const jobs = await listJobs(moneyViewer);
      expect(jobs.some((job) => job.stats.revenueCents !== null && job.stats.revenueCents > 0)).toBe(true);
      for (const who of [moneyViewer, manager]) {
        const rates = await listLaborRates(who, { laborClassId: packer });
        expect(rates[0]).toMatchObject({ loadedRateCents: 2176, wageCents: null, payrollTaxBp: null, benefitsBp: null, otherBurdenBp: null, overheadPerHourCents: null, wagesHidden: true });
      }
      await expectError(() => createLaborRate(manager, { laborClassId: packer, effectiveFrom: '2026-09-01', wageCents: 1700 }), 'FORBIDDEN');
      // Settings: a manager sees money targets but not the wage burden defaults.
      expect(await getSettings(manager)).toMatchObject({ defaultPayrollTaxBp: null, defaultBenefitsBp: null, defaultOtherBurdenBp: null, defaultOverheadPerHourCents: null, wagesHidden: true, moneyHidden: false });
      expect((await getSettings(manager)).defaultTargetMarginBp).not.toBeNull();
      expect((await getSettings(owner)).defaultPayrollTaxBp).not.toBeNull();
    });

    it('a supervisor logs the last 7 days only, and not after the day is marked complete', async () => {
      const [site] = await listSites(owner);
      const today = todayInZone(site!.timezone);
      const job = await createJob(owner, { name: 'Floor job', clientId, status: 'active', unitPrice: '1.0000', startDate: addDaysForTest(today, -30) });
      const saved = await saveProductionEntry(supervisor, { jobId: job.id, workDate: today, laborClassId: packer, unitsGood: '10', hours: '1' });
      expect(saved.entry).toMatchObject({ moneyHidden: true, laborCostCents: null, baseRevenueCents: null });
      await expectError(() => saveProductionEntry(supervisor, { jobId: job.id, workDate: addDaysForTest(today, -10), laborClassId: packer, unitsGood: '10', hours: '1' }), 'FORBIDDEN', /last 7 days/);
      await expectError(() => saveProductionEntry(supervisor, { jobId: job.id, workDate: addDaysForTest(today, 1), laborClassId: packer, unitsGood: '10', hours: '1' }), 'FORBIDDEN');
      await expectError(() => createJob(supervisor, { name: 'Not mine to make', clientId }), 'FORBIDDEN');
      await markDayComplete(supervisor, { date: today });
      await expectError(() => saveProductionEntry(supervisor, { id: saved.entry.id, jobId: job.id, workDate: today, unitsGood: '12' }), 'FORBIDDEN', /marked complete/);
      // A manager can still fix the day, and sees the stale version check.
      await expectError(() => saveProductionEntry(manager, { id: saved.entry.id, jobId: job.id, workDate: today, unitsGood: '12', version: saved.entry.version + 5 }), 'CONFLICT', /Someone else changed this row/);
      const fixed = await saveProductionEntry(manager, { id: saved.entry.id, jobId: job.id, workDate: today, unitsGood: '12', version: saved.entry.version });
      expect(fixed.entry).toMatchObject({ unitsGood: '12.000', baseRevenueCents: 1200 });
    });

    it('only an owner makes an owner, and the last owner cannot be removed', async () => {
      await expectError(() => setMemberRole(manager, viewer.userId, { role: 'admin' }), 'FORBIDDEN');
      const admin = await org.member('member', 'Ana Admin');
      await setMemberRole(owner, admin.userId, { role: 'admin' });
      await expectError(() => setMemberRole(admin, viewer.userId, { role: 'owner' }), 'FORBIDDEN', /Only the owner/);
      await expectError(() => setMemberRole(owner, owner.userId, { role: 'admin' }), 'CONFLICT', /at least one owner/);
    });
  });

  describe('rollups (SPEC 4.9, 4.18)', () => {
    it('fact_days equals the rollup of v_facts', async () => {
      const diff = await org.query(
        `with a as (select work_date, site_id, client_id, job_id, vas_service_id, kind, sum(amount_cents) amt, sum(units_good) units, sum(hours) hours
                      from pulse.v_facts where org_id = $1 group by 1, 2, 3, 4, 5, 6),
              b as (select work_date, site_id, client_id, job_id, vas_service_id, kind, amount_cents amt, units_good units, hours from pulse.fact_days where org_id = $1)
         (select 'missing' side, * from a except select 'missing', * from b) union all (select 'extra', * from b except select 'extra', * from a)`,
        [org.orgId],
      );
      expect(diff).toEqual([]);
    });

    it('job_stats equals the sum over the facts of each job', async () => {
      const diff = await org.query(
        `select st.job_id from pulse.job_stats st
           left join (select job_id,
                             sum(amount_cents) filter (where kind like 'revenue%') revenue,
                             sum(amount_cents) filter (where kind = 'labor') labor,
                             sum(amount_cents) filter (where kind = 'material') material,
                             sum(amount_cents) filter (where kind = 'other') other,
                             sum(amount_cents) filter (where kind = 'shared') shared,
                             sum(amount_cents) filter (where kind = 'billed_memo') billed
                        from pulse.v_facts where org_id = $1 and job_id is not null group by job_id) f on f.job_id = st.job_id
           join pulse.jobs j on j.id = st.job_id and j.deleted_at is null
          where st.org_id = $1
            and (st.revenue_cents, st.labor_cents, st.material_cents, st.other_cents, st.shared_cents, st.billed_cents)
                is distinct from (coalesce(f.revenue, 0), coalesce(f.labor, 0), coalesce(f.material, 0), coalesce(f.other, 0), coalesce(f.shared, 0), coalesce(f.billed, 0))`,
        [org.orgId],
      );
      expect(diff).toEqual([]);
      const [check] = await org.query<{ bad: number }>('select count(*)::int as bad from pulse.job_stats where org_id = $1 and (cost_cents <> labor_cents + material_cents + other_cents + shared_cents or profit_cents <> revenue_cents - cost_cents)', [org.orgId]);
      expect(check!.bad).toBe(0);
    });

    it('the Profit explorer total equals the sum of its rows at every level', async () => {
      const range = { from: '2026-01-01', to: '2026-12-31' };
      const totals = [];
      for (const by of ['job', 'client', 'type', 'service', 'site', 'month', 'week', 'day'] as const) {
        const result = await getProfit(owner, by, range);
        const sum = result.rows.reduce((total, row) => total + (row.profitCents ?? 0), 0);
        expect(sum, `rows of ${by}`).toBe(result.total.profitCents);
        totals.push(result.total.profitCents);
      }
      expect(new Set(totals).size).toBe(1);
      const bridge = await getCompanyBridge(owner, range);
      expect(bridge.workProfitCents).toBe(totals[0]);
      expect(bridge.companyProfitCents).toBe((bridge.workProfitCents ?? 0) - (bridge.sharedGapCents ?? 0) - (bridge.missingCostCents ?? 0) - (bridge.overheadGapCents ?? 0));
    });

    it('a soft deleted entry leaves the totals and comes back on restore', async () => {
      const job = await createJob(owner, { name: 'Undo me', clientId, status: 'active', unitPrice: '2.0000' });
      const { entry } = await saveProductionEntry(owner, { jobId: job.id, workDate: '2026-06-01', laborClassId: packer, unitsGood: '100', hours: '4' });
      expect((await getJob(owner, job.id)).stats).toMatchObject({ revenueCents: 20000, entryCount: 1 });
      await deleteProductionEntries(owner, [entry.id]);
      expect((await getJob(owner, job.id)).stats).toMatchObject({ revenueCents: 0, laborCents: 0, entryCount: 0 });
      await restoreProductionEntries(owner, [entry.id]);
      expect((await getJob(owner, job.id)).stats).toMatchObject({ revenueCents: 20000, laborCents: 8704, entryCount: 1 });
    });
  });

  describe('activity log', () => {
    it('is append only and every write leaves a row', async () => {
      const [row] = await org.query<{ id: string }>('select id from pulse.activity where org_id = $1 limit 1', [org.orgId]);
      await expect(org.query("update pulse.activity set verb = 'x' where id = $1", [row!.id])).rejects.toMatchObject({ code: 'KP002' });
      const verbs = (await org.query<{ verb: string }>('select distinct verb from pulse.activity where org_id = $1', [org.orgId])).map((item) => item.verb);
      expect(verbs).toEqual(expect.arrayContaining(['job.created', 'production.logged', 'production.edited', 'production.deleted', 'production.restored', 'rate.changed', 'price.changed', 'period.closed', 'period.reopened', 'role.changed', 'settings.changed', 'job.status_changed']));
    });
  });

  it('deleting the organization removes every pulse row, closed months included', async () => {
    const gone = await createTestOrg('pulse-cascade');
    const boss = await gone.member('owner');
    const client = await createClient(boss, { name: 'Short lived' });
    const job = await createJob(boss, { name: 'Short lived job', clientId: client.id, status: 'active', unitPrice: '1.0000' });
    await saveProductionEntry(boss, { jobId: job.id, workDate: '2026-01-15', unitsGood: '5', hours: '1' });
    await closePeriod(boss, '2026-01');
    await gone.destroy();
    const left = await org.query<{ n: number }>('select (select count(*) from pulse.production_entries where org_id = $1)::int + (select count(*) from pulse.settings where org_id = $1)::int + (select count(*) from pulse.activity where org_id = $1)::int as n', [gone.orgId]);
    expect(left[0]!.n).toBe(0);
  });
});
