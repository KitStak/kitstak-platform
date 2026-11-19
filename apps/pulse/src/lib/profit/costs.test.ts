/** Rates, labor, shared cost, materials, revenue and the summary: sections 4.3 to 4.9 of the spec. */
import { describe, expect, it } from 'vitest';
import {
  actualMaterial,
  addBuckets,
  allocateShared,
  averagePayRate,
  companyBridge,
  crewHoursCheck,
  defaultRate,
  fixedRevenueStamps,
  fixedTarget,
  fixedTrueUp,
  hourlyRevenue,
  laborCost,
  laborHoursFromCrew,
  loadedRate,
  marginGapLabel,
  materialLeftFromUsage,
  missingTime,
  overheadCovered,
  payrollGap,
  perUnitRevenue,
  pickRateRow,
  priceFor,
  profitSummary,
  rateBreakdown,
  rateFor,
  resolvePartsOwner,
  revenueTotals,
  scrapRateBp,
  scrapUnitsBp,
  serviceAmount,
  sharedGap,
  sharedPercentNeeded,
  sortFixedEntries,
  spreadCompanyCosts,
  spreadSharedCost,
  standardMaterial,
  suggestOverheadPerHour,
  sumFacts,
  utilizationBp,
  type FixedEntry,
} from './index';

const b = (n: number | string): bigint => BigInt(n);
const PACKER = { wageCents: 1600, payrollTaxBp: 900, benefitsBp: 1200, otherBurdenBp: 0, overheadPerHourCents: 240, overtimeMultiplier: '1.50' };

