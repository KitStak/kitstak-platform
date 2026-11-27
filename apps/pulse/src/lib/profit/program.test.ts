import { describe, expect, it } from 'vitest';
import { forecastMonth, type ForecastResult } from '@kitstak/programs-engine/forecast';
import { monthCharges } from '@kitstak/programs-engine/month';
import { resolveOrderCharge, resolveUnitPrice } from '@kitstak/programs-engine/price';
import type { CardVersion, IsoDate, OneTimeCharge, ProgramCalendar } from '@kitstak/programs-engine/types';
import { CALENDAR, PROGRAM_ID, VARIANTS, VERSIONS, outputFor, seeded } from '../../../../../packages/programs-engine/src/glove.fixture';
import { fromScaled, maxCents, quantityToScaled, ratioBp, ZERO } from '../money';
import { addDays, eachDay, firstDayOfMonth, isPlannableDay, isWorkDay, workDaysInMonth } from './calendar';
import {
  type JobCostLine,
  type ProgramLine,
  type ProgramMonth,
  type ProgramPlanBuild,
  type ProgramTrailingDay,
  programCostForecast,
  programMonthFigures,
  programMonthPlan,
  programTargetMargin,
} from './program';

const b = (value: number | string): bigint => BigInt(value);
const qty = (value: string): bigint => quantityToScaled(value);

function line(date: IsoDate, variantId: string | null, units: string, revenueCents: number, extra: Partial<ProgramLine> = {}): ProgramLine {
  return { date, variantId, units, revenueCents: b(revenueCents), ...extra };
}

/** Every column of the variant rows plus the not tied row equals the totals. */
function expectRowsAddUp(month: ProgramMonth): void {
  const rows = [...month.byVariant, month.notTiedToVariant];
  const sum = (pick: (row: (typeof rows)[number]) => bigint): bigint => rows.reduce((acc, row) => acc + pick(row), ZERO);
  expect(sum((row) => row.laborCents)).toBe(month.totals.laborCents);
  expect(sum((row) => row.materialCents)).toBe(month.totals.materialCents);
  expect(sum((row) => row.otherCents)).toBe(month.totals.otherCents);
  expect(sum((row) => row.sharedCents)).toBe(month.totals.sharedCents);
  expect(sum((row) => row.costCents)).toBe(month.totals.costCents);
  expect(sum((row) => row.revenueCents)).toBe(month.totals.workRevenueCents);
  expect(sum((row) => row.revenueCents) + month.fees.totalCents).toBe(month.totals.revenueCents);
  expect(sum((row) => row.profitCents) + month.fees.totalCents).toBe(month.totals.profitCents);
  expect(sum((row) => quantityToScaled(row.hours))).toBe(quantityToScaled(month.totals.hours));
  expect(sum((row) => quantityToScaled(row.units))).toBe(quantityToScaled(month.totals.units));
  const days = month.days;
  expect(days.reduce((acc, day) => acc + day.revenueCents, ZERO)).toBe(month.totals.revenueCents);
  expect(days.reduce((acc, day) => acc + day.costCents, ZERO)).toBe(month.totals.costCents);
}

