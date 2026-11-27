/** Plan vs actual, the variance waterfall, pace, the projection and risk: sections 4.10 to 4.14 of the spec. */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RISK_THRESHOLDS,
  NEXT_STEP_LABELS,
  RISK_RULES,
  type ActualTotals,
  type PaceRow,
  type PlanLine,
  type PlanTotals,
  type ProjectionInput,
  type RiskInput,
  assessRisk,
  biggestDrag,
  biggestLift,
  daysMissingHours,
  earnedHours,
  evidenceDayCount,
  factorBp,
  flexFactor,
  flexPlan,
  jobMode,
  laborCostPerUnit,
  lastEvidenceWindow,
  paceDays,
  paceOverall,
  pickStandard,
  planFigures,
  planSharedAuto,
  planTotalsFromLines,
  planVsActual,
  productivityBp,
  projectJob,
  projectionNote,
  quoteLinesVsActual,
  quoteToBudget,
  riskHeadline,
  riskSentence,
  riskSentences,
  ruleStatus,
  shouldCostPerUnit,
  sumWaterfalls,
  targetMarginBp,
  targetPace,
  unitsPerHour,
  varianceReading,
  varianceWaterfall,
} from './index';

const b = (n: number | string): bigint => BigInt(n);
const NO_LONG_DASH = /[‒-―]|--/;

/** The job from 4.11 and 4.13. */
const BUDGET: PlanTotals = { units: 10000, revenueCents: b(1750000), laborHours: 250, laborCents: b(550000), materialCents: b(450000), sharedCents: b(50000), otherCents: b(100000) };
const ACTUAL: ActualTotals = { unitsGood: 4000, hours: 125, revenueCents: b(700000), laborCents: b(287500), materialCents: b(190000), scrapCents: b(9000), sharedCents: b(26000), otherCents: b(40000) };
const PROJECTION_INPUT: ProjectionInput = {
  status: 'active',
  kind: 'one_time',
  pricingModel: 'per_unit',
  plannedUnits: 10000,
  plan: BUDGET,
  actual: ACTUAL,
  window: { days: 5, unitsGood: 1600, paceHours: '50.00', hours: '50.00', laborCostCents: b(115000) },
  evidenceDays: 5,
  targetPace: 40,
  unitPrice: '1.75',
  today: '2026-11-17',
};

describe('plan vs actual (4.10)', () => {
  it('flexes the plan to the work done so far', () => {
    const factor = flexFactor(BUDGET, ACTUAL);
    expect(factor.basis).toBe('units');
    expect(factorBp(factor)).toBe(4000);
    const flexed = flexPlan(BUDGET, factor);
    expect(flexed.units).toBe(4000);
    expect(flexed.revenueCents).toBe(b(700000));
    expect(flexed.laborHours).toBe(100);
    expect(flexed.laborCents).toBe(b(220000));
    expect(flexed.materialCents).toBe(b(180000));
    expect(flexed.sharedCents).toBe(b(20000));
    expect(flexed.otherCents).toBe(b(100000)); // other cost does not flex
    expect(flexed.profitCents).toBe(b(180000));
  });
  it('does not flex setup hours or setup cost', () => {
    const plan: PlanTotals = { ...BUDGET, setupHours: 50, setupCents: b(110000) };
    const flexed = flexPlan(plan, flexFactor(plan, ACTUAL));
    expect(flexed.laborHours).toBe(130); // 50 + 200 x 0.4
    expect(flexed.laborCents).toBe(b(286000)); // 1,100 + 4,400 x 0.4
    expect(flexed.setupHours).toBe(50);
  });
  it('uses hours when the plan has no units, and the whole plan with neither', () => {
    const hourly: PlanTotals = { units: 0, revenueCents: b(900000), laborHours: 200, laborCents: b(440000), materialCents: b(0), otherCents: b(0) };
    const factor = flexFactor(hourly, { unitsGood: 0, hours: 50 });
    expect(factor.basis).toBe('hours');
    expect(flexPlan(hourly, factor).revenueCents).toBe(b(225000));
    const empty: PlanTotals = { units: null, revenueCents: b(900000), laborHours: null, laborCents: null, materialCents: null, otherCents: null };
    expect(flexFactor(empty, ACTUAL).basis).toBe('whole');
    expect(flexPlan(empty, flexFactor(empty, ACTUAL)).revenueCents).toBe(b(900000));
  });
  it('lets the share done go above 1 on over production', () => {
    const over = { ...ACTUAL, unitsGood: 12000 };
    expect(factorBp(flexFactor(BUDGET, over))).toBe(12000);
    expect(flexPlan(BUDGET, flexFactor(BUDGET, over)).revenueCents).toBe(b(2100000));
  });
  it('builds the eleven rows with difference, percent and tone', () => {
    const table = planVsActual({ plan: BUDGET, actual: ACTUAL });
    expect(table.basis).toBe('so_far');
    expect(table.planLabel).toBe('For the work done so far');
    expect(table.rows.map((row) => row.key)).toEqual(['units', 'labor_hours', 'uph', 'labor', 'material', 'other', 'shared', 'cost', 'revenue', 'profit', 'margin']);
    const row = (key: string) => table.rows.find((candidate) => candidate.key === key);
    expect(row('units')).toMatchObject({ plan: 4000, actual: 4000, difference: 0, tone: 'neutral' });
    expect(row('labor_hours')).toMatchObject({ plan: 100, actual: 125, difference: 25, differencePctBp: 2500, tone: 'bad' });
    expect(row('uph')).toMatchObject({ plan: 40, actual: 32, difference: -8, differencePctBp: -2000, tone: 'bad' });
    expect(row('labor')).toMatchObject({ plan: b(220000), actual: b(287500), difference: b(67500), differencePctBp: 3068, tone: 'bad' });
    expect(row('material')).toMatchObject({ difference: b(10000), tone: 'bad' });
    expect(row('other')).toMatchObject({ plan: b(100000), actual: b(40000), difference: b(-60000), differencePctBp: -6000, tone: 'good' });
    expect(row('shared')).toMatchObject({ label: 'Time not on a job', difference: b(6000), tone: 'bad' });
    expect(row('cost')).toMatchObject({ plan: b(520000), actual: b(543500), tone: 'bad' });
    expect(row('revenue')).toMatchObject({ difference: b(0), differencePctBp: 0, tone: 'neutral' });
    expect(row('profit')).toMatchObject({ plan: b(180000), actual: b(156500), difference: b(-23500), tone: 'bad' });
    expect(row('margin')).toMatchObject({ plan: 2571, actual: 2236, difference: -335, differencePctBp: null, tone: 'bad' });
  });
  it('compares with the whole job on request, and fills the projected column', () => {
    const projection = projectJob(PROJECTION_INPUT);
    const table = planVsActual({ plan: BUDGET, actual: ACTUAL, basis: 'whole', projected: projection.atFinish });
    expect(table.planLabel).toBe('Whole job');
    const row = (key: string) => table.rows.find((candidate) => candidate.key === key);
    expect(row('units')).toMatchObject({ plan: 10000, actual: 4000, projected: 10000, tone: 'bad' });
    expect(row('labor_hours')).toMatchObject({ plan: 250, projected: 312.5, tone: 'good' });
    expect(row('cost')).toMatchObject({ projected: b(1358750) });
    expect(row('revenue')).toMatchObject({ projected: b(1750000) });
    expect(row('profit')).toMatchObject({ projected: b(391250) });
    expect(row('margin')).toMatchObject({ projected: 2236 });
  });
  it('shows actuals alone when the job has no quote and no budget', () => {
    const table = planVsActual({ plan: null, actual: ACTUAL });
    expect(table.plan).toBeNull();
    expect(table.rows.every((row) => row.plan === null && row.difference === null && row.tone === 'neutral')).toBe(true);
    expect(table.rows.find((row) => row.key === 'profit')?.actual).toBe(b(156500));
  });
  it('has no percent when the plan is zero, and no pace with zero hours', () => {
    const plan: PlanTotals = { units: 100, revenueCents: b(10000), laborHours: 0, laborCents: b(0), materialCents: b(0), otherCents: b(0) };
    const table = planVsActual({ plan, actual: { unitsGood: 100, hours: 0, revenueCents: b(10000), laborCents: b(500), materialCents: b(0), otherCents: b(0), sharedCents: b(0) }, basis: 'whole' });
    const row = (key: string) => table.rows.find((candidate) => candidate.key === key);
    expect(row('labor')).toMatchObject({ differencePctBp: null, tone: 'bad' });
    expect(row('uph')).toMatchObject({ plan: null, actual: null, difference: null });
  });
  it('prefers pace from counted days when it is passed in', () => {
    const table = planVsActual({ plan: BUDGET, actual: { ...ACTUAL, uph: 36.5 } });
    expect(table.rows.find((row) => row.key === 'uph')?.actual).toBe(36.5);
    const none = planVsActual({ plan: BUDGET, actual: { ...ACTUAL, uph: null } });
    expect(none.rows.find((row) => row.key === 'uph')?.actual).toBeNull();
  });
  it('adds plan lines up into totals', () => {
    const lines: PlanLine[] = [
      { category: 'revenue', quantity: 10000, unit: 'unit', unitAmount: '1.75', amountCents: 1750000 },
      { category: 'revenue', quantity: 1, unit: 'flat', amountCents: 25000 },
      { category: 'setup', quantity: 10, unit: 'hour', amountCents: 22000 },
      { category: 'labor', quantity: 240, unit: 'hour', amountCents: 528000 },
      { category: 'material', quantity: 10000, unit: 'each', amountCents: 450000 },
      { category: 'other', amountCents: 100000 },
    ];
    expect(planTotalsFromLines(lines, b(50000))).toEqual({
      units: 10000,
      revenueCents: b(1775000),
      laborHours: 250,
      laborCents: b(550000),
      setupHours: 10,
      setupCents: b(22000),
      materialCents: b(450000),
      otherCents: b(100000),
      sharedCents: b(50000),
    });
  });
  it('fills plan shared cost by the org rule', () => {
    expect(planSharedAuto({ rule: 'percent_of_labor', laborCents: 550000, sharedPctBp: 800 })).toBe(b(44000));
    expect(planSharedAuto({ rule: 'by_labor_hours', laborCents: 550000, shared90Cents: 364000, labor90Cents: 4550000 })).toBe(b(44000));
    expect(planSharedAuto({ rule: 'full', laborCents: 550000, shared90Cents: 364000, labor90Cents: 0 })).toBe(b(0));
    expect(planSharedAuto({ rule: 'none', laborCents: 550000, sharedPctBp: 800 })).toBe(b(0));
  });
  it('works out should cost per unit from the flexed plan', () => {
    expect(shouldCostPerUnit(BUDGET, ACTUAL)).toBe(b(130));
    expect(shouldCostPerUnit(BUDGET, { unitsGood: 0, hours: 0 })).toBeNull();
    expect(planFigures(BUDGET).costCents).toBe(b(1150000));
  });
  it('matches quote lines to actual money, and the actual column adds up', () => {
    const lines: PlanLine[] = [
      { category: 'labor', description: 'Packers', laborClass: 'PACK', quantity: 200, amountCents: 400000 },
      { category: 'labor', description: 'Lead', laborClass: 'LEAD', quantity: 50, amountCents: 150000 },
      { category: 'material', description: 'Boxes', itemSku: 'BOX-12', amountCents: 300000 },
      { category: 'material', description: 'Other supplies', amountCents: 100000 },
      { category: 'material', description: 'Tape', amountCents: 50000 },
      { category: 'other', description: 'Freight', amountCents: 100000 },
      { category: 'revenue', description: 'Kits', quantity: 10000, amountCents: 1750000 },
    ];
    const rows = quoteLinesVsActual(lines, [
      { category: 'labor', laborClass: 'pack', amountCents: 430000 },
      { category: 'labor', laborClass: 'TEMP', amountCents: 20000 },
      { category: 'labor', laborClass: 'LEAD', amountCents: 140000 },
      { category: 'material', itemSku: 'box-12', amountCents: 310000 },
      { category: 'material', itemSku: 'LABEL', amountCents: 90001 },
      { category: 'other', amountCents: 40000 },
      { category: 'revenue', amountCents: 1750000 },
    ]);
    expect(rows[0]).toMatchObject({ matchedBy: 'labor_class', quotedQuantity: 200, tone: 'bad' });
    // the temp labor matches no line and no open labor line exists, so it is shared by quoted amount
    expect(rows[0]?.actualCents).toBe(b(444545));
    expect(rows[1]?.actualCents).toBe(b(145455));
    expect(rows[2]).toMatchObject({ matchedBy: 'item', actualCents: b(310000), differenceCents: b(10000), tone: 'bad' });
    expect(rows[3]).toMatchObject({ matchedBy: 'category', actualCents: b(60001), tone: 'good' });
    expect(rows[4]).toMatchObject({ actualCents: b(30000) });
    expect(rows[5]).toMatchObject({ actualCents: b(40000), differencePctBp: -6000, tone: 'good' });
    expect(rows[6]).toMatchObject({ actualCents: b(1750000), tone: 'neutral' });
    expect(rows.reduce((sum, row) => sum + row.actualCents, b(0))).toBe(b(2780001));
  });
  it('shows the gap between the quote and the budget', () => {
    const quote: PlanTotals = { ...BUDGET, laborCents: b(500000), laborHours: 230 };
    const strip = quoteToBudget(quote, BUDGET);
    expect(strip.rows.find((row) => row.key === 'labor')).toMatchObject({ quoteCents: b(500000), budgetCents: b(550000), gapCents: b(50000), tone: 'bad' });
    expect(strip.rows.find((row) => row.key === 'profit')).toMatchObject({ gapCents: b(-50000), tone: 'bad' });
    expect(strip.rows.find((row) => row.key === 'revenue')).toMatchObject({ gapCents: b(0), tone: 'neutral' });
    expect(strip.quoteMarginBp).toBe(3714);
    expect(strip.budgetMarginBp).toBe(3429);
    expect(strip.marginGapBp).toBe(-285);
  });
});