describe('real cost of an hour (4.3)', () => {
  it('matches the Packer example', () => {
    const rate = loadedRate(PACKER);
    expect(rate.loadedRateCents).toBe(b(2176));
    expect(rate.overtimeRateCents).toBe(b(3048));
    expect(rate.payRateCents).toBe(b(1936));
    expect(rate.burdenBp).toBe(2100);
    expect(rate.mult100).toBe(b(150));
    expect(rate.kind).toBe('class');
  });
  it('splits into wage, burden and overhead that add up', () => {
    const parts = rateBreakdown(loadedRate(PACKER));
    expect(parts).toEqual({ wageCents: b(1600), burdenCents: b(336), burdenBp: 2100, overheadPerHourCents: b(240), loadedRateCents: b(2176) });
    expect(parts.wageCents + parts.burdenCents + parts.overheadPerHourCents).toBe(parts.loadedRateCents);
  });
  it('handles a temp agency bill rate with no burden', () => {
    const rate = loadedRate({ wageCents: 2450, payrollTaxBp: 0, benefitsBp: 0, otherBurdenBp: 0, overheadPerHourCents: 0, overtimeMultiplier: 1.5 });
    expect(rate.loadedRateCents).toBe(b(2450));
    expect(rate.overtimeRateCents).toBe(b(3675));
    expect(rate.payRateCents).toBe(b(2450));
  });
  it('grows taxes with overtime, but not benefits or overhead', () => {
    const rate = loadedRate({ wageCents: 2000, payrollTaxBp: 1000, benefitsBp: 2000, otherBurdenBp: 500, overheadPerHourCents: 300, overtimeMultiplier: 2 });
    // 20 x 2 x 1.10 = 44.00, benefits and other 20 x 0.25 = 5.00, overhead 3.00
    expect(rate.overtimeRateCents).toBe(b(5200));
    expect(rate.loadedRateCents).toBe(b(3000)); // 20 x 1.35 + 3.00
  });
  it('refuses bad input', () => {
    expect(() => loadedRate({ ...PACKER, wageCents: -1 })).toThrow(RangeError);
    expect(() => loadedRate({ ...PACKER, payrollTaxBp: -5 })).toThrow(RangeError);
    expect(() => loadedRate({ ...PACKER, overtimeMultiplier: 0.9 })).toThrow(RangeError);
    expect(() => loadedRate({ ...PACKER, overheadPerHourCents: -1 })).toThrow(RangeError);
  });
  it('builds the org default rate with overtime and no overhead', () => {
    const rate = defaultRate(2200, '1.50');
    expect(rate.kind).toBe('default');
    expect(rate.loadedRateCents).toBe(b(2200));
    expect(rate.overtimeRateCents).toBe(b(3300));
    expect(rate.overheadPerHourCents).toBe(b(0));
    expect(() => defaultRate(-1)).toThrow(RangeError);
  });

  const rows = [
    { id: 'all-jan', laborClassId: 'packer', siteId: null, effectiveFrom: '2026-01-01', ...PACKER },
    { id: 'all-jul', laborClassId: 'packer', siteId: null, effectiveFrom: '2026-07-01', ...PACKER, wageCents: 1700 },
    { id: 'east-mar', laborClassId: 'packer', siteId: 'east', effectiveFrom: '2026-03-01', ...PACKER, wageCents: 1800 },
    { id: 'lead-jan', laborClassId: 'lead', siteId: null, effectiveFrom: '2026-01-01', ...PACKER, wageCents: 2200 },
  ];
  it('picks the latest row on or before the work date', () => {
    expect(pickRateRow(rows, { laborClassId: 'packer', siteId: 'west', workDate: '2026-06-30' })?.id).toBe('all-jan');
    expect(pickRateRow(rows, { laborClassId: 'packer', siteId: 'west', workDate: '2026-07-01' })?.id).toBe('all-jul');
    expect(pickRateRow(rows, { laborClassId: 'packer', siteId: 'west', workDate: '2025-12-31' })).toBeNull();
  });
  it('lets a row for the entry site win over a newer all sites row', () => {
    expect(pickRateRow(rows, { laborClassId: 'packer', siteId: 'east', workDate: '2026-08-01' })?.id).toBe('east-mar');
    expect(pickRateRow(rows, { laborClassId: 'packer', siteId: 'east', workDate: '2026-02-01' })?.id).toBe('all-jan');
    expect(pickRateRow(rows, { laborClassId: 'packer', siteId: null, workDate: '2026-08-01' })?.id).toBe('all-jul');
  });
  it('applies a rate change mid job from its start date only', () => {
    const before = rateFor(rows, { laborClassId: 'packer', siteId: 'west', workDate: '2026-06-30' });
    const after = rateFor(rows, { laborClassId: 'packer', siteId: 'west', workDate: '2026-07-01' });
    expect(before.rate?.loadedRateCents).toBe(b(2176));
    expect(after.rate?.loadedRateCents).toBe(b(2297)); // 17.00 x 1.21 + 2.40
    expect(laborCost({ hours: 8, rate: before.rate }).laborCostCents).toBe(b(17408));
    expect(laborCost({ hours: 8, rate: after.rate }).laborCostCents).toBe(b(18376));
  });
  it('falls back to the default class, then the org default rate, then flags needs rate', () => {
    expect(rateFor(rows, { laborClassId: null, siteId: null, workDate: '2026-02-01' }, { defaultLaborClassId: 'lead' })).toMatchObject({ source: 'default_class', needsRate: false });
    const org = rateFor(rows, { laborClassId: 'forklift', siteId: null, workDate: '2026-02-01' }, { defaultLoadedRateCents: 2500 });
    expect(org.source).toBe('org_default');
    expect(org.rate?.overtimeRateCents).toBe(b(3750));
    const none = rateFor(rows, { laborClassId: 'forklift', siteId: null, workDate: '2026-02-01' });
    expect(none).toEqual({ source: 'none', row: null, rate: null, needsRate: true });
  });
  it('suggests an overhead rate from company costs', () => {
    expect(suggestOverheadPerHour(2100000, '8750.00')).toBe(b(240));
    expect(suggestOverheadPerHour(2100000, 0)).toBeNull();
    expect(suggestOverheadPerHour(-500, 100)).toBe(b(0));
    expect(overheadCovered(240, '6750')).toBe(b(1620000));
  });
});