describe('programMonthFigures', () => {
  it('splits a day of job cost by each variant\'s good units that day (60% Small Brown gets 60%)', () => {
    const month = programMonthFigures({
      month: '2026-11',
      lines: [line('2026-11-24', 'v-S-BRN', '600', 117000, { scrap: '12' }), line('2026-11-24', 'v-M-BRN', '400', 78000)],
      fees: [],
      jobCosts: [{ date: '2026-11-24', hours: '40', laborCents: b(88000) }],
    });
    const small = month.byVariant.find((row) => row.variantId === 'v-S-BRN');
    const medium = month.byVariant.find((row) => row.variantId === 'v-M-BRN');
    expect(small?.laborCents).toBe(b(52800));
    expect(small?.hours).toBe('24.00');
    expect(small?.scrap).toBe('12.000');
    expect(medium?.laborCents).toBe(b(35200));
    expect(medium?.hours).toBe('16.00');
    expect(month.notTiedToVariant.laborCents).toBe(ZERO);
    expect(month.totals.unitsPerHour).toBe('25.000');
    expectRowsAddUp(month);
  });

  it('splits add up to the cent when the shares do not divide evenly', () => {
    const month = programMonthFigures({
      month: '2026-11',
      lines: [line('2026-11-24', 'a', '1', 195), line('2026-11-24', 'b', '1', 195), line('2026-11-24', 'c', '1', 195)],
      fees: [],
      jobCosts: [
        { date: '2026-11-24', hours: '1', laborCents: b(100), materialCents: b(11), otherCents: b(2), sharedCents: b(1) },
        { date: '2026-11-24', hours: '0.01', laborCents: b(1) },
      ],
    });
    // 101 cents over three equal weights: 34, 34, 33 (ties go to the first in id order).
    expect(month.byVariant.map((row) => [row.variantId, row.laborCents])).toEqual([
      ['a', b(34)],
      ['b', b(34)],
      ['c', b(33)],
    ]);
    expect(month.byVariant.map((row) => row.hours)).toEqual(['0.34', '0.34', '0.33']);
    expectRowsAddUp(month);
  });

  it('a day with job cost and no units keeps the cost in Not tied to a variant', () => {
    const month = programMonthFigures({
      month: '2026-11',
      lines: [line('2026-11-24', 'v-S-BRN', '100', 19500)],
      fees: [],
      jobCosts: [
        { date: '2026-11-23', hours: '6', laborCents: b(13200), materialCents: b(500) },
        { date: '2026-11-24', hours: '4', laborCents: b(8800) },
      ],
    });
    expect(month.notTiedToVariant.laborCents).toBe(b(13200));
    expect(month.notTiedToVariant.materialCents).toBe(b(500));
    expect(month.notTiedToVariant.hours).toBe('6.00');
    expect(month.notTiedToVariant.units).toBe('0.000');
    expect(month.notTiedToVariant.revenueCents).toBe(ZERO);
    expect(month.byVariant[0]?.laborCents).toBe(b(8800));
    const prep = month.days.find((day) => day.date === '2026-11-23');
    expect(prep).toMatchObject({ units: '0.000', hours: '6.00', costCents: b(13700), revenueCents: ZERO, missingHours: false });
    expectRowsAddUp(month);
  });

  it('a day with one variant gives that variant all of the day\'s job cost', () => {
    const month = programMonthFigures({
      month: '2026-11',
      lines: [line('2026-11-23', 'v-S-BRN', '300', 58500), line('2026-11-24', 'v-XL-YLW', '200', 44000), line('2026-11-24', 'v-S-BRN', '200', 39000)],
      fees: [],
      jobCosts: [
        { date: '2026-11-23', hours: '15', laborCents: b(33000), sharedCents: b(1500) },
        { date: '2026-11-24', hours: '20', laborCents: b(44000) },
      ],
    });
    const small = month.byVariant.find((row) => row.variantId === 'v-S-BRN');
    const xl = month.byVariant.find((row) => row.variantId === 'v-XL-YLW');
    expect(small?.laborCents).toBe(b(33000 + 22000));
    expect(small?.sharedCents).toBe(b(1500));
    expect(small?.hours).toBe('25.00');
    expect(xl?.laborCents).toBe(b(22000));
    expect(xl?.sharedCents).toBe(ZERO);
    expectRowsAddUp(month);
  });

  it('keeps build lines with no variant in Not tied to a variant, with their share of the split', () => {
    const month = programMonthFigures({
      month: '2026-11',
      lines: [line('2026-11-24', 'v-S-BRN', '300', 58500), line('2026-11-24', null, '100', 19500, { laborCents: b(1000), hours: '0.50' })],
      fees: [],
      jobCosts: [{ date: '2026-11-24', hours: '8', laborCents: b(17600) }],
    });
    expect(month.notTiedToVariant.revenueCents).toBe(b(19500));
    expect(month.notTiedToVariant.laborCents).toBe(b(1000 + 4400));
    expect(month.notTiedToVariant.hours).toBe('2.50');
    expect(month.byVariant).toHaveLength(1);
    expect(month.byVariant[0]?.laborCents).toBe(b(13200));
    expectRowsAddUp(month);
  });

  it('adds fees to revenue, by kind and by day, and works out the totals', () => {
    const month = programMonthFigures({
      month: '2026-11',
      lines: [
        line('2026-11-02', 'v-S-BRN', '400', 78000, { laborCents: b(4000), hours: '2', materialCents: b(8000) }),
        line('2026-11-02', 'v-XL-BRN', '100', 22000, { materialCents: b(2500), otherCents: b(300) }),
      ],
      fees: [
        { date: '2026-11-01', kind: 'fee', amountCents: b(150000) },
        { date: '2026-11-02', kind: 'adjustment', amountCents: b(-5000) },
      ],
      jobCosts: [{ date: '2026-11-02', hours: '18', laborCents: b(39600) }],
    });
    const totals = month.totals;
    expect(totals.workRevenueCents).toBe(b(100000));
    expect(totals.feeCents).toBe(b(145000));
    expect(totals.revenueCents).toBe(b(245000));
    expect(totals.laborCents).toBe(b(43600));
    expect(totals.materialCents).toBe(b(10500));
    expect(totals.otherCents).toBe(b(300));
    expect(totals.costCents).toBe(b(54400));
    expect(totals.profitCents).toBe(b(190600));
    expect(totals.marginBp).toBe(7780);
    expect(totals.units).toBe('500.000');
    expect(totals.hours).toBe('20.00');
    expect(totals.unitsPerHour).toBe('25.000');
    expect(totals.revenuePerUnitCents).toBe(b(490));
    expect(totals.costPerUnitCents).toBe(b(109));
    expect(totals.profitPerUnitCents).toBe(b(381));
    expect(totals.daysWithUnits).toBe(1);
    expect(month.fees).toEqual({ totalCents: b(145000), byKind: [{ kind: 'adjustment', cents: b(-5000) }, { kind: 'fee', cents: b(150000) }] });
    expect(month.days.map((day) => [day.date, day.workRevenueCents, day.feeCents, day.revenueCents])).toEqual([
      ['2026-11-01', ZERO, b(150000), b(150000)],
      ['2026-11-02', b(100000), b(-5000), b(95000)],
    ]);
    // Variant rows: most revenue first, share of all revenue.
    expect(month.byVariant.map((row) => row.variantId)).toEqual(['v-S-BRN', 'v-XL-BRN']);
    expect(month.byVariant[0]?.revenueShareBp).toBe(3184);
    expectRowsAddUp(month);
  });

  it('flags days that have units and no hours', () => {
    const month = programMonthFigures({
      month: '2026-11',
      lines: [line('2026-11-23', 'a', '100', 19500), line('2026-11-24', 'a', '100', 19500)],
      fees: [],
      jobCosts: [{ date: '2026-11-24', hours: '5', laborCents: b(11000) }],
    });
    expect(month.days.map((day) => [day.date, day.missingHours, day.unitsPerHour])).toEqual([
      ['2026-11-23', true, null],
      ['2026-11-24', false, '20.000'],
    ]);
  });

  it('an empty month has zeros and no margin', () => {
    const month = programMonthFigures({ month: '2026-11', lines: [], fees: [], jobCosts: [] });
    expect(month.totals).toMatchObject({ revenueCents: ZERO, costCents: ZERO, marginBp: null, unitsPerHour: null, costPerUnitCents: null, daysWithUnits: 0 });
    expect(month.byVariant).toEqual([]);
    expect(month.days).toEqual([]);
  });

  it('refuses rows dated outside the month', () => {
    expect(() => programMonthFigures({ month: '2026-11', lines: [line('2026-12-01', 'a', '1', 1)], fees: [], jobCosts: [] })).toThrow(RangeError);
    expect(() => programMonthFigures({ month: '2026-11', lines: [], fees: [{ date: '2026-10-31', kind: 'fee', amountCents: b(1) }], jobCosts: [] })).toThrow(RangeError);
    expect(() => programMonthFigures({ month: '2026-11', lines: [], fees: [], jobCosts: [{ date: '2026-11-31' }] })).toThrow(RangeError);
    expect(() => programMonthFigures({ month: '2026-13', lines: [], fees: [], jobCosts: [] })).toThrow(RangeError);
  });

  it('always adds up to the cent (300 random months)', () => {
    const random = seeded(2611);
    const pick = (n: number): number => Math.floor(random() * n);
    const dates = eachDay('2026-11-01', '2026-11-30');
    const variants = [...VARIANTS.map((variant) => variant.id), null];
    for (let run = 0; run < 300; run += 1) {
      const lines: ProgramLine[] = [];
      const jobCosts: JobCostLine[] = [];
      for (let i = 0; i < 1 + pick(40); i += 1) {
        lines.push(
          line(dates[pick(dates.length)] as IsoDate, variants[pick(variants.length)] ?? null, fromScaled(BigInt(pick(500000)), 3), pick(200000), {
            laborCents: b(pick(5000)),
            hours: fromScaled(BigInt(pick(800)), 2),
            materialCents: b(pick(3000)),
          }),
        );
      }
      for (let i = 0; i < pick(30); i += 1) {
        jobCosts.push({
          date: dates[pick(dates.length)] as IsoDate,
          hours: fromScaled(BigInt(pick(4000)), 2),
          laborCents: b(pick(90000) - 1000),
          materialCents: b(pick(7000)),
          otherCents: b(pick(300)),
          sharedCents: b(pick(2000)),
        });
      }
      const month = programMonthFigures({ month: '2026-11', lines, fees: [{ date: '2026-11-01', kind: 'fee', amountCents: b(pick(200000)) }], jobCosts });
      expectRowsAddUp(month);
    }
  });
});