describe('why profit changed (4.11)', () => {
  const amounts = (waterfall: { bars: { key: string; amountCents: bigint }[] }): Record<string, bigint> => Object.fromEntries(waterfall.bars.map((bar) => [bar.key, bar.amountCents]));
  it('matches the worked example, so far', () => {
    const waterfall = varianceWaterfall({ plan: BUDGET, actual: ACTUAL });
    expect(waterfall.startCents).toBe(b(180000));
    expect(waterfall.endCents).toBe(b(156500));
    expect(waterfall.totalCents).toBe(b(-23500));
    expect(amounts(waterfall)).toEqual({ price: b(0), labor_rate: b(-12500), labor_efficiency: b(-55000), scrap: b(-9000), material: b(-1000), shared: b(-6000), other: b(60000) });
    expect(waterfall.hoursOverPlan).toBe(25);
    expect(waterfall.planRateCents).toBe(b(2200));
  });
  it('adds a volume bar for a completed job and still adds up', () => {
    const waterfall = varianceWaterfall({ plan: BUDGET, actual: ACTUAL, mode: 'whole_job' });
    expect(waterfall.startCents).toBe(b(600000));
    expect(waterfall.bars[0]).toMatchObject({ key: 'volume', amountCents: b(-420000) });
    expect(waterfall.totalCents).toBe(b(-443500));
    expect(waterfall.bars.reduce((sum, bar) => sum + bar.amountCents, b(0))).toBe(waterfall.totalCents);
  });
  it('explains the projection at finish', () => {
    const projection = projectJob(PROJECTION_INPUT);
    const waterfall = varianceWaterfall({ plan: BUDGET, actual: projection.atFinish, mode: 'at_finish' });
    expect(waterfall.startCents).toBe(b(600000));
    expect(waterfall.endCents).toBe(b(391250));
    expect(amounts(waterfall).volume).toBe(b(0)); // the projection finishes the planned units
    expect(amounts(waterfall).labor_efficiency).toBe(b(-137500)); // 62.5 hours x $22.00
    expect(waterfall.bars.reduce((sum, bar) => sum + bar.amountCents, b(0))).toBe(b(-208750));
  });
  it('puts all labor variance in efficiency when either side has zero hours', () => {
    const noPlanHours = varianceWaterfall({ plan: { ...BUDGET, laborHours: 0, laborCents: b(0) }, actual: ACTUAL });
    expect(amounts(noPlanHours).labor_rate).toBe(b(0));
    expect(amounts(noPlanHours).labor_efficiency).toBe(b(-287500));
    expect(noPlanHours.planRateCents).toBeNull();
    const noActualHours = varianceWaterfall({ plan: BUDGET, actual: { ...ACTUAL, hours: 0, laborCents: b(0) } });
    expect(amounts(noActualHours).labor_rate).toBe(b(0));
    expect(amounts(noActualHours).labor_efficiency).toBe(b(220000));
  });
  it('always adds up exactly, for any numbers', () => {
    let seed = 7;
    const next = (max: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % max;
    };
    for (let round = 0; round < 300; round += 1) {
      const plan: PlanTotals = {
        units: next(5) === 0 ? 0 : next(20000),
        revenueCents: b(next(5_000_000)),
        laborHours: next(5) === 0 ? 0 : `${next(900)}.${String(next(100)).padStart(2, '0')}`,
        laborCents: b(next(2_000_000)),
        setupHours: next(3) === 0 ? next(20) : 0,
        setupCents: b(next(3) === 0 ? next(40000) : 0),
        materialCents: b(next(1_500_000)),
        otherCents: b(next(300_000)),
        sharedCents: b(next(100_000)),
      };
      const material = next(1_500_000);
      const actual: ActualTotals = {
        unitsGood: `${next(25000)}.${String(next(1000)).padStart(3, '0')}`,
        hours: next(6) === 0 ? 0 : `${next(1200)}.${String(next(100)).padStart(2, '0')}`,
        revenueCents: b(next(6_000_000) - 500_000),
        laborCents: b(next(2_500_000)),
        materialCents: b(material),
        scrapCents: b(next(material + 1)),
        otherCents: b(next(400_000) - 50_000),
        sharedCents: b(next(150_000)),
      };
      for (const mode of ['so_far', 'at_finish', 'whole_job'] as const) {
        const waterfall = varianceWaterfall({ plan, actual, mode });
        const sum = waterfall.bars.reduce((total, bar) => total + bar.amountCents, b(0));
        expect(sum).toBe(waterfall.totalCents);
        expect(waterfall.startCents + sum).toBe(waterfall.endCents);
      }
    }
  });
  it('sums jobs bar by bar for a client or a month', () => {
    const one = varianceWaterfall({ plan: BUDGET, actual: ACTUAL });
    const two = varianceWaterfall({ plan: BUDGET, actual: { ...ACTUAL, revenueCents: b(720000) } });
    const sum = sumWaterfalls([one, two]);
    expect(sum.jobCount).toBe(2);
    expect(sum.totalCents).toBe(b(-27000));
    expect(sum.bars.find((bar) => bar.key === 'price')?.amountCents).toBe(b(20000));
    expect(sum.bars.reduce((total, bar) => total + bar.amountCents, b(0))).toBe(sum.totalCents);
    expect(sumWaterfalls([])).toEqual({ startCents: b(0), endCents: b(0), totalCents: b(0), bars: [], jobCount: 0 });
  });
  it('reads each bar in plain words, with and without money', () => {
    const waterfall = varianceWaterfall({ plan: BUDGET, actual: ACTUAL, mode: 'whole_job' });
    const read = (key: string, seesMoney = true): string => varianceReading(waterfall.bars.find((bar) => bar.key === key) as never, waterfall, { seesMoney });
    expect(read('labor_efficiency')).toBe('Labor efficiency: the crew needed 25 more hours than planned for this many units. That cost $550.');
    expect(read('labor_efficiency', false)).toBe('Labor efficiency: the crew needed 25 more hours than planned for this many units.');
    expect(read('labor_rate')).toBe('Labor rate: an hour cost more than planned. That cost $125.');
    expect(read('scrap')).toBe('Scrap: $90 of material was scrapped.');
    expect(read('scrap', false)).toBe('Scrap: some material was scrapped.');
    expect(read('material')).toBe('Material: parts for good units cost more than planned. That cost $10.');
    expect(read('shared')).toBe('Time not on a job: this job carried more meetings, cleanup and waiting than planned. That cost $60.');
    expect(read('other')).toBe('Other: other costs, fees and extra services came in better than planned. That saved $600.');
    expect(read('price')).toBe('Price: revenue matched the plan for this many units.');
    expect(read('volume')).toBe('Volume: the job made fewer units than planned. That took away $4,200.');
    for (const bar of waterfall.bars) {
      expect(varianceReading(bar, waterfall)).not.toMatch(NO_LONG_DASH);
      expect(varianceReading({ ...bar, amountCents: -bar.amountCents }, { hoursOverPlan: -waterfall.hoursOverPlan })).not.toMatch(NO_LONG_DASH);
      expect(varianceReading({ ...bar, amountCents: b(0) }, { hoursOverPlan: 0 })).not.toMatch(/\$/);
    }
    expect(varianceReading({ key: 'labor_efficiency', label: 'Labor efficiency', amountCents: b(2200) }, { hoursOverPlan: -1 })).toBe(
      'Labor efficiency: the crew needed 1 fewer hour than planned for this many units. That saved $22.',
    );
  });
  it('finds the biggest drag and the biggest lift', () => {
    const waterfall = varianceWaterfall({ plan: BUDGET, actual: ACTUAL });
    expect(biggestDrag(waterfall.bars)?.key).toBe('labor_efficiency');
    expect(biggestLift(waterfall.bars)?.key).toBe('other');
    expect(biggestDrag([])).toBeNull();
    expect(biggestLift([{ key: 'price', label: 'Price', amountCents: b(-1) }])).toBeNull();
  });
});