describe('labor cost (4.4)', () => {
  const rate = loadedRate(PACKER);
  it('matches the example: 12 packers, 8 hours each, 4 hours overtime', () => {
    expect(laborHoursFromCrew(12, 8)).toBe(96);
    const stamp = laborCost({ hours: '96.00', overtimeHours: '4.00', rate });
    expect(stamp.regularHours).toBe(92);
    expect(stamp.laborCostCents).toBe(b(212384));
    expect(stamp.overheadCents).toBe(b(23040));
    expect(stamp.grossPayCents).toBe(b(156800));
    expect(stamp.rateCents).toBe(b(2176));
    expect(stamp.overtimeRateCents).toBe(b(3048));
    expect(stamp.needsRate).toBe(false);
  });
  it('costs every hour at the regular rate when overtime is blank', () => {
    expect(laborCost({ hours: 96, rate }).laborCostCents).toBe(b(208896));
    expect(laborCost({ hours: 96, overtimeHours: null, rate }).overtimeHours).toBe(0);
    expect(laborCost({ hours: 96, overtimeHours: '', rate }).overtimeHours).toBe(0);
  });
  it('costs nothing for zero hours', () => {
    const stamp = laborCost({ hours: 0, rate });
    expect(stamp.laborCostCents).toBe(b(0));
    expect(stamp.overheadCents).toBe(b(0));
    expect(stamp.grossPayCents).toBe(b(0));
  });
  it('flags hours with no rate and costs them at zero', () => {
    expect(laborCost({ hours: 8, rate: null })).toMatchObject({ laborCostCents: b(0), needsRate: true, rateCents: null });
    expect(laborCost({ hours: 0, rate: null }).needsRate).toBe(false);
  });
  it('makes gross pay equal cost on the org default rate', () => {
    const stamp = laborCost({ hours: '10.33', overtimeHours: '1.11', rate: defaultRate(2199, '1.50') });
    expect(stamp.grossPayCents).toBe(stamp.laborCostCents);
    expect(stamp.overheadCents).toBe(b(0));
  });
  it('refuses overtime above hours and negative hours', () => {
    expect(() => laborCost({ hours: 4, overtimeHours: 5, rate })).toThrow(RangeError);
    expect(() => laborCost({ hours: -1, rate })).toThrow(RangeError);
    expect(() => laborCost({ hours: 1, overtimeHours: -1, rate })).toThrow(RangeError);
  });
  it('handles fractional crews and hours', () => {
    expect(laborHoursFromCrew('2.5', '7.25')).toBe(18.13);
    expect(laborHoursFromCrew(0, 8)).toBe(0);
  });
  it('asks about hours that look far off, and only then', () => {
    const warning = crewHoursCheck({ hours: '9.6', people: 12, shiftHours: 8 });
    expect(warning?.message).toBe('12 people for 8 hours is 96 labor hours. You typed 9.6. Is that right?');
    expect(warning?.expectedHours).toBe(96);
    expect(crewHoursCheck({ hours: 96, people: 12, shiftHours: 8 })).toBeNull();
    expect(crewHoursCheck({ hours: 60, people: 12, shiftHours: 8 })).toBeNull(); // 36 off, limit is 48
    expect(crewHoursCheck({ hours: 47, people: 12, shiftHours: 8 })).not.toBeNull();
    expect(crewHoursCheck({ hours: 145, people: 12, shiftHours: 8 })).not.toBeNull();
    expect(crewHoursCheck({ hours: 96, people: null, shiftHours: 8 })).toBeNull();
    expect(crewHoursCheck({ hours: 96, people: 0, shiftHours: 8 })).toBeNull();
    expect(crewHoursCheck({ hours: 30, people: 1, shiftHours: 1 })?.message).toBe('1 person for 1 hour is 1 labor hours. You typed 30. Is that right?');
  });
});