/* programMonthPlan */

interface ProjectsRead {
  readonly month: string;
  readonly today: IsoDate;
  readonly calendar: ProgramCalendar;
  readonly versions: readonly CardVersion[];
  readonly output: ReturnType<typeof outputFor>;
  readonly oneTime: readonly OneTimeCharge[];
  readonly builds: readonly ProgramPlanBuild[];
  readonly trailing: readonly ProgramTrailingDay[];
  readonly monthlyTargetCents: bigint | null;
}

/**
 * A line by line copy of `programMonthStats` in apps/projects/src/server/domain/programs/stats.ts
 * (and pm-bridge month-stats.ts) after its SQL reads: what Projects shows for the same rows.
 */
function projectsForecast(read: ProjectsRead): ForecastResult {
  const from = firstDayOfMonth(read.month);
  const asOf = read.today < from ? from : read.today;
  const inputs = { programId: PROGRAM_ID, month: read.month, calendar: read.calendar, versions: read.versions, output: read.output, finished: [], time: [], oneTime: read.oneTime };
  const result = monthCharges({ ...inputs, asOf });
  const trailingFrom = addDays(asOf, -45);
  const trailing = read.trailing.filter((day) => day.date >= trailingFrom && day.date < asOf);
  const plannedRows = read.builds.map((build) => ({ id: build.id, date: build.date, planned: build.planned, built: build.built, variant_id: build.variantId, rate: build.rate }));
  const planned = plannedRows
    .filter((row) => row.date >= asOf)
    .map((row) => {
      const remaining = maxCents(ZERO, quantityToScaled(row.planned) - quantityToScaled(row.built));
      let unitPrice = '0.0000';
      try {
        unitPrice = resolveUnitPrice({ workDate: row.date, variantId: row.variant_id, buildOverride: row.rate, versions: inputs.versions }).unitPrice;
      } catch {
        unitPrice = '0.0000';
      }
      const order = remaining > ZERO ? resolveOrderCharge(inputs.versions, row.variant_id, row.date) : null;
      return { buildId: row.id, date: row.date, remainingQty: fromScaled(remaining, 3), unitPrice, orderCents: order ? order.amountCents : null };
    })
    .filter((row) => quantityToScaled(row.remainingQty) > ZERO);
  const trailingDaily = trailing.filter((day) => isPlannableDay(inputs.calendar, day.date)).slice(-20).map((day) => ({ date: day.date, workCents: BigInt(day.cents), units: day.units }));
  const rawForecast = forecastMonth({ month: read.month, asOf, calendar: inputs.calendar, versions: inputs.versions, result, trailingDaily, planned, oneTime: read.oneTime, targetCents: read.monthlyTargetCents });
  const targetCents = read.monthlyTargetCents;
  return rawForecast.targetBp !== null && targetCents !== null && targetCents > ZERO && rawForecast.projectedGapCents > ZERO
    ? { ...rawForecast, targetBp: ratioBp(rawForecast.forecastCents - rawForecast.projectedGapCents, targetCents) }
    : rawForecast;
}