describe('pace and productivity (4.12)', () => {
  const rows: PaceRow[] = [
    { workDate: '2026-11-02', unitsGood: 0, hours: 16, setupHours: 16, laborCostCents: b(35000) }, // setup day
    { workDate: '2026-11-03', unitsGood: 600, hours: 24, laborCostCents: b(52000) },
    { workDate: '2026-11-04', unitsGood: 300, hours: 10, laborCostCents: b(22000) },
    { workDate: '2026-11-04', unitsGood: 0, hours: 6, source: 'projects', laborCostCents: b(15000) }, // Projects time: cost, not pace
    { workDate: '2026-11-05', unitsGood: 500, hours: 0, hoursConfirmed: false }, // warehouse row waiting for hours
    { workDate: '2026-11-06', unitsGood: 0, hours: 8, laborCostCents: b(17000) }, // hours and no units
  ];
  it('rolls rows into days and keeps setup, Projects time and unconfirmed rows out of pace', () => {
    const days = paceDays(rows);
    expect(days.map((day) => day.workDate)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
    expect(days[0]).toMatchObject({ paceHours: 0, counted: false, evidence: false, hours: 16 });
    expect(days[1]).toMatchObject({ paceHours: 24, counted: true, evidence: true });
    expect(days[2]).toMatchObject({ paceHours: 10, hours: 16, unitsGood: 300, laborCostCents: b(37000), evidence: true });
    expect(days[3]).toMatchObject({ counted: false, evidence: false, missingHours: true });
    expect(days[4]).toMatchObject({ counted: true, evidence: false });
    expect(evidenceDayCount(days)).toBe(2);
    expect(daysMissingHours(days)).toBe(1);
  });
  it('works out pace over counted days, never infinite', () => {
    const days = paceDays(rows);
    const overall = paceOverall(days);
    expect(overall).toMatchObject({ days: 3, unitsGood: 900, paceHours: 42, uph: 21.429 });
    expect(paceOverall([]).uph).toBeNull();
    expect(unitsPerHour(1600, 50)).toBe(32);
    expect(unitsPerHour(1600, 0)).toBeNull();
    expect(unitsPerHour(0, 8)).toBe(0);
  });
  it('takes the last evidence days as the window', () => {
    const days = paceDays(rows);
    expect(lastEvidenceWindow(days)).toMatchObject({ days: 2, unitsGood: 900, paceHours: 34, hours: 40, laborCostCents: b(89000), uph: 26.471 });
    expect(lastEvidenceWindow(days, 1)).toMatchObject({ days: 1, unitsGood: 300, uph: 30 });
    expect(lastEvidenceWindow([])).toMatchObject({ days: 0, uph: null });
  });
  it('compares pace with the target', () => {
    expect(productivityBp(32, 40)).toBe(8000);
    expect(productivityBp(32, null)).toBeNull();
    expect(productivityBp(null, 40)).toBeNull();
    expect(productivityBp(32, 0)).toBeNull();
    expect(earnedHours(4000, 40)).toBe(100);
    expect(earnedHours(4000, null)).toBeNull();
    expect(laborCostPerUnit(b(287500), 4000)).toBe(b(72));
    expect(laborCostPerUnit(b(287500), 0)).toBeNull();
  });
  const standards = [
    { id: 's1', jobTypeId: 'kit', unitsPerLaborHour: 38, effectiveFrom: '2026-01-01' },
    { id: 's2', jobTypeId: 'kit', unitsPerLaborHour: 40, effectiveFrom: '2026-06-01' },
    { id: 's3', jobTypeId: 'kit', clientId: 'acme', unitsPerLaborHour: 44, effectiveFrom: '2026-02-01' },
    { id: 's4', jobTypeId: 'kit', laborClassId: 'temp', unitsPerLaborHour: 30, effectiveFrom: '2026-02-01' },
    { id: 's5', jobTypeId: 'kit', clientId: 'acme', laborClassId: 'temp', unitsPerLaborHour: 33, effectiveFrom: '2026-01-15' },
    { id: 's6', jobTypeId: 'relabel', unitsPerLaborHour: 120, effectiveFrom: '2026-01-01' },
    { id: 's7', vasServiceId: 'label', unitsPerLaborHour: 200, effectiveFrom: '2026-01-01' },
    { id: 's8', jobTypeId: 'kit', unitsPerLaborHour: 55, effectiveFrom: '2027-01-01' },
  ];
  it('picks the best target pace row', () => {
    expect(pickStandard(standards, { jobTypeId: 'kit', date: '2026-11-17' })?.id).toBe('s2');
    expect(pickStandard(standards, { jobTypeId: 'kit', date: '2026-03-01' })?.id).toBe('s1');
    expect(pickStandard(standards, { jobTypeId: 'kit', clientId: 'acme', date: '2026-11-17' })?.id).toBe('s3');
    expect(pickStandard(standards, { jobTypeId: 'kit', laborClassId: 'temp', date: '2026-11-17' })?.id).toBe('s4');
    expect(pickStandard(standards, { jobTypeId: 'kit', clientId: 'acme', laborClassId: 'temp', date: '2026-11-17' })?.id).toBe('s5');
    expect(pickStandard(standards, { jobTypeId: 'kit', clientId: 'other', date: '2026-11-17' })?.id).toBe('s2');
    expect(pickStandard(standards, { vasServiceId: 'label', date: '2026-11-17' })?.id).toBe('s7');
    expect(pickStandard(standards, { jobTypeId: 'kit', date: '2025-06-01' })).toBeNull();
    expect(pickStandard(standards, { jobTypeId: 'unknown', date: '2026-11-17' })).toBeNull();
    expect(pickStandard(standards, { date: '2026-11-17' })).toBeNull();
  });
  it('breaks standard ties by created time, then id', () => {
    const tied = [
      { id: 'b', jobTypeId: 'kit', unitsPerLaborHour: 1, effectiveFrom: '2026-01-01', createdAt: '2026-01-02T00:00:00Z' },
      { id: 'a', jobTypeId: 'kit', unitsPerLaborHour: 2, effectiveFrom: '2026-01-01', createdAt: '2026-01-02T00:00:00Z' },
      { id: 'c', jobTypeId: 'kit', unitsPerLaborHour: 3, effectiveFrom: '2026-01-01', createdAt: '2026-01-01T00:00:00Z' },
    ];
    expect(pickStandard(tied, { jobTypeId: 'kit', date: '2026-11-17' })?.id).toBe('a');
  });
  it('resolves the target pace: the job, then a standard, then the plan, then none', () => {
    const query = { jobTypeId: 'kit', date: '2026-11-17' };
    expect(targetPace({ jobStandardUph: '42.5', standards, query, plan: BUDGET })).toEqual({ uph: 42.5, source: 'job', standardId: null });
    expect(targetPace({ jobStandardUph: null, standards, query, plan: BUDGET })).toEqual({ uph: 40, source: 'standard', standardId: 's2' });
    expect(targetPace({ plan: { ...BUDGET, setupHours: 50 } })).toEqual({ uph: 50, source: 'plan', standardId: null });
    expect(targetPace({ plan: { ...BUDGET, laborHours: 0 } })).toEqual({ uph: null, source: 'none', standardId: null });
    expect(targetPace({})).toEqual({ uph: null, source: 'none', standardId: null });
  });
  it('resolves the target margin down the chain', () => {
    expect(targetMarginBp({ job: 2500, jobType: 2800, client: 3200, orgDefault: 3000 })).toBe(2500);
    expect(targetMarginBp({ jobType: 2800, client: 3200 })).toBe(2800);
    expect(targetMarginBp({ client: 3200 })).toBe(3200);
    expect(targetMarginBp({ job: 0 })).toBe(0);
    expect(targetMarginBp({})).toBe(3000);
  });
});

describe('projected finish (4.13)', () => {
  it('picks the mode', () => {
    expect(jobMode({ status: 'active', kind: 'one_time', plannedUnits: 100 })).toBe('projected');
    expect(jobMode({ status: 'active', kind: 'one_time', plannedUnits: 0, planLaborHours: 40 })).toBe('projected');
    expect(jobMode({ status: 'active', kind: 'one_time', plannedUnits: 0 })).toBe('actuals');
    expect(jobMode({ status: 'active', kind: 'ongoing', plannedUnits: 100 })).toBe('actuals');
    expect(jobMode({ status: 'completed', kind: 'ongoing' })).toBe('final');
    expect(jobMode({ status: 'planned', kind: 'one_time', plannedUnits: 100 })).toBeNull();
    expect(jobMode({ status: 'on_hold', kind: 'one_time', plannedUnits: 100 })).toBeNull();
    expect(jobMode({ status: 'cancelled', kind: 'one_time', plannedUnits: 100 })).toBeNull();
  });
  it('never calls one day of work solid, and never says "based on the plan" when there is no plan', () => {
    const oneDay = projectJob({ ...PROJECTION_INPUT, plan: null, targetPace: null, actual: { ...ACTUAL, unitsGood: 8000 }, window: { days: 1, unitsGood: 8000, paceHours: '24.00', hours: '24.00', laborCostCents: b(55200) }, evidenceDays: 1 });
    expect(oneDay.confidence).toBe('early');
    const nothing = projectJob({ ...PROJECTION_INPUT, plan: null, window: null, evidenceDays: 0, targetPace: null, actual: { unitsGood: 0, hours: 0, revenueCents: b(0), laborCents: b(0), materialCents: b(0), otherCents: b(0), sharedCents: b(0) } });
    expect(nothing.confidence).toBeNull();
  });
  it('matches the worked example', () => {
    const p = projectJob(PROJECTION_INPUT);
    expect(p.mode).toBe('projected');
    expect(p.basis).toBe('units');
    expect(p.unitsLeft).toBe(6000);
    expect(p.pctCompleteBp).toBe(4000);
    expect(p.paceWeightBp).toBe(10000);
    expect(p.confidence).toBe('solid');
    expect(p.actualPace).toBe(32);
    expect(p.planPace).toBe(40);
    expect(p.paceUph).toBe(32);
    expect(p.hoursLeft).toBe(187.5);
    expect(p.rateLeftCents).toBe(b(2300));
    expect(p.laborLeftCents).toBe(b(431250));
    expect(p.sharedLeftCents).toBe(b(39000));
    expect(p.materialLeftCents).toBe(b(285000));
    expect(p.otherLeftCents).toBe(b(60000));
    expect(p.costSoFarCents).toBe(b(543500));
    expect(p.costAtFinishCents).toBe(b(1358750));
    expect(p.revenueAtFinishCents).toBe(b(1750000));
    expect(p.projectedProfitCents).toBe(b(391250));
    expect(p.projectedMarginBp).toBe(2236);
    expect(p.projectedLaborHours).toBe(312.5);
    expect(p.unitsPerDay).toBe(320);
    expect(p.workDaysLeft).toBe(19);
    expect(p.projectedFinishDate).toBe('2026-12-14');
    expect(projectionNote(p)).toBe('Solid. We assume the rest of the job runs at 32 units per person per hour, the pace of your last 5 days.');
  });
  it('matches the blend example on day one', () => {
    const p = projectJob({
      ...PROJECTION_INPUT,
      actual: { unitsGood: 600, hours: 24, revenueCents: b(105000), laborCents: b(55200), materialCents: b(27000), otherCents: b(0), sharedCents: b(0) },
      window: { days: 1, unitsGood: 600, paceHours: 24, laborCostCents: b(55200) },
      evidenceDays: 1,
    });
    expect(p.pctCompleteBp).toBe(600);
    expect(p.paceWeightBp).toBe(3333);
    expect(p.actualPace).toBe(25);
    expect(p.paceUph).toBe(35);
    expect(p.confidence).toBe('early');
    expect(projectionNote(p)).toBe('Early guess. We assume the rest of the job runs at 35 units per person per hour, a blend of your plan (40) and your first day (25).');
  });
  it('reads "Good read" between half and full weight', () => {
    const p = projectJob({ ...PROJECTION_INPUT, actual: { ...ACTUAL, unitsGood: 1500 }, evidenceDays: 2 });
    expect(p.paceWeightBp).toBe(7500);
    expect(p.confidence).toBe('good');
    expect(p.paceUph).toBe(34);
  });
  it('runs on the plan pace before the first evidence day', () => {
    const p = projectJob({ ...PROJECTION_INPUT, actual: { unitsGood: 0, hours: 0, revenueCents: b(0), laborCents: b(0), materialCents: b(0), otherCents: b(0), sharedCents: b(0) }, window: null, evidenceDays: 0, fallbackRateCents: b(2176) });
    expect(p.confidence).toBe('plan');
    expect(p.paceUph).toBe(40);
    expect(p.hoursLeft).toBe(250);
    expect(p.rateLeftCents).toBe(b(2200)); // budget labor cost over budget hours
    expect(p.laborLeftCents).toBe(b(550000));
    expect(p.sharedLeftCents).toBe(b(50000)); // flex of the plan shared cost for the units left
    expect(p.materialLeftCents).toBe(b(450000)); // budget material per unit
    expect(p.otherLeftCents).toBe(b(100000));
    expect(p.revenueAtFinishCents).toBe(b(1750000));
    expect(p.projectedProfitCents).toBe(b(600000)); // the projection equals the budget
    expect(p.projectedFinishDate).toBeNull();
    expect(p.unitsPerDay).toBeNull();
    expect(projectionNote(p)).toBe('Based on the plan. We assume the rest of the job runs at your target pace of 40 units per person per hour.');
  });
  it('equals the budget when there is no target pace and no evidence day', () => {
    const p = projectJob({ ...PROJECTION_INPUT, actual: { unitsGood: 0, hours: 0, revenueCents: b(0), laborCents: b(0), materialCents: b(0), otherCents: b(0), sharedCents: b(0) }, window: null, evidenceDays: 0, targetPace: null });
    expect(p.paceKnown).toBe(false);
    expect(p.paceUph).toBeNull();
    expect(p.costAtFinishCents).toBe(b(1150000));
    expect(p.revenueAtFinishCents).toBe(b(1750000));
    expect(p.projectedProfitCents).toBe(b(600000));
    expect(p.projectedLaborHours).toBe(250);
    expect(projectionNote(p)).toBe('There is no target pace and no finished day yet, so the projection is the plan.');
  });
  it('falls back to what happened so far with no pace and no plan', () => {
    const p = projectJob({ ...PROJECTION_INPUT, plan: null, window: null, evidenceDays: 0, targetPace: null });
    expect(p.paceKnown).toBe(false);
    expect(p.projectedProfitCents).toBe(b(156500));
  });
  it('uses the actual pace alone when there is no target pace', () => {
    const p = projectJob({ ...PROJECTION_INPUT, targetPace: null });
    expect(p.planPace).toBeNull();
    expect(p.paceUph).toBe(32);
  });
  it('stops projecting once the job is past its planned units', () => {
    const p = projectJob({ ...PROJECTION_INPUT, actual: { ...ACTUAL, unitsGood: 10400, revenueCents: b(1820000) } });
    expect(p.unitsLeft).toBe(0);
    expect(p.pctCompleteBp).toBe(10400);
    expect(p.pctCompleteShownBp).toBe(10000);
    expect(p.hoursLeft).toBe(0);
    expect(p.laborLeftCents).toBe(b(0));
    expect(p.materialLeftCents).toBe(b(0));
    expect(p.revenueAtFinishCents).toBe(b(1820000));
    expect(p.projectedUnits).toBe(10400);
    expect(p.projectedFinishDate).toBe('2026-11-17');
    expect(p.workDaysLeft).toBe(0);
    expect(projectionNote(p)).toBe('This job has reached its planned units, so the projection is what happened so far.');
  });
  it('walks the rate fallbacks: last days, whole job, budget, class rate', () => {
    const noWindowLabor = projectJob({ ...PROJECTION_INPUT, window: { days: 5, unitsGood: 1600, paceHours: 50, laborCostCents: b(0) } });
    expect(noWindowLabor.rateLeftCents).toBe(b(2300)); // 2,875 over 125 hours
    const noActual = projectJob({ ...PROJECTION_INPUT, actual: { ...ACTUAL, hours: 0, laborCents: b(0) }, window: null, evidenceDays: 0 });
    expect(noActual.rateLeftCents).toBe(b(2200));
    const noPlan = projectJob({ ...PROJECTION_INPUT, plan: null, actual: { ...ACTUAL, hours: 0, laborCents: b(0) }, window: null, evidenceDays: 0, fallbackRateCents: b(2176) });
    expect(noPlan.rateLeftCents).toBe(b(2176));
    const nothing = projectJob({ ...PROJECTION_INPUT, plan: null, actual: { ...ACTUAL, hours: 0, laborCents: b(0) }, window: null, evidenceDays: 0 });
    expect(nothing.rateLeftCents).toBeNull();
    expect(nothing.laborLeftCents).toBe(b(0));
  });
  it('uses planned material quantities on an actual job, then the job material cost per unit', () => {
    const planned = projectJob({ ...PROJECTION_INPUT, materialMethod: 'actual', plannedMaterialLeftCents: b(123400) });
    expect(planned.materialLeftCents).toBe(b(123400));
    const perUnit = projectJob({ ...PROJECTION_INPUT, plan: null, actual: { ...ACTUAL, unitsGood: 0, materialCents: b(0) }, window: null, evidenceDays: 0, materialCostPerUnit: '0.45' });
    expect(perUnit.materialLeftCents).toBe(b(450000));
  });
  it('projects a fixed price job to its fixed price', () => {
    const p = projectJob({ ...PROJECTION_INPUT, pricingModel: 'fixed', fixedPriceCents: b(1800000), otherRevenueCents: b(5000), serviceRevenueCents: b(20000), serviceCostCents: b(8000), actual: { ...ACTUAL, revenueCents: b(745000) } });
    // fixed price + service and other revenue so far + service revenue for the units left (20,000 x 6,000 / 4,000)
    expect(p.serviceRevenueLeftCents).toBe(b(30000));
    expect(p.serviceCostLeftCents).toBe(b(12000));
    expect(p.revenueAtFinishCents).toBe(b(1855000));
    expect(p.costAtFinishCents).toBe(b(1370750));
    expect(p.atFinish.revenueCents - p.atFinish.laborCents - p.atFinish.materialCents - p.atFinish.otherCents - p.atFinish.sharedCents).toBe(p.projectedProfitCents);
  });
  it('projects an hourly job by the hours left', () => {
    const p = projectJob({ ...PROJECTION_INPUT, pricingModel: 'hourly', billRateCents: b(4500), actual: { ...ACTUAL, revenueCents: b(562500) } });
    expect(p.revenueAtFinishCents).toBe(b(1406250)); // 5,625 + 187.5 x 45.00
  });
  it('runs an hour based job out to its plan hours', () => {
    const p = projectJob({
      status: 'active',
      kind: 'one_time',
      pricingModel: 'hourly',
      plannedUnits: 0,
      plan: { units: 0, revenueCents: b(900000), laborHours: 200, laborCents: b(440000), materialCents: b(0), otherCents: b(20000), sharedCents: b(10000) },
      actual: { unitsGood: 0, hours: 50, revenueCents: b(225000), laborCents: b(115000), materialCents: b(0), otherCents: b(5000), sharedCents: b(4000) },
      window: null,
      evidenceDays: 0,
      targetPace: null,
      billRateCents: b(4500),
      today: '2026-11-17',
    });
    expect(p.basis).toBe('hours');
    expect(p.pctCompleteBp).toBe(2500);
    expect(p.hoursLeft).toBe(150);
    expect(p.rateLeftCents).toBe(b(2300));
    expect(p.laborLeftCents).toBe(b(345000));
    expect(p.sharedLeftCents).toBe(b(12000));
    expect(p.materialLeftCents).toBe(b(0));
    expect(p.otherLeftCents).toBe(b(15000));
    expect(p.revenueAtFinishCents).toBe(b(900000));
    expect(p.projectedLaborHours).toBe(200);
    expect(p.projectedFinishDate).toBeNull();
    expect(p.confidence).toBe('solid');
    expect(projectionNote(p)).toBe('Solid. We assume the job uses the rest of its planned hours: 150 labor hours to go.');
  });
  it('has no margin when revenue at finish is zero or less', () => {
    const p = projectJob({ ...PROJECTION_INPUT, unitPrice: null, actual: { ...ACTUAL, revenueCents: b(0) } });
    expect(p.revenueAtFinishCents).toBe(b(0));
    expect(p.projectedMarginBp).toBeNull();
    expect(p.projectedProfitCents).toBe(b(-1358750));
  });
  it('returns the last 30 days for ongoing work, and the whole job when complete', () => {
    const last30 = { revenueCents: b(300000), laborCents: b(150000), materialCents: b(50000), otherCents: b(10000), sharedCents: b(5000), unitsGood: 1500, hours: 60 };
    const ongoing = projectJob({ ...PROJECTION_INPUT, kind: 'ongoing', last30 });
    expect(ongoing.mode).toBe('actuals');
    expect(ongoing.projectedProfitCents).toBe(b(85000));
    expect(ongoing.projectedMarginBp).toBe(2833);
    expect(ongoing.projectedFinishDate).toBeNull();
    expect(projectionNote(ongoing)).toBe('This is ongoing work, so Pulse shows the last 30 days in place of a projection.');
    expect(projectJob({ ...PROJECTION_INPUT, kind: 'ongoing' }).projectedProfitCents).toBe(b(0));
    const done = projectJob({ ...PROJECTION_INPUT, status: 'completed' });
    expect(done.mode).toBe('final');
    expect(done.projectedProfitCents).toBe(b(156500));
    expect(done.projectedLaborHours).toBe(125);
    expect(projectionNote(done)).toBe('This job is complete. These are the final numbers.');
    const planned = projectJob({ ...PROJECTION_INPUT, status: 'planned' });
    expect(planned.mode).toBeNull();
    expect(projectionNote(planned)).toBe('This job is not active, so there is no projection.');
  });
  it('never throws and always balances, for any mix of numbers', () => {
    let seed = 4242;
    const next = (max: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % max;
    };
    const maybe = <T>(value: T): T | null => (next(4) === 0 ? null : value);
    for (let round = 0; round < 500; round += 1) {
      const material = next(900_000);
      const actual: ActualTotals = {
        unitsGood: next(5) === 0 ? 0 : next(15000),
        hours: next(5) === 0 ? 0 : `${next(500)}.${String(next(100)).padStart(2, '0')}`,
        revenueCents: b(next(3_000_000)),
        laborCents: b(next(1_000_000)),
        materialCents: b(material),
        scrapCents: b(next(material + 1)),
        otherCents: b(next(200_000)),
        sharedCents: b(next(80_000)),
      };
      const plan: PlanTotals | null = maybe({ units: next(4) === 0 ? 0 : next(12000), revenueCents: b(next(3_000_000)), laborHours: next(4) === 0 ? 0 : next(600), laborCents: b(next(1_200_000)), materialCents: b(next(900_000)), otherCents: b(next(200_000)), sharedCents: b(next(80_000)) });
      const windowDays = next(6);
      const input: ProjectionInput = {
        status: (['active', 'active', 'active', 'completed', 'planned'] as const)[next(5)] ?? 'active',
        kind: next(5) === 0 ? 'ongoing' : 'one_time',
        pricingModel: (['per_unit', 'fixed', 'hourly'] as const)[next(3)] ?? 'per_unit',
        plannedUnits: maybe(next(4) === 0 ? 0 : next(12000)),
        plan,
        actual,
        serviceRevenueCents: b(next(50_000)),
        serviceCostCents: b(next(30_000)),
        otherRevenueCents: b(next(20_000)),
        window: windowDays === 0 ? null : { days: windowDays, unitsGood: next(3) === 0 ? 0 : next(3000), paceHours: next(3) === 0 ? 0 : next(200), laborCostCents: b(next(400_000)) },
        evidenceDays: windowDays === 0 ? 0 : windowDays + next(10),
        targetPace: maybe(next(4) === 0 ? 0 : `${next(200)}.${next(10)}`),
        unitPrice: maybe(`${next(9)}.${String(next(10000)).padStart(4, '0')}`),
        fixedPriceCents: maybe(b(next(3_000_000))),
        billRateCents: maybe(b(next(9000))),
        materialMethod: next(2) === 0 ? 'standard' : 'actual',
        materialCostPerUnit: maybe('0.4500'),
        plannedMaterialLeftCents: maybe(b(next(300_000))),
        fallbackRateCents: maybe(b(2176)),
        today: '2026-11-17',
        workingDays: next(6) === 0 ? [] : [1, 2, 3, 4, 5],
        last30: maybe({ revenueCents: b(next(500_000)), laborCents: b(next(300_000)), materialCents: b(next(100_000)), otherCents: b(next(50_000)), sharedCents: b(next(20_000)) }),
      };
      const p = projectJob(input);
      expect(p.projectedProfitCents).toBe(p.revenueAtFinishCents - p.costAtFinishCents);
      const at = p.atFinish;
      expect(at.revenueCents - at.laborCents - at.materialCents - at.otherCents - at.sharedCents).toBe(p.projectedProfitCents);
      if (p.mode === 'projected' && p.paceKnown) {
        expect(p.costAtFinishCents).toBe(p.costSoFarCents + p.laborLeftCents + p.sharedLeftCents + p.materialLeftCents + p.otherLeftCents + p.serviceCostLeftCents);
        expect(p.costAtFinishCents >= p.costSoFarCents).toBe(true);
      }
      expect(projectionNote(p)).not.toMatch(NO_LONG_DASH);
      const risk = assessRisk({
        status: input.status,
        projection: p,
        actual,
        plan,
        plannedUnits: input.plannedUnits,
        targetMarginBp: next(5000),
        evidenceDays: input.evidenceDays,
        window: input.window ? { uph: unitsPerHour(input.window.unitsGood, input.window.paceHours), paceHours: input.window.paceHours, unitsGood: input.window.unitsGood } : null,
        targetPace: input.targetPace,
        unitPrice: input.unitPrice,
        dueDate: maybe('2026-11-20'),
        today: '2026-11-17',
        daysMissingHours: next(3),
        noPrice: next(6) === 0,
        needsRate: next(6) === 0,
        workDaysSinceLastEntry: maybe(next(6)),
        entryDays30: next(10),
        hasMonthlyPlan: next(2) === 0,
      });
      for (const reason of risk.reasons) {
        expect(reason.impactCents <= b(0)).toBe(true);
        expect(riskSentence(reason)).not.toMatch(NO_LONG_DASH);
        expect(riskSentence(reason, { seesMoney: false })).not.toMatch(/\$/);
        expect(() => JSON.stringify(reason.params)).not.toThrow();
      }
      if (risk.status !== null && risk.status !== 'on_track') expect(risk.headline?.status).toBe(risk.status);
      if (risk.reasons.some((reason) => reason.status === 'losing')) expect(risk.status).toBe('losing');
      if (plan) {
        const table = planVsActual({ plan, actual, projected: p.atFinish });
        expect(table.rows).toHaveLength(11);
      }
    }
  });
  it('counts finish days on the site working days', () => {
    const sixDay = projectJob({ ...PROJECTION_INPUT, workingDays: [1, 2, 3, 4, 5, 6] });
    expect(sixDay.projectedFinishDate).toBe('2026-12-09');
  });
});

describe('risk status (4.14)', () => {
  const base = (overrides: Partial<RiskInput> = {}, projectionOverrides: Partial<ProjectionInput> = {}): RiskInput => ({
    status: 'active',
    projection: projectJob({ ...PROJECTION_INPUT, ...projectionOverrides }),
    actual: projectionOverrides.actual ?? ACTUAL,
    plan: BUDGET,
    plannedUnits: 10000,
    targetMarginBp: 3000,
    evidenceDays: 5,
    window: { uph: 32, paceHours: 50, unitsGood: 1600 },
    targetPace: 40,
    unitPrice: '1.75',
    today: '2026-11-17',
    ...overrides,
  });
  const rules = (input: RiskInput): string[] => assessRisk(input).reasons.map((reason) => reason.rule);

  it('matches the worked example', () => {
    const result = assessRisk(base({ window: null, targetPace: null }));
    expect(result.status).toBe('at_risk');
    // The spec lists R3 and W1. Its own numbers also trip W4: material runs $0.475 a unit against a $0.45 plan.
    expect(result.reasons.map((reason) => reason.rule)).toEqual(['R3', 'W1', 'W4']);
    expect(result.reasons[0]?.impactCents).toBe(b(-168750));
    expect(result.reasons[1]?.impactCents).toBe(b(-133750));
    expect(result.reasons[2]?.impactCents).toBe(b(-25000));
    expect(result.headline?.rule).toBe('R3');
    expect(riskHeadline(result)).toBe('Labor is heading 25% over the plan.');
    expect(result.headline?.nextStep).toBe('check_crew');
    expect(NEXT_STEP_LABELS[result.headline?.nextStep ?? 'add_plan']).toBe('Check the crew size');
    expect(riskSentences(result, {}, 2)).toEqual(['Labor is heading 25% over the plan.', 'Margin is heading for 22%, a little under your 30% target.']);
    expect(riskSentences(result)).toHaveLength(3);
  });
  it('adds the pace rule with its impact', () => {
    const result = assessRisk(base({ targetPace: 42 }));
    expect(result.reasons.map((reason) => reason.rule)).toEqual(['R3', 'R4', 'W1', 'W4']);
    const pace = result.reasons.find((reason) => reason.rule === 'R4');
    expect(pace?.impactCents).toBe(b(-27370)); // (50.00 - 38.10 hours the units should have taken) x $23.00
    expect(riskSentence(pace as never)).toBe('The crew is making 32 units per person per hour. The target pace is 42.');
    // exactly 80% of the target is not under it: a heads up, not at risk
    expect(assessRisk(base()).reasons.map((reason) => reason.rule)).toEqual(['R3', 'W1', 'W4', 'W3']);
  });
  it('is on track when nothing matches', () => {
    const actual: ActualTotals = { unitsGood: 4000, hours: 95, revenueCents: b(700000), laborCents: b(209000), materialCents: b(180000), sharedCents: b(20000), otherCents: b(40000) };
    const result = assessRisk(base({ actual, window: { uph: 42, paceHours: 50, unitsGood: 2100 } }, { actual, window: { days: 5, unitsGood: 2100, paceHours: 50, laborCostCents: b(110000) } }));
    expect(result.status).toBe('on_track');
    expect(result.reasons).toEqual([]);
    expect(result.headline).toBeNull();
    expect(riskHeadline(result)).toBe('On track. Margin is heading for 36% against a 30% target.');
    expect(riskHeadline(result, { seesMoney: false })).toBe('On track.');
  });
  it('gives no status to planned, on hold and cancelled jobs', () => {
    for (const status of ['planned', 'on_hold', 'cancelled'] as const) {
      const result = assessRisk(base({ status }, { status }));
      expect(result.status).toBeNull();
      expect(result.reasons).toEqual([]);
      expect(riskHeadline(result)).toBe('');
    }
  });
  it('L1: losing money once there is enough evidence', () => {
    const losing = base({ unitPrice: '1.20' }, { unitPrice: '1.20', actual: { ...ACTUAL, revenueCents: b(480000) } });
    const result = assessRisk(losing);
    expect(result.status).toBe('losing');
    expect(result.headline?.rule).toBe('L1');
    expect(result.headline?.impactCents).toBe(b(-158750));
    expect(riskHeadline(result)).toBe('At this pace the job ends about $1,588 in the red. By the finish, each unit costs $1.36 to make and sells for $1.20.');
    expect(riskHeadline(result, { seesMoney: false })).toBe('At this pace the job ends in the red. It costs more to make than it sells for.');
    expect(riskHeadline(result, { unitLabel: 'kit' })).toContain('each kit costs');
    // one evidence day and under 20% done is too early to call
    const early = base(
      { unitPrice: '1.20', evidenceDays: 1 },
      { unitPrice: '1.20', evidenceDays: 1, actual: { ...ACTUAL, unitsGood: 1000, revenueCents: b(120000) }, window: { days: 1, unitsGood: 1000, paceHours: 50, laborCostCents: b(115000) } },
    );
    expect(rules(early)).not.toContain('L1');
  });
  it('L2: a completed job that lost money, with the labor overrun', () => {
    const actual = { ...ACTUAL, unitsGood: 10000, hours: 330, revenueCents: b(1750000), laborCents: b(1200000), materialCents: b(450000), otherCents: b(100000), sharedCents: b(62000) };
    const result = assessRisk(base({ status: 'completed', actual }, { status: 'completed', actual }));
    expect(result.status).toBe('losing');
    expect(result.headline?.rule).toBe('L2');
    expect(riskHeadline(result)).toBe('This job lost $620. Labor ran 118% over the budget.');
    expect(riskHeadline(result, { seesMoney: false })).toBe('This job lost money. Labor ran 118% over the budget.');
    expect(result.headline?.nextStep).toBe('review_job');
    expect(rules(base({ status: 'completed', actual }, { status: 'completed', actual }))).not.toContain('W8');
  });
  it('L3: ongoing work that lost money over the last 30 days, with 5 or more entry days', () => {
    const last30 = { revenueCents: b(300000), laborCents: b(250000), materialCents: b(60000), otherCents: b(21000), sharedCents: b(10000) };
    const input = base({ entryDays30: 5 }, { kind: 'ongoing', last30 });
    const result = assessRisk(input);
    expect(result.status).toBe('losing');
    expect(riskHeadline(result)).toBe('This work lost $410 in the last 30 days.');
    expect(rules(base({ entryDays30: 4 }, { kind: 'ongoing', last30 }))).not.toContain('L3');
    // without a monthly plan the labor and due date rules stay quiet
    expect(rules(input)).not.toContain('R3');
    expect(rules(input)).not.toContain('W2');
  });
  it('R1 and R2: margin far under target, or under the floor', () => {
    const r1 = assessRisk(base({ targetMarginBp: 3500, window: null }));
    expect(r1.reasons.map((reason) => reason.rule)).toContain('R1');
    expect(riskSentence(r1.reasons.find((reason) => reason.rule === 'R1') as never)).toBe('Margin is heading for 22%. Your target is 35%.');
    expect(r1.reasons.find((reason) => reason.rule === 'R1')?.impactCents).toBe(b(-46250)); // 3,912.50 - 25% of 17,500
    expect(r1.reasons.map((reason) => reason.rule)).not.toContain('W1');
    const lowPrice = base({ unitPrice: '1.45', window: null }, { unitPrice: '1.45', actual: { ...ACTUAL, revenueCents: b(580000) } });
    const r2 = assessRisk(lowPrice);
    expect(r2.status).toBe('at_risk');
    const floor = r2.reasons.find((reason) => reason.rule === 'R2');
    expect(riskSentence(floor as never)).toBe('Margin is heading for 6%, under your 10% floor.');
    // One reason per problem: under the floor does not also say "far under target".
    expect(r2.reasons.map((reason) => reason.rule)).not.toContain('R1');
    expect(riskSentence(floor as never, { seesMoney: false })).toBe('Profit is heading under your lowest allowed margin.');
    expect(riskSentence({ rule: 'R1', params: {} }, { seesMoney: false })).toBe('Profit is heading well under your target.');
  });
  it('skips the margin rules when margin has no number, and still flags labor', () => {
    const input = base({ unitPrice: null, window: null }, { unitPrice: null, actual: { ...ACTUAL, revenueCents: b(0) } });
    const result = assessRisk(input);
    expect(result.reasons.map((reason) => reason.rule)).toEqual(['L1', 'R3', 'W4']);
    expect(result.status).toBe('losing');
    expect(riskHeadline(result)).toBe('At this pace the job ends about $13,588 in the red.');
  });
  it('R3 needs margin under target; W2 covers the rest', () => {
    const healthy = base({ targetMarginBp: 2000, window: null });
    expect(rules(healthy)).toEqual(['W2', 'W4']);
    expect(assessRisk(healthy).status).toBe('heads_up');
    expect(riskHeadline(assessRisk(healthy))).toBe('Labor is heading 25% over the plan.');
    // 8% over: a heads up only
    const actual = { ...ACTUAL, hours: 108, laborCents: b(237600) };
    const mild = base({ actual, window: null, targetMarginBp: 2000 }, { actual, window: { days: 5, unitsGood: 1850, paceHours: 50, laborCostCents: b(110000) } });
    const result = assessRisk(mild);
    expect(result.reasons.map((reason) => reason.rule)).toEqual(['W2', 'W4']);
    expect(riskSentence(result.reasons[0] as never)).toBe('Labor is heading 8% over the plan.');
  });
  it('R4 and W3: pace under target', () => {
    const slow = assessRisk(base({ window: { uph: 39, paceHours: 50, unitsGood: 1950 }, targetPace: 42, targetMarginBp: 1000 }));
    const w3 = slow.reasons.find((reason) => reason.rule === 'W3');
    expect(riskSentence(w3 as never)).toBe('The crew is a bit under the target pace: 39 of 42 units per person per hour.');
    expect(slow.reasons.map((reason) => reason.rule)).not.toContain('R4');
    // right at 95% is fine
    expect(rules(base({ window: { uph: 38, paceHours: 50, unitsGood: 1900 }, targetPace: 40, targetMarginBp: 1000 }))).not.toContain('W3');
    // one evidence day is not enough for R4, but W3 still speaks up
    expect(rules(base({ evidenceDays: 1 }))).toContain('W3');
    expect(rules(base({ evidenceDays: 1 }))).not.toContain('R4');
  });
  it('R5 and W6: the due date', () => {
    const late = assessRisk(base({ dueDate: '2026-12-02', window: null }));
    const r5 = late.reasons.find((reason) => reason.rule === 'R5');
    expect(riskSentence(r5 as never)).toBe('At this pace the job finishes Dec 14. It is due Dec 2.');
    expect(r5?.params.daysLate).toBe(12);
    expect(rules(base({ dueDate: '2026-12-14', window: null }))).not.toContain('R5');
    const soon = assessRisk(base({ dueDate: '2026-11-20', window: null }));
    expect(riskSentence(soon.reasons.find((reason) => reason.rule === 'W6') as never)).toBe('Due Friday and 40% done.');
    expect(riskSentence({ rule: 'W6', params: { dueDate: '2026-11-17', pctBp: 7200, calendarDays: 0 } })).toBe('Due today and 72% done.');
    expect(riskSentence({ rule: 'W6', params: { dueDate: '2026-11-18', pctBp: 7200, calendarDays: 1 } })).toBe('Due tomorrow and 72% done.');
    expect(riskSentence({ rule: 'W6', params: { dueDate: '2026-11-10', pctBp: 7200, calendarDays: -7 } })).toBe('Was due Nov 10 and is 72% done.');
    expect(riskSentence({ rule: 'W6', params: { dueDate: '2026-12-02', pctBp: 7200, calendarDays: 15 } })).toBe('Due Dec 2 and 72% done.');
    // four work days out is not close yet
    expect(rules(base({ dueDate: '2026-11-23', window: null }))).not.toContain('W6');
    // 90% done is close enough
    const nearlyDone = { ...ACTUAL, unitsGood: 9000 };
    expect(rules(base({ dueDate: '2026-11-18', actual: nearlyDone, window: null }, { actual: nearlyDone }))).not.toContain('W6');
  });
  it('R6: the warehouse is short on parts', () => {
    const result = assessRisk(base({ wmsShortage: true, window: null, targetMarginBp: 1000 }, {}));
    expect(result.status).toBe('at_risk');
    expect(riskSentence(result.reasons.find((reason) => reason.rule === 'R6') as never)).toBe('The warehouse is short on parts for this job.');
  });
  it('D rules: not enough data, and never on track or heads up with one', () => {
    const actual: ActualTotals = { unitsGood: 4000, hours: 95, revenueCents: b(700000), laborCents: b(209000), materialCents: b(180000), sharedCents: b(20000), otherCents: b(40000) };
    const healthy = { actual, window: { uph: 42, paceHours: 50, unitsGood: 2100 } };
    const projection = { actual, window: { days: 5, unitsGood: 2100, paceHours: 50, laborCostCents: b(110000) } };
    const d1 = assessRisk(base({ ...healthy, daysMissingHours: 3 }, projection));
    expect(d1.status).toBe('no_data');
    expect(d1.laborMissing).toBe(true);
    expect(riskHeadline(d1)).toBe('3 days have units and no hours. Profit is not complete yet.');
    expect(riskSentence({ rule: 'D1', params: { days: 1 } })).toBe('1 day has units and no hours. Profit is not complete yet.');
    const d2 = assessRisk(base({ ...healthy, noPrice: true }, projection));
    expect(riskHeadline(d2)).toBe('This job has no price yet, so Pulse cannot work out profit.');
    expect(d2.headline?.nextStep).toBe('add_price');
    const d3 = assessRisk(base({ ...healthy, needsRate: true }, projection));
    expect(riskHeadline(d3)).toBe('Some hours have no labor rate, so their cost is missing.');
    // a heads up rule also matches, but the status and the headline stay "Not enough data"
    const mixed = assessRisk(base({ ...healthy, needsRate: true, workDaysSinceLastEntry: 4 }, projection));
    expect(mixed.status).toBe('no_data');
    expect(mixed.reasons.map((reason) => reason.rule)).toEqual(['D3', 'W5']);
    expect(mixed.headline?.rule).toBe('D3');
  });
  it('lets losing money and at risk win over not enough data', () => {
    const result = assessRisk(base({ daysMissingHours: 2, window: null }));
    expect(result.status).toBe('at_risk');
    expect(result.laborMissing).toBe(true);
    expect(result.reasons.map((reason) => reason.rule)).toEqual(['R3', 'W1', 'W4', 'D1']);
  });
  it('W4: material per unit over the plan', () => {
    const actual = { ...ACTUAL, materialCents: b(568000) };
    const result = assessRisk(base({ actual, plan: { ...BUDGET, materialCents: b(1300000) }, window: null }, { actual, plan: { ...BUDGET, materialCents: b(1300000) } }));
    const w4 = result.reasons.find((reason) => reason.rule === 'W4');
    expect(riskSentence(w4 as never)).toBe('Materials cost $1.42 a unit. The plan was $1.30.');
    expect(riskSentence(w4 as never, { seesMoney: false, unitLabel: 'kit' })).toBe('Materials cost more for each kit than the plan.');
    expect(w4?.impactCents).toBe(b(-120000)); // 12 cents x 10,000 planned units
    // 5% over exactly does not fire
    const edge = { ...ACTUAL, materialCents: b(189000) };
    expect(rules(base({ actual: edge, window: null }, { actual: edge }))).not.toContain('W4');
  });
  it('W5, W7 and W8', () => {
    expect(riskSentence(assessRisk(base({ workDaysSinceLastEntry: 4, window: null })).reasons.find((reason) => reason.rule === 'W5') as never)).toBe('Nothing has been logged for 4 work days.');
    expect(rules(base({ workDaysSinceLastEntry: 2, window: null }))).not.toContain('W5');
    expect(rules(base({ workDaysSinceLastEntry: 2, window: null, thresholds: { noEntryDays: 2 } }))).toContain('W5');
    const noPlan = assessRisk(base({ plan: null, window: null }, { plan: null }));
    expect(riskSentence(noPlan.reasons.find((reason) => reason.rule === 'W7') as never)).toBe('This job has no plan, so Pulse cannot compare it with anything.');
    const over = { ...ACTUAL, unitsGood: 10400, revenueCents: b(1820000) };
    const past = assessRisk(base({ actual: over, window: null }, { actual: over }));
    expect(riskSentence(past.reasons.find((reason) => reason.rule === 'W8') as never)).toBe('This job is past its planned units. Update the plan or finish the job.');
  });
  it('uses thresholds from settings', () => {
    expect(DEFAULT_RISK_THRESHOLDS).toEqual({ marginFloorBp: 1000, atRiskGapBp: 1000, laborWatchOverBp: 500, laborRiskOverBp: 1500, productivityWatchBp: 9500, productivityRiskBp: 8000, materialWatchOverBp: 500, noEntryDays: 3 });
    expect(rules(base({ window: null, thresholds: { laborRiskOverBp: 3000 } }))).toEqual(['W2', 'W1', 'W4']);
    expect(rules(base({ window: null, thresholds: { atRiskGapBp: 500 } }))).toContain('R1');
  });
  it('words completed and ongoing jobs in the past tense', () => {
    expect(riskSentence({ rule: 'W1', params: { mode: 'final', marginBp: 2600, targetBp: 3000 } })).toBe('Margin came in at 26%, a little under your 30% target.');
    expect(riskSentence({ rule: 'R1', params: { mode: 'actuals', marginBp: 1400, targetBp: 3000 } })).toBe('Margin was 14% in the last 30 days. Your target is 30%.');
    expect(riskSentence({ rule: 'R3', params: { mode: 'final', overBp: 3100 } })).toBe('Labor ran 31% over the plan.');
    expect(riskSentence({ rule: 'W2', params: { mode: 'actuals', overBp: 800 } })).toBe('Labor ran 8% over the monthly plan in the last 30 days.');
  });
  it('writes every sentence with no long dash, in both variants, and maps every rule to a status', () => {
    const params = { mode: 'projected', lossCents: 184000, costPerUnitCents: 312, pricePerUnitCents: 275, laborOverBp: 3100, marginBp: 1400, targetBp: 3000, floorBp: 1000, overBp: 2500, uph: 31, targetPace: 42, finishDate: '2026-12-09', dueDate: '2026-12-02', days: 3, actualPerUnit: 1.42, planPerUnit: 1.3, pctBp: 7200, calendarDays: 3 };
    for (const rule of RISK_RULES) {
      for (const seesMoney of [true, false]) {
        const sentence = riskSentence({ rule, params }, { seesMoney });
        expect(sentence.length).toBeGreaterThan(10);
        expect(sentence).not.toMatch(NO_LONG_DASH);
        if (!seesMoney) expect(sentence).not.toMatch(/\$/);
      }
      expect(['losing', 'at_risk', 'no_data', 'heads_up']).toContain(ruleStatus(rule));
    }
    expect(riskSentence({ rule: 'L1', params })).toBe('At this pace the job ends about $1,840 in the red. By the finish, each unit costs $3.12 to make and sells for $2.75.');
    // With extra services or fees the revenue side holds them too, so the two numbers explain the loss.
    expect(riskSentence({ rule: 'L1', params: { ...params, revenuePerUnitCents: 290 } })).toBe(
      'At this pace the job ends about $1,840 in the red. By the finish, each unit costs $3.12 to make and brings in $2.90, extra services and fees included.',
    );
    expect(riskSentence({ rule: 'L1', params: { ...params, revenuePerUnitCents: 275 } })).toBe('At this pace the job ends about $1,840 in the red. By the finish, each unit costs $3.12 to make and sells for $2.75.');
    expect(riskSentence({ rule: 'R1', params })).toBe('Margin is heading for 14%. Your target is 30%.');
  });
});