describe('time not on a job (4.5)', () => {
  const takers = [
    { id: 'a', workDate: '2026-11-02', hours: '96.00' },
    { id: 'b', workDate: '2026-11-03', hours: '40.00' },
    { id: 'c', workDate: '2026-11-04', hours: '24.50' },
  ];
  it('matches the largest remainder example', () => {
    const result = allocateShared(10000, takers);
    expect(result.shares).toEqual([
      { id: 'a', sharedCents: b(5981) },
      { id: 'b', sharedCents: b(2492) },
      { id: 'c', sharedCents: b(1527) },
    ]);
    expect(result.unallocatedCents).toBe(b(0));
  });
  it('breaks ties by earlier work date, then smaller id, whatever the input order', () => {
    const tied = [
      { id: 'z', workDate: '2026-11-03', hours: 1 },
      { id: 'b', workDate: '2026-11-02', hours: 1 },
      { id: 'a', workDate: '2026-11-02', hours: 1 },
    ];
    const result = allocateShared(2, tied);
    expect(result.shares).toEqual([
      { id: 'z', sharedCents: b(0) },
      { id: 'b', sharedCents: b(1) },
      { id: 'a', sharedCents: b(1) },
    ]);
  });
  it('leaves a pool with no takers unallocated', () => {
    expect(allocateShared(5000, [])).toEqual({ shares: [], poolCents: b(5000), unallocatedCents: b(5000) });
    const zeroHours = allocateShared(5000, [{ id: 'a', workDate: '2026-11-02', hours: 0 }]);
    expect(zeroHours.shares).toEqual([{ id: 'a', sharedCents: b(0) }]);
    expect(zeroHours.unallocatedCents).toBe(b(5000));
  });
  it('applies each shared cost rule', () => {
    const withLabor = takers.map((taker) => ({ ...taker, laborCostCents: 100000 }));
    const byHours = spreadSharedCost({ rule: 'by_labor_hours', indirectCents: 10000, missingCents: 4000, takers: withLabor });
    expect(byHours.poolCents).toBe(b(10000));
    const full = spreadSharedCost({ rule: 'full', indirectCents: 10000, missingCents: 4000, takers: withLabor });
    expect(full.poolCents).toBe(b(14000));
    expect(full.shares.reduce((sum, share) => sum + share.sharedCents, b(0))).toBe(b(14000));
    const percent = spreadSharedCost({ rule: 'percent_of_labor', indirectCents: 10000, sharedPctBp: 800, takers: withLabor });
    expect(percent.shares.map((share) => share.sharedCents)).toEqual([b(8000), b(8000), b(8000)]);
    expect(percent.poolCents).toBe(b(0));
    const none = spreadSharedCost({ rule: 'none', indirectCents: 10000, takers: withLabor });
    expect(none.shares.every((share) => share.sharedCents === b(0))).toBe(true);
  });
  it('works out missing time from real pay, or from the average pay rate', () => {
    expect(missingTime({ paidHours: 100, directHours: 80, indirectHours: 12, paidCents: 200000 })).toEqual({ missingHours: 8, missingCents: b(16000), overLogged: false });
    expect(missingTime({ paidHours: 100, directHours: 80, indirectHours: 12, avgPayRateCents: 1936 })).toEqual({ missingHours: 8, missingCents: b(15488), overLogged: false });
    expect(missingTime({ paidHours: 100, directHours: 80, indirectHours: 12 }).missingCents).toBe(b(0));
  });
  it('flags a day with more hours logged than paid', () => {
    expect(missingTime({ paidHours: 80, directHours: 80, indirectHours: 12, paidCents: 160000 })).toEqual({ missingHours: 0, missingCents: b(0), overLogged: true });
    expect(missingTime({ paidHours: 92, directHours: 80, indirectHours: 12, paidCents: 160000 }).overLogged).toBe(false);
  });
  it('averages pay rates by paid hours', () => {
    expect(averagePayRate([{ paidHours: 30, payRateCents: 2000 }, { paidHours: 10, payRateCents: 3000 }])).toBe(b(2250));
    expect(averagePayRate([])).toBeNull();
    expect(averagePayRate([{ paidHours: 0, payRateCents: 2000 }])).toBeNull();
  });
  it('works out the shared gap, the payroll gap and utilization', () => {
    expect(sharedGap({ rule: 'by_labor_hours', indirectCents: 364000, missingCents: 90000, sharedAppliedCents: 310000 })).toBe(b(54000));
    expect(sharedGap({ rule: 'full', indirectCents: 364000, missingCents: 90000, sharedAppliedCents: 454000 })).toBe(b(0));
    expect(sharedGap({ rule: 'none', indirectCents: 364000, sharedAppliedCents: 0 })).toBe(b(364000));
    expect(sharedGap({ rule: 'percent_of_labor', indirectCents: 364000, sharedAppliedCents: 400000 })).toBe(b(-36000));
    expect(payrollGap(4120000, 3935000)).toBe(b(185000));
    expect(utilizationBp({ directHours: 80, indirectHours: 12, paidHours: 100 })).toBe(8000);
    expect(utilizationBp({ directHours: 80, indirectHours: 20 })).toBe(8000);
    expect(utilizationBp({ directHours: 80, indirectHours: 20, paidHours: '' })).toBe(8000);
    expect(utilizationBp({ directHours: 0, indirectHours: 0 })).toBeNull();
    expect(sharedPercentNeeded(364000, 4550000)).toBe(800);
    expect(sharedPercentNeeded(364000, 0)).toBeNull();
  });
});