function planFor(read: ProjectsRead) {
  return programMonthPlan({
    facts: { calendar: read.calendar },
    versions: read.versions,
    monthInputs: { programId: PROGRAM_ID, month: read.month, output: read.output, finished: [], time: [], oneTime: read.oneTime },
    asOf: read.today,
    builds: read.builds,
    trailing: read.trailing,
    monthlyTargetCents: read.monthlyTargetCents,
  });
}

/** Builds of one day, one per variant, `planned` each, `built` each. */
function buildsOn(date: IsoDate, planned = '100', built = '0'): ProgramPlanBuild[] {
  return VARIANTS.map((variant) => ({ id: `b-${variant.key}-${date}`, date, planned, built, variantId: variant.id, rate: null }));
}

/** The seed GLOVE November as the engine fixture has it: 100 kits a variant every work day through `today`. */
function gloveNovember(today: IsoDate, partial: Partial<ProjectsRead> = {}): ProjectsRead {
  const workDays = workDaysInMonth(CALENDAR, '2026-11');
  const done = workDays.filter((date) => date <= today);
  const ahead = workDays.filter((date) => date > today);
  const trailingDays = eachDay('2026-10-01', addDays(today, -1)).filter((date) => isWorkDay(CALENDAR, date));
  return {
    month: '2026-11',
    today,
    calendar: CALENDAR,
    versions: VERSIONS,
    output: outputFor(done),
    oneTime: [],
    builds: [...done.flatMap((date) => buildsOn(date, '100', '100')), ...ahead.flatMap((date) => buildsOn(date))],
    trailing: trailingDays.map((date) => ({ date, units: '800.000', cents: date >= '2026-11-01' ? '161000' : '149000' })),
    monthlyTargetCents: BigInt(3200000),
    ...partial,
  };
}

