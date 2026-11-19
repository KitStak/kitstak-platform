/**
 * Company costs are monthly, so the company bridge gives a part month its share by day (SPEC 4.9).
 * Whole months stay exactly as they were, the parts of a month add back to the whole month to the
 * cent, and a range with no company costs has no overhead step.
 * The suite makes its own organization and removes it at the end. Skipped when no database answers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { CompanyBridgeDTO } from '@/lib/types';
import type { DomainContext } from './_shared';
import * as domain from './test-exports';

const ready = await databaseReady();

describe.skipIf(!ready)('company bridge for part months (database)', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let viewer: DomainContext;
  const bridge = (from: string, to: string): Promise<CompanyBridgeDTO> => domain.getCompanyBridge(owner, { from, to });

  beforeAll(async () => {
    org = await createTestOrg('pulse-bridge-days');
    owner = await org.member('owner', 'Olive Owner');
    viewer = await org.member('member', 'Vera Viewer');
    await domain.setMemberRole(owner, viewer.userId, { role: 'viewer' });
    await domain.listSites(owner);
    await domain.updateSettings(owner, { sharedCostRule: 'none' });
    const clientId = (await domain.createClient(owner, { name: 'Apex Kits' })).id;
    const crew = (await domain.createLaborClass(owner, { code: 'PACK', name: 'Packer' })).id;
    // $25.00 an hour, of which $5.00 is overhead.
    await domain.createLaborRate(owner, { laborClassId: crew, effectiveFrom: '2025-01-01', wageCents: 2000, payrollTaxBp: 0, benefitsBp: 0, otherBurdenBp: 0, overheadPerHourCents: 500, overtimeMultiplier: '1.50' });
    const job = await domain.createJob(owner, { name: 'Autumn kits', clientId, status: 'active', unitPrice: '10.0000' });
    // 10 hours a day on four days: Sep 10, Sep 20, Sep 24 and Oct 6. Each day absorbs $50.00 of overhead and makes $750.00.
    for (const workDate of ['2025-09-10', '2025-09-20', '2025-09-24', '2025-10-06']) {
      await domain.saveProductionEntry(owner, { jobId: job.id, workDate, laborClassId: crew, unitsGood: '100', hours: '10' });
    }
    // September company costs: $1,000.01 on two days, an amount that does not split evenly over 30 days.
    await domain.saveCost(owner, { costDate: '2025-09-01', category: 'rent', amountCents: 90000 });
    await domain.saveCost(owner, { costDate: '2025-09-28', category: 'utilities', amountCents: 10001 });
    // October company costs: $310.00, so one day is $10.00.
    await domain.saveCost(owner, { costDate: '2025-10-15', category: 'rent', amountCents: 31000 });
  }, 120_000);

  afterAll(async () => {
    if (!org) return;
    await org.destroy();
  }, 60_000);

  it('leaves a whole month exactly as it was: all the costs against all the overhead the rates covered', async () => {
    const september = await bridge('2025-09-01', '2025-09-30');
    expect(september).toMatchObject({ workProfitCents: 225000, companyCostCents: 100001, overheadAbsorbedCents: 15000, overheadGapCents: 85001, hasCompanyCosts: true, companyCostPartial: false, companyCostNote: null });
    expect(september.companyProfitCents).toBe(225000 - 85001);
    expect(september.companyCostParts).toEqual([{ month: '2025-09-01', daysCounted: 30, daysInMonth: 30, monthCostCents: 100001, countedCents: 100001 }]);
    // The close screen reads the same function for the same whole month.
    const close = await domain.getCloseDetail(owner, '2025-09');
    expect(close.bridge).toMatchObject({ companyCostCents: 100001, overheadAbsorbedCents: 15000, overheadGapCents: 85001, companyProfitCents: september.companyProfitCents });
  });

  it('adds two halves of a month back to the whole month to the cent', async () => {
    const whole = await bridge('2025-09-01', '2025-09-30');
    const first = await bridge('2025-09-01', '2025-09-15');
    const second = await bridge('2025-09-16', '2025-09-30');
    // divRound(100001 * 15, 30) = 50001, and the second half is the rest.
    expect(first.companyCostCents).toBe(50001);
    expect(second.companyCostCents).toBe(50000);
    expect(first.companyCostNote).toBe('Company costs for 15 of 30 days.');
    expect(first.companyCostPartial).toBe(true);
    for (const key of ['companyCostCents', 'overheadAbsorbedCents', 'overheadGapCents', 'workProfitCents', 'companyProfitCents'] as const) {
      expect((first[key] ?? 0) + (second[key] ?? 0), key).toBe(whole[key]);
    }
    // Any split adds back, not only the middle one.
    for (let day = 1; day < 30; day += 1) {
      const cut = String(day).padStart(2, '0');
      const next = String(day + 1).padStart(2, '0');
      const [a, b] = await Promise.all([bridge('2025-09-01', `2025-09-${cut}`), bridge(`2025-09-${next}`, '2025-09-30')]);
      expect((a.companyCostCents ?? 0) + (b.companyCostCents ?? 0), `split after day ${day}`).toBe(100001);
      expect((a.companyProfitCents ?? 0) + (b.companyProfitCents ?? 0), `profit split after day ${day}`).toBe(whole.companyProfitCents);
    }
  }, 120_000);

  it('gives a week inside a month its share, even when no cost is dated in that week', async () => {
    // Sep 8 to Sep 14: no cost row is dated in the week, and one day of work is.
    const week = await bridge('2025-09-08', '2025-09-14');
    // divRound(100001 * 14, 30) - divRound(100001 * 7, 30) = 46667 - 23334 = 23333.
    expect(week).toMatchObject({ hasCompanyCosts: true, companyCostCents: 23333, overheadAbsorbedCents: 5000, overheadGapCents: 18333, workProfitCents: 75000, companyProfitCents: 75000 - 18333 });
    expect(week.companyCostNote).toBe('Company costs for 7 of 30 days.');
    expect(week.companyCostParts).toEqual([{ month: '2025-09-01', daysCounted: 7, daysInMonth: 30, monthCostCents: 100001, countedCents: 23333 }]);
  });

  it('counts each month by its own days for a range across two months', async () => {
    // Sep 21 to Oct 10: 10 of 30 days of September and 10 of 31 days of October.
    const across = await bridge('2025-09-21', '2025-10-10');
    const septemberShare = 100001 - Math.round((100001 * 20) / 30); // 100001 - 66667 = 33334
    expect(septemberShare).toBe(33334);
    expect(across.companyCostParts).toEqual([
      { month: '2025-09-01', daysCounted: 10, daysInMonth: 30, monthCostCents: 100001, countedCents: 33334 },
      { month: '2025-10-01', daysCounted: 10, daysInMonth: 31, monthCostCents: 31000, countedCents: 10000 },
    ]);
    expect(across).toMatchObject({ companyCostCents: 43334, overheadAbsorbedCents: 10000, overheadGapCents: 33334, workProfitCents: 150000, companyProfitCents: 150000 - 33334 });
    expect(across.companyCostNote).toBe('Company costs for 10 of 30 days in September and 10 of 31 days in October.');
    // Two whole months are the sum of the two months, with nothing to say.
    const both = await bridge('2025-09-01', '2025-10-31');
    const [september, october] = await Promise.all([bridge('2025-09-01', '2025-09-30'), bridge('2025-10-01', '2025-10-31')]);
    expect(both.companyCostNote).toBeNull();
    expect(both.companyCostPartial).toBe(false);
    expect(both.companyProfitCents).toBe((september.companyProfitCents ?? 0) + (october.companyProfitCents ?? 0));
    expect(both.overheadGapCents).toBe((september.overheadGapCents ?? 0) + (october.overheadGapCents ?? 0));
  });

  it('charges month to date only the days so far', async () => {
    // October 1 to 18, as Home shows a month in progress: 18 of 31 days of $310.00 is $180.00.
    const toDate = await bridge('2025-10-01', '2025-10-18');
    expect(toDate).toMatchObject({ companyCostCents: 18000, overheadAbsorbedCents: 5000, overheadGapCents: 13000, companyProfitCents: 75000 - 13000 });
    expect(toDate.companyCostNote).toBe('Company costs for 18 of 31 days.');
    // The summary Home reads carries the same bridge.
    const summary = await domain.getSummary(owner, { from: '2025-10-01', to: '2025-10-18' });
    expect(summary.bridge).toMatchObject({ companyCostCents: 18000, overheadGapCents: 13000, companyProfitCents: toDate.companyProfitCents, companyCostNote: 'Company costs for 18 of 31 days.' });
  });

  it('has no overhead step when no month in the range has company costs, and says which month has none', async () => {
    const november = await bridge('2025-11-01', '2025-11-30');
    expect(november).toMatchObject({ hasCompanyCosts: false, overheadGapCents: null, companyCostCents: 0, companyCostPartial: false, companyCostNote: null, companyCostParts: [] });
    // October has costs and November has none: October counts, November trusts the hourly rates.
    const mixed = await bridge('2025-10-01', '2025-11-30');
    const october = await bridge('2025-10-01', '2025-10-31');
    expect(mixed.overheadGapCents).toBe(october.overheadGapCents);
    expect(mixed.companyCostNote).toBe('No company costs are typed in for November, so that month trusts the overhead in your hourly rates.');
  });

  it('hides the money and keeps the words for a reader without money', async () => {
    const hidden = await domain.getCompanyBridge(viewer, { from: '2025-09-08', to: '2025-09-14' });
    expect(hidden).toMatchObject({ moneyHidden: true, companyCostCents: null, overheadGapCents: null, companyProfitCents: null, companyCostNote: 'Company costs for 7 of 30 days.' });
    expect(hidden.companyCostParts).toEqual([{ month: '2025-09-01', daysCounted: 7, daysInMonth: 30, monthCostCents: null, countedCents: null }]);
  });

  it('explains a part month in the popover', async () => {
    const explained = await domain.explain(owner, 'company_profit', { from: '2025-09-08', to: '2025-09-14' });
    expect(explained.lines.map((item) => item.label)).toContain('Company costs counted for these days');
    expect(explained.quality).toContain('Company costs for 7 of 30 days.');
    const none = await domain.explain(owner, 'company_profit', { from: '2025-11-01', to: '2025-11-30' });
    expect(none.lines.some((item) => item.label.includes('Overhead'))).toBe(false);
  });
});