describe('material cost (4.6)', () => {
  it('matches the standard example: 3,000 good, 60 scrap, $0.45 a unit', () => {
    expect(standardMaterial({ unitsGood: 3000, unitsScrap: 60, materialCostPerUnit: '0.4500' })).toEqual({ stdMaterialCents: b(137700), stdScrapCents: b(2700) });
  });
  it('costs nothing when the client supplies everything', () => {
    expect(standardMaterial({ unitsGood: 3000, unitsScrap: 60, materialCostPerUnit: 0 })).toEqual({ stdMaterialCents: b(0), stdScrapCents: b(0) });
    expect(standardMaterial({ unitsGood: 3000, materialCostPerUnit: null })).toEqual({ stdMaterialCents: b(0), stdScrapCents: b(0) });
    expect(standardMaterial({ unitsGood: 0, unitsScrap: 0, materialCostPerUnit: '1.25' }).stdMaterialCents).toBe(b(0));
  });
  it('costs actual usage rows we pay for, and nothing for client parts', () => {
    expect(actualMaterial({ quantityUsed: 500, quantityScrapped: 20, unitCost: '0.0350', suppliedBy: 'us' })).toEqual({ costCents: b(1820), scrapCents: b(70) });
    expect(actualMaterial({ quantityUsed: 500, quantityScrapped: 20, unitCost: '0.0350', suppliedBy: 'client' })).toEqual({ costCents: b(0), scrapCents: b(0) });
    expect(actualMaterial({ quantityUsed: '12.5', unitCost: '3.3333', suppliedBy: 'us' })).toEqual({ costCents: b(4167), scrapCents: b(0) });
  });
  it('resolves who buys the parts down the chain', () => {
    expect(resolvePartsOwner({ row: 'client', item: 'us', orgDefault: 'us' })).toBe('client');
    expect(resolvePartsOwner({ row: null, item: 'us', job: 'client', orgDefault: 'client' })).toBe('us');
    expect(resolvePartsOwner({ job: 'client', client: 'us', orgDefault: 'us' })).toBe('client');
    expect(resolvePartsOwner({ client: 'client', orgDefault: 'us' })).toBe('client');
    expect(resolvePartsOwner({ orgDefault: 'us' })).toBe('us');
  });
  it('adds up material still to buy from planned quantities', () => {
    const rows = [
      { quantityPlanned: 1000, quantityUsed: 400, quantityScrapped: 10, unitCost: '0.50', suppliedBy: 'us' as const },
      { quantityPlanned: 100, quantityUsed: 150, unitCost: '2', suppliedBy: 'us' as const },
      { quantityPlanned: 1000, quantityUsed: 0, unitCost: '9', suppliedBy: 'client' as const },
      { quantityPlanned: null, quantityUsed: 5, unitCost: '9', suppliedBy: 'us' as const },
    ];
    expect(materialLeftFromUsage(rows)).toBe(b(29500));
    expect(materialLeftFromUsage([{ quantityPlanned: null, quantityUsed: 5, unitCost: '9', suppliedBy: 'us' }])).toBeNull();
    expect(materialLeftFromUsage([])).toBeNull();
  });
  it('measures scrap', () => {
    expect(scrapRateBp(b(9000), b(190000))).toBe(474);
    expect(scrapRateBp(b(0), b(0))).toBeNull();
    expect(scrapUnitsBp(3000, 60)).toBe(196);
    expect(scrapUnitsBp(0, 0)).toBeNull();
  });
});