describe('programMonthPlan', () => {
  it('matches Projects\' forecast for the seed GLOVE November to the cent', () => {
    const read = gloveNovember('2026-11-24');
    const plan = planFor(read);
    const projects = projectsForecast(read);
    expect(plan.forecast).toEqual(projects);
    expect(plan.forecastCents).toBe(projects.forecastCents);
    // 17 work days of 800 kits at $1.61 a day, the $1,500.00 fee, and 3 planned days ahead (Nov 26 is off).
    expect(plan.forecastCents).toBe(b(3370000));
    expect(plan.forecastMethod).toBe('planned');
    expect(plan.actualCents).toBe(b(2887000));
    expect(plan.builtUnits).toBe('13600.000');
    expect(plan.plannedUnits).toBe('16000.000');
    expect(plan.targetCents).toBe(b(3200000));
    expect(plan.minimumCents).toBe(b(3000000));
    expect(plan.projectedGapCents).toBe(ZERO);
    expect(plan.forecast.targetBp).toBe(10531);
  });

  it('matches Projects on every day of the month and the days after it', () => {
    for (const today of eachDay('2026-10-20', '2026-12-03')) {
      const read = gloveNovember(today < '2026-11-01' ? '2026-10-31' : today, { today });
      expect(planFor(read).forecast).toEqual(projectsForecast(read));
    }
  });

  it('matches Projects with a slow month, a minimum gap, a late setup fee and a rate override', () => {
    const today = '2026-11-18';
    const base = gloveNovember(today);
    const read: ProjectsRead = {
      ...base,
      output: outputFor(workDaysInMonth(CALENDAR, '2026-11').filter((date) => date <= today), () => '20'),
      trailing: base.trailing.map((day) => ({ ...day, cents: '32200', units: '160.000' })),
      builds: [...buildsOn('2026-11-19', '20', '0'), { id: 'override', date: '2026-11-20', planned: '50', built: '10', variantId: 'v-S-BRN', rate: '2.5000' }],
      oneTime: [{ id: 'setup-2', kind: 'setup', chargeOn: '2026-11-28', amountCents: '250000', label: 'Liner tooling', variantId: null, countsTowardMinimum: false }],
    };
    const plan = planFor(read);
    const projects = projectsForecast(read);
    expect(plan.forecast).toEqual(projects);
    expect(plan.forecastMethod).toBe('recent');
    expect(plan.projectedGapCents > ZERO).toBe(true);
    expect(plan.projectedGapCents).toBe(projects.projectedGapCents);
    // Percent of target leaves the top up out, as Projects does.
    expect(plan.forecast.targetBp).toBe(ratioBp(projects.forecastCents - projects.projectedGapCents, b(3200000)));
  });

  it('counts planned units as built so far plus what open builds from today on still have to make, per variant', () => {
    const today = '2026-11-24';
    const read = gloveNovember(today, {
      output: outputFor(workDaysInMonth(CALENDAR, '2026-11').filter((date) => date <= today), (date) => (date === today ? '70' : '100')),
      builds: [
        // past due and unfinished: left out, as Projects leaves it out
        ...buildsOn('2026-11-20', '120', '100'),
        // today: 70 of 100 built so far, 30 still to make
        ...buildsOn(today, '100', '70'),
        ...buildsOn('2026-11-25'),
      ],
    });
    const plan = planFor(read);
    // built: 16 days of 800 plus 560 today; open: 8 x 30 today plus 800 tomorrow
    expect(plan.builtUnits).toBe('13360.000');
    expect(plan.plannedUnits).toBe(fromScaled(qty('13360') + qty('240') + qty('800'), 3));
    const small = plan.plannedByVariant.find((row) => row.variantId === 'v-S-BRN');
    expect(small).toEqual({ variantId: 'v-S-BRN', units: '1800.000', builtUnits: '1670.000' });
    const sum = plan.plannedByVariant.reduce((acc, row) => acc + qty(row.units), ZERO);
    expect(fromScaled(sum, 3)).toBe(plan.plannedUnits);
    expect(plan.plannedByDay).toHaveLength(30);
    expect(plan.plannedByDay.find((day) => day.date === today)?.units).toBe('800.000');
    expect(plan.plannedByDay.find((day) => day.date === '2026-11-20')?.units).toBe('960.000');
  });

  it('reads a month that has not started as of its first day', () => {
    const read: ProjectsRead = { ...gloveNovember('2026-11-24'), month: '2026-12', output: [], builds: buildsOn('2026-12-01'), trailing: [] };
    const plan = planFor(read);
    expect(plan.asOf).toBe('2026-12-01');
    expect(plan.forecast).toEqual(projectsForecast(read));
    expect(plan.builtUnits).toBe('0.000');
    expect(plan.plannedUnits).toBe('800.000');
  });

  it('has no minimum when the card has none, and no target when none is set', () => {
    const versions = VERSIONS.map((version) => ({ ...version, lines: version.lines.filter((row) => row.kind !== 'monthly_minimum') }));
    const read = gloveNovember('2026-11-24', { versions, monthlyTargetCents: null });
    const plan = planFor(read);
    expect(plan.minimumCents).toBeNull();
    expect(plan.targetCents).toBeNull();
    expect(plan.forecast).toEqual(projectsForecast(read));
  });

  it('refuses a bad date', () => {
    expect(() => planFor(gloveNovember('2026-11-24', { today: '2026-11-31' }))).toThrow(RangeError);
  });
});