describe('revenue (4.8)', () => {
  it('earns per unit at the price in force', () => {
    expect(perUnitRevenue(3000, '2.7500')).toBe(b(825000));
    expect(perUnitRevenue(3000, null)).toBe(b(0));
    expect(perUnitRevenue(0, '2.75')).toBe(b(0));
    const prices = [
      { effectiveFrom: '0001-01-01', unitPrice: '2.75' },
      { effectiveFrom: '2026-11-10', unitPrice: '2.95' },
    ];
    expect(priceFor(prices, '2026-11-09')?.unitPrice).toBe('2.75');
    expect(priceFor(prices, '2026-11-10')?.unitPrice).toBe('2.95');
    expect(priceFor([{ effectiveFrom: '2026-11-10' }], '2026-11-09')).toBeNull();
  });
  it('earns hourly jobs by hours times the bill rate', () => {
    expect(hourlyRevenue('7.50', 4500)).toBe(b(33750));
    expect(hourlyRevenue('7.50', null)).toBe(b(0));
  });

  const entries: FixedEntry[] = [
    { id: 'e1', workDate: '2026-11-02', unitsGood: 500 },
    { id: 'e2', workDate: '2026-11-03', unitsGood: 700 },
    { id: 'e3', workDate: '2026-11-04', unitsGood: 900 },
  ];
  it('matches the fixed price example', () => {
    const stamps = fixedRevenueStamps(entries, 940000, 2000);
    expect(stamps.map((stamp) => stamp.targetCents)).toEqual([b(235000), b(564000), b(940000)]);
    expect(stamps.map((stamp) => stamp.stampCents)).toEqual([b(235000), b(329000), b(376000)]);
    expect(fixedTrueUp(940000, stamps)).toBe(b(0));
  });
  it('trues up a job completed after the second entry', () => {
    const stamps = fixedRevenueStamps(entries.slice(0, 2), 940000, 2000);
    expect(fixedTrueUp(940000, stamps)).toBe(b(376000));
  });
  it('earns nothing with no planned units, and the true up carries the whole price', () => {
    const stamps = fixedRevenueStamps(entries, 940000, 0);
    expect(stamps.every((stamp) => stamp.stampCents === b(0))).toBe(true);
    expect(fixedTrueUp(940000, stamps)).toBe(b(940000));
    expect(fixedTarget(940000, 500, 0)).toBe(b(0));
    expect(fixedRevenueStamps(entries, null, null).every((stamp) => stamp.stampCents === b(0))).toBe(true);
  });
  it('caps earned revenue at the plan when more is made', () => {
    expect(fixedTarget(940000, 2600, 2000)).toBe(b(940000));
    expect(fixedTarget(940000, 500, 2000)).toBe(b(235000));
  });
  it('never rewrites a frozen stamp: the catch up lands in the next open entry', () => {
    // planned units were raised from 2,000 to 4,000 after the first entry's month closed
    const stamps = fixedRevenueStamps([{ ...entries[0], frozenStampCents: 235000 } as FixedEntry, entries[1] as FixedEntry, entries[2] as FixedEntry], 940000, 4000);
    expect(stamps[0]).toMatchObject({ stampCents: b(235000), frozen: true, targetCents: b(117500) });
    expect(stamps[1]?.stampCents).toBe(b(47000)); // target 282000 minus 235000 already stamped
    expect(stamps[2]?.stampCents).toBe(b(211500));
    expect(stamps.reduce((sum, stamp) => sum + stamp.stampCents, b(0))).toBe(b(493500));
  });
  it('can stamp a negative catch up', () => {
    const stamps = fixedRevenueStamps([{ ...entries[0], frozenStampCents: 400000 } as FixedEntry, { id: 'e2', workDate: '2026-11-03', unitsGood: 10 }], 940000, 4000);
    expect(stamps[1]?.stampCents).toBe(b(-280150));
  });
  it('sorts by work date, shift, labor class code, then id', () => {
    const mixed: FixedEntry[] = [
      { id: '4', workDate: '2026-11-03', shift: 'day', laborClassCode: 'PACK', unitsGood: 1 },
      { id: '3', workDate: '2026-11-02', shift: 'night', laborClassCode: 'PACK', unitsGood: 1 },
      { id: '2', workDate: '2026-11-02', shift: 'day', laborClassCode: 'TEMP', unitsGood: 1 },
      { id: '1', workDate: '2026-11-02', shift: 'day', laborClassCode: 'PACK', unitsGood: 1 },
      { id: '0', workDate: '2026-11-02', shift: 'day', laborClassCode: 'PACK', unitsGood: 1 },
    ];
    expect(sortFixedEntries(mixed).map((entry) => entry.id)).toEqual(['0', '1', '2', '3', '4']);
  });
  it('holds the property: stamps add up to the last target, and stamps plus true up equal the fixed price', () => {
    let seed = 20261117;
    const next = (max: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % max;
    };
    for (let round = 0; round < 200; round += 1) {
      const fixedPrice = 1 + next(5_000_000);
      const planned = next(4) === 0 ? 0 : 1 + next(9000);
      const count = next(9);
      const list: FixedEntry[] = Array.from({ length: count }, (_, index) => ({
        id: `e${index}`,
        workDate: `2026-11-${String(1 + next(28)).padStart(2, '0')}`,
        shift: next(2) === 0 ? 'day' : 'night',
        unitsGood: `${next(3000)}.${String(next(1000)).padStart(3, '0')}`,
      }));
      const stamps = fixedRevenueStamps(list, fixedPrice, planned);
      const sum = stamps.reduce((total, stamp) => total + stamp.stampCents, b(0));
      const last = stamps[stamps.length - 1];
      expect(sum).toBe(last ? last.targetCents : b(0));
      expect(sum + fixedTrueUp(fixedPrice, stamps)).toBe(b(fixedPrice));
      expect(sum <= b(fixedPrice)).toBe(true);
    }
  });
  it('prices a service entry, or leaves it with no price', () => {
    expect(serviceAmount({ quantity: 1200, unitPrice: '0.35' })).toBe(b(42000));
    expect(serviceAmount({ quantity: 1200, unitPrice: '0.35', flatAmountCents: 50000 })).toBe(b(50000));
    expect(serviceAmount({ quantity: 1200 })).toBeNull();
    expect(serviceAmount({ quantity: 1200, unitPrice: '' })).toBeNull();
  });
  it('keeps billed apart from earned', () => {
    expect(revenueTotals({ baseCents: 700000, serviceCents: 42000, otherCents: -5000, billedCents: 500000 })).toEqual({ revenueCents: b(737000), billedCents: b(500000), notBilledYetCents: b(237000) });
    expect(revenueTotals({ baseCents: 700000 }).notBilledYetCents).toBe(b(700000));
  });
});