/* programCostForecast */

const days = (rows: readonly [IsoDate, string, number][]) => rows.map(([date, units, costCents]) => ({ date, units, costCents: b(costCents) }));

describe('programCostForecast', () => {
  it('uses this month\'s cost per unit with 3 or more work days', () => {
    const month = days([
      ['2026-11-02', '500', 100000],
      ['2026-11-03', '500', 100000],
      ['2026-11-04', '500', 100000],
    ]);
    const forecast = programCostForecast({
      figures: { totals: { units: '1500.000', costCents: b(300000) }, days: month },
      plannedUnits: '2500.000',
      forecastRevenueCents: b(800000),
      priorDays: days([['2026-10-30', '100', 900000]]),
    });
    expect(forecast).toEqual({
      basis: 'month',
      daysUsed: 3,
      costSoFarCents: b(300000),
      unitsSoFar: '1500.000',
      costPerUnitCents: b(200),
      remainingUnits: '1000.000',
      forecastCostCents: b(500000),
      forecastRevenueCents: b(800000),
      forecastProfitCents: b(300000),
      forecastMarginBp: 3750,
    });
  });

  it('uses the last 20 work days with fewer than 3 work days this month', () => {
    const prior = eachDay('2026-10-01', '2026-10-31')
      .filter((date) => isWorkDay(CALENDAR, date))
      .map((date) => ({ date, units: '100', costCents: date < '2026-10-07' ? b(999999) : b(15000) }));
    const month = days([
      ['2026-11-02', '100', 30000],
      ['2026-11-03', '100', 30000],
    ]);
    const forecast = programCostForecast({
      figures: { totals: { units: '200.000', costCents: b(60000) }, days: month },
      plannedUnits: '1200',
      forecastRevenueCents: b(400000),
      priorDays: prior,
    });
    expect(forecast.basis).toBe('recent_days');
    expect(forecast.daysUsed).toBe(20);
    // 18 October days at $150 per 100 kits and the 2 November days at $300: $3,300 over 2,000 kits.
    expect(forecast.costPerUnitCents).toBe(b(165));
    expect(forecast.forecastCostCents).toBe(b(60000 + 165000));
    expect(forecast.forecastMarginBp).toBe(4375);
  });

  it('prices the units left at the exact rate, not the rounded cent', () => {
    const forecast = programCostForecast({
      figures: { totals: { units: '3', costCents: b(1000) }, days: days([['2026-11-02', '1', 333], ['2026-11-03', '1', 333], ['2026-11-04', '1', 334]]) },
      plannedUnits: '6',
      forecastRevenueCents: b(4000),
      priorDays: [],
    });
    expect(forecast.costPerUnitCents).toBe(b(333));
    expect(forecast.forecastCostCents).toBe(b(2000));
  });

  it('keeps cost so far when the plan is already built', () => {
    const forecast = programCostForecast({
      figures: { totals: { units: '900', costCents: b(90000) }, days: days([['2026-11-02', '300', 30000], ['2026-11-03', '300', 30000], ['2026-11-04', '300', 30000]]) },
      plannedUnits: '800',
      forecastRevenueCents: b(180000),
      priorDays: [],
    });
    expect(forecast.remainingUnits).toBe('0.000');
    expect(forecast.forecastCostCents).toBe(b(90000));
    expect(forecast.forecastMarginBp).toBe(5000);
  });

  it('has no forecast margin when there is no cost yet', () => {
    const forecast = programCostForecast({
      figures: { totals: { units: '0', costCents: ZERO }, days: [] },
      plannedUnits: '800',
      forecastRevenueCents: b(160000),
      priorDays: days([['2026-10-30', '800', 80000]]),
    });
    expect(forecast.basis).toBe('recent_days');
    expect(forecast.costPerUnitCents).toBe(b(100));
    expect(forecast.forecastCostCents).toBeNull();
    expect(forecast.forecastMarginBp).toBeNull();
  });

  it('has no forecast when cost has no units to price the rest from', () => {
    const forecast = programCostForecast({
      figures: { totals: { units: '0', costCents: b(5000) }, days: days([['2026-11-02', '0', 5000]]) },
      plannedUnits: '800',
      forecastRevenueCents: b(160000),
      priorDays: [],
    });
    expect(forecast.costPerUnitCents).toBeNull();
    expect(forecast.forecastMarginBp).toBeNull();
  });
});

describe('programTargetMargin', () => {
  it('uses the client target, else the org default, else 30%', () => {
    expect(programTargetMargin({ clientTargetMarginBp: 2500, orgDefaultBp: 3500 })).toEqual({ targetMarginBp: 2500, source: 'client' });
    expect(programTargetMargin({ clientTargetMarginBp: 0, orgDefaultBp: 3500 })).toEqual({ targetMarginBp: 0, source: 'client' });
    expect(programTargetMargin({ clientTargetMarginBp: null, orgDefaultBp: 3500 })).toEqual({ targetMarginBp: 3500, source: 'org' });
    expect(programTargetMargin({})).toEqual({ targetMarginBp: 3000, source: 'org' });
  });
});