describe('cost, profit, margin and the company bridge (4.9)', () => {
  const buckets = { revenueCents: b(700000), laborCents: b(287500), materialCents: b(190000), otherCents: b(40000), sharedCents: b(26000) };
  it('rolls the buckets up into every headline number', () => {
    const summary = profitSummary(buckets, 4000);
    expect(summary.costCents).toBe(b(543500));
    expect(summary.profitCents).toBe(b(156500));
    expect(summary.marginBp).toBe(2236);
    expect(summary.profitBeforeSharedCents).toBe(b(182500));
    expect(summary.marginBeforeSharedBp).toBe(2607);
    expect(summary.laborPctOfRevenueBp).toBe(4107);
    expect(summary.costPerUnitCents).toBe(b(136));
    expect(summary.profitPerUnitCents).toBe(b(39));
    expect(summary.revenuePerUnitCents).toBe(b(175));
    expect(summary.laborCostPerUnitCents).toBe(b(72));
    expect(summary.marginGap).toBeNull();
  });
  it('shows no number, not zero, with zero units or no revenue', () => {
    const noUnits = profitSummary(buckets, 0);
    expect(noUnits.costPerUnitCents).toBeNull();
    expect(noUnits.profitPerUnitCents).toBeNull();
    const noRevenue = profitSummary({ ...buckets, revenueCents: b(0) });
    expect(noRevenue.marginBp).toBeNull();
    expect(noRevenue.marginBeforeSharedBp).toBeNull();
    expect(noRevenue.laborPctOfRevenueBp).toBeNull();
    expect(noRevenue.marginGap).toBe('no_revenue');
    expect(marginGapLabel(noRevenue.marginGap)).toBe('No revenue yet');
    expect(marginGapLabel(profitSummary({ ...buckets, revenueCents: b(-100) }).marginGap)).toBe('Revenue is below zero');
    expect(marginGapLabel(null)).toBeNull();
  });
  it('reports a negative margin for a losing job', () => {
    const summary = profitSummary({ ...buckets, revenueCents: b(500000) }, 4000);
    expect(summary.profitCents).toBe(b(-43500));
    expect(summary.marginBp).toBe(-870);
    expect(summary.profitPerUnitCents).toBe(b(-11));
  });
  it('sums facts by kind and leaves billed memo rows out of revenue', () => {
    const totals = sumFacts([
      { kind: 'revenue_base', amountCents: 700000 },
      { kind: 'revenue_vas', amountCents: 42000 },
      { kind: 'revenue_other', amountCents: -5000 },
      { kind: 'labor', amountCents: 287500 },
      { kind: 'material', amountCents: 190000 },
      { kind: 'other', amountCents: 40000 },
      { kind: 'shared', amountCents: 26000 },
      { kind: 'billed_memo', amountCents: 500000 },
    ]);
    expect(totals.revenueCents).toBe(b(737000));
    expect(totals.billedCents).toBe(b(500000));
    expect(profitSummary(totals).profitCents).toBe(b(193500));
    expect(addBuckets([buckets, buckets]).revenueCents).toBe(b(1400000));
    expect(addBuckets([])).toEqual({ revenueCents: b(0), laborCents: b(0), materialCents: b(0), otherCents: b(0), sharedCents: b(0) });
  });
  it('matches the company bridge example', () => {
    const bridge = companyBridge({ workProfitCents: 4821000, sharedGapCents: 115000, missingCents: 236000, companyCostCents: 2100000, overheadAbsorbedCents: 1620000, rule: 'by_labor_hours' });
    expect(bridge.overheadGapCents).toBe(b(480000));
    expect(bridge.companyProfitCents).toBe(b(3990000));
    expect(bridge.lines.map((line) => line.key)).toEqual(['work_profit', 'shared_gap', 'missing_time', 'overhead_gap', 'company_profit']);
    const walk = bridge.lines.slice(0, -1).reduce((sum, line) => sum + line.amountCents, b(0));
    expect(walk).toBe(bridge.companyProfitCents);
  });
  it('hides the overhead line with no company costs, and counts missing time once under the full rule', () => {
    const trusting = companyBridge({ workProfitCents: 4821000, sharedGapCents: 115000, missingCents: 236000, companyCostCents: 0, overheadAbsorbedCents: 1620000, rule: 'by_labor_hours' });
    expect(trusting.showsOverheadGap).toBe(false);
    expect(trusting.overheadGapCents).toBe(b(0));
    expect(trusting.companyProfitCents).toBe(b(4470000));
    expect(trusting.lines.some((line) => line.key === 'overhead_gap')).toBe(false);
    const full = companyBridge({ workProfitCents: 4821000, sharedGapCents: 0, missingCents: 236000, companyCostCents: 0, overheadAbsorbedCents: 0, rule: 'full' });
    expect(full.missingCents).toBe(b(0));
    expect(full.companyProfitCents).toBe(b(4821000));
  });
  it('gives a part month its share of company costs by day, and the parts add back to the month', () => {
    const month = [{ month: '2026-11-01', monthCostCents: 7050000, overheadAbsorbedCents: 2000000 }];
    const toDate = spreadCompanyCosts(month, '2026-11-01', '2026-11-18');
    expect(toDate.companyCostCents).toBe(b(4230000));
    expect(toDate.note).toBe('Company costs for 18 of 30 days.');
    expect(toDate.partial).toBe(true);
    const rest = spreadCompanyCosts(month, '2026-11-19', '2026-11-30');
    expect(toDate.companyCostCents + rest.companyCostCents).toBe(b(7050000));
    const whole = spreadCompanyCosts(month, '2026-11-01', '2026-11-30');
    expect(whole).toMatchObject({ companyCostCents: b(7050000), partial: false, note: null, countsOverhead: true });
    // An amount that does not divide: every split of a 31 day month still adds back to the cent.
    for (let day = 1; day < 31; day += 1) {
      const odd = [{ month: '2026-10-01', monthCostCents: 1000001, overheadAbsorbedCents: 0 }];
      const a = spreadCompanyCosts(odd, '2026-10-01', `2026-10-${String(day).padStart(2, '0')}`);
      const z = spreadCompanyCosts(odd, `2026-10-${String(day + 1).padStart(2, '0')}`, '2026-10-31');
      expect(a.companyCostCents + z.companyCostCents).toBe(b(1000001));
    }
  });
  it('names each month in a range across months, and leaves out a month with no company costs', () => {
    const across = spreadCompanyCosts(
      [
        { month: '2026-10-01', monthCostCents: 7050000, overheadAbsorbedCents: 300000 },
        { month: '2026-11-01', monthCostCents: 7050000, overheadAbsorbedCents: 400000 },
      ],
      '2026-10-20',
      '2026-11-18',
    );
    // 12 of 31 days of October: 7050000 - divRound(7050000 * 19, 31) = 7050000 - 4320968 = 2729032.
    expect(across.parts.map((part) => part.countedCents)).toEqual([b(2729032), b(4230000)]);
    expect(across.overheadAbsorbedCents).toBe(b(700000));
    expect(across.note).toBe('Company costs for 12 of 31 days in October and 18 of 30 days in November.');
    const oneSided = spreadCompanyCosts([{ month: '2026-10-01', monthCostCents: 7050000, overheadAbsorbedCents: 300000 }, { month: '2026-11-01', monthCostCents: 0, overheadAbsorbedCents: 400000 }], '2026-10-01', '2026-11-30');
    expect(oneSided.companyCostCents).toBe(b(7050000));
    expect(oneSided.overheadAbsorbedCents).toBe(b(300000));
    expect(oneSided.note).toBe('No company costs are typed in for November, so that month trusts the overhead in your hourly rates.');
    const none = spreadCompanyCosts([], '2026-11-10', '2026-11-16');
    expect(none).toMatchObject({ countsOverhead: false, partial: false, note: null, companyCostCents: b(0) });
    const acrossYears = spreadCompanyCosts([{ month: '2026-12-01', monthCostCents: 3100, overheadAbsorbedCents: 0 }, { month: '2027-01-01', monthCostCents: 3100, overheadAbsorbedCents: 0 }], '2026-12-22', '2027-01-31');
    expect(acrossYears.note).toBe('Company costs for 10 of 31 days in December 2026 and all of January 2027.');
    expect(acrossYears.companyCostCents).toBe(b(1000 + 3100));
  });
  it('keeps the overhead step when a counted share rounds to zero', () => {
    const spread = spreadCompanyCosts([{ month: '2026-11-01', monthCostCents: 1, overheadAbsorbedCents: 500 }], '2026-11-01', '2026-11-01');
    expect(spread.companyCostCents).toBe(b(0));
    const bridge = companyBridge({ workProfitCents: 1000, sharedGapCents: 0, missingCents: 0, companyCostCents: spread.companyCostCents, overheadAbsorbedCents: spread.overheadAbsorbedCents, countsOverhead: spread.countsOverhead, rule: 'none' });
    expect(bridge.showsOverheadGap).toBe(true);
    expect(bridge.overheadGapCents).toBe(b(-500));
  });
  it('adds to profit when the hourly rate covered more overhead than was spent', () => {
    const bridge = companyBridge({ workProfitCents: 1000000, sharedGapCents: 0, missingCents: 0, companyCostCents: 1500000, overheadAbsorbedCents: 1620000, rule: 'none' });
    expect(bridge.overheadGapCents).toBe(b(-120000));
    expect(bridge.companyProfitCents).toBe(b(1120000));
    expect(bridge.lines.find((line) => line.key === 'overhead_gap')?.label).toBe('Your hourly rate covered more overhead than you spent');
  });
});
