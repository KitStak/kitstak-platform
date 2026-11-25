import { describe, expect, it } from 'vitest';
import { eachDay, isWorkDay, workDaysInMonth } from './calendar';
import { FORECAST_METHOD_LABELS, HEALTH_BASIS_LABELS, HEALTH_LABELS, type ForecastInput, forecastMonth, programHealth } from './forecast';
import { CALENDAR, PROGRAM_ID, VARIANTS, VERSIONS, line, outputFor } from './glove.fixture';
import { monthCharges } from './month';
import { resolveUnitPrice } from './price';
import type { CardVersion, IsoDate, OneTimeCharge } from './types';

const DAY_CENTS = BigInt(161000);

function november(asOf: IsoDate) {
  const days = workDaysInMonth(CALENDAR, '2026-11').filter((date) => date <= asOf);
  return monthCharges({ programId: PROGRAM_ID, month: '2026-11', asOf, calendar: CALENDAR, versions: VERSIONS, output: outputFor(days), finished: [], time: [], oneTime: [] });
}

const trailing = eachDay('2026-11-01', '2026-11-24')
  .filter((date) => isWorkDay(CALENDAR, date))
  .slice(-10)
  .map((date) => ({ date, workCents: DAY_CENTS, units: '800' }));

function input(partial: Partial<ForecastInput> = {}): ForecastInput {
  return { month: '2026-11', asOf: '2026-11-24', calendar: CALENDAR, versions: VERSIONS, result: november('2026-11-24'), trailingDaily: trailing, planned: [], oneTime: [], targetCents: null, ...partial };
}

function plannedFor(dates: readonly IsoDate[]) {
  return dates.flatMap((date) =>
    VARIANTS.map((variant) => ({ buildId: `p-${variant.key}-${date}`, date, remainingQty: '100', unitPrice: resolveUnitPrice({ workDate: date, variantId: variant.id, buildOverride: null, versions: VERSIONS }).unitPrice, orderCents: null })),
  );
}

describe('forecastMonth', () => {
  it('E17 based on recent days', () => {
    const result = forecastMonth(input());
    expect(result.remainingWorkDays).toBe(3);
    expect(result.avgDailyWorkCents).toBe(DAY_CENTS);
    expect(result.method).toBe('recent');
    expect(result.recentCents).toBe(BigInt(3370000));
    expect(result.projectedGapCents).toBe(BigInt(0));
    expect(result.forecastCents).toBe(BigInt(3370000));
    expect(result.actualCents).toBe(BigInt(2887000));
    expect(result.targetBp).toBeNull();
    expect(result.targetGapCents).toBeNull();
  });

  it('E18 based on planned builds', () => {
    const result = forecastMonth(input({ planned: plannedFor(['2026-11-25', '2026-11-27', '2026-11-30']) }));
    expect(result.method).toBe('planned');
    expect(result.plannedCents).toBe(BigInt(3370000));
    expect(result.forecastCents).toBe(BigInt(3370000));
  });

  it('uses recent days when planned builds cover too few days', () => {
    const result = forecastMonth(input({ planned: plannedFor(['2026-11-25']) }));
    expect(result.method).toBe('recent');
    expect(result.plannedCents).toBe(BigInt(3150000));
  });

  it('fills the rest of today from the average when today is short', () => {
    const asOf = '2026-11-24';
    const days = workDaysInMonth(CALENDAR, '2026-11').filter((date) => date < asOf);
    const output = [...outputFor(days), ...outputFor([asOf], () => '50')];
    const result = monthCharges({ programId: PROGRAM_ID, month: '2026-11', asOf, calendar: CALENDAR, versions: VERSIONS, output, finished: [], time: [], oneTime: [] });
    const forecast = forecastMonth(input({ result }));
    expect(forecast.recentCents).toBe(BigInt(2737000 + 150000 + 3 * 161000));
  });

  it('projects the minimum gap and the target', () => {
    const slow = forecastMonth(input({ trailingDaily: trailing.map((day) => ({ ...day, workCents: BigInt(1000) })), targetCents: BigInt(3500000) }));
    expect(slow.recentCents).toBe(BigInt(2737000 + 3000 + 150000 + (3000000 - 2740000)));
    expect(slow.projectedGapCents).toBe(BigInt(260000));
    expect(slow.targetBp).toBe(9000);
    expect(slow.targetGapCents).toBe(BigInt(350000));
  });

  it('with no recent days the average is 0', () => {
    const result = forecastMonth(input({ trailingDaily: [] }));
    expect(result.avgDailyWorkCents).toBe(BigInt(0));
  });

  it('a month that is over forecasts its actual total', () => {
    const asOf = '2026-12-01';
    const result = november(asOf);
    const forecast = forecastMonth(input({ asOf, result }));
    expect(forecast.remainingWorkDays).toBe(0);
    expect(forecast.method).toBe('recent');
    expect(forecast.forecastCents).toBe(result.totalCents);
    expect(forecastMonth(input({ asOf: '2026-11-30', result: november('2026-11-30'), planned: plannedFor(['2026-11-30']) })).method).toBe('planned');
  });

  it('counts setup fees and adjustments dated later in the month', () => {
    const later: OneTimeCharge = { id: 'setup-2', kind: 'setup', chargeOn: '2026-11-28', amountCents: '250000', label: 'Liner tooling', variantId: null, countsTowardMinimum: false };
    const otherMonth: OneTimeCharge = { ...later, id: 'setup-3', chargeOn: '2026-12-02' };
    const result = forecastMonth(input({ oneTime: [later, otherMonth] }));
    expect(result.recentCents).toBe(BigInt(3370000 + 250000));
    expect(result.forecastCents - result.avgDailyWorkCents * BigInt(3) - BigInt(2737000)).toBe(BigInt(400000));
  });

  it('only adjustments that count toward the minimum close the projected gap', () => {
    const credit: OneTimeCharge = { id: 'adj-1', kind: 'adjustment', chargeOn: '2026-11-27', amountCents: '100000', label: 'Rework credit', variantId: null, countsTowardMinimum: true };
    const refund: OneTimeCharge = { id: 'adj-2', kind: 'adjustment', chargeOn: '2026-11-30', amountCents: '-55000', label: 'Credit for bad orders', variantId: null, countsTowardMinimum: false };
    const slow = forecastMonth(input({ trailingDaily: trailing.map((day) => ({ ...day, workCents: BigInt(1000) })), oneTime: [credit, refund] }));
    expect(slow.projectedGapCents).toBe(BigInt(160000));
    expect(slow.recentCents).toBe(BigInt(2740000 + 150000 + 100000 - 55000 + 160000));
  });

  it('a future month leaves out builds dated before the month starts', () => {
    const simple: CardVersion = {
      id: 's1',
      number: 1,
      effectiveFrom: '2026-09-01',
      rules: [],
      lines: [line({ id: 's1-unit', kind: 'per_unit', unitPrice: '1.00' }), line({ id: 's1-fee', kind: 'flat_monthly', amountCents: '150000' })],
    };
    const asOf = '2026-11-24';
    const december = monthCharges({ programId: PROGRAM_ID, month: '2026-12', asOf, calendar: CALENDAR, versions: [simple], output: [], finished: [], time: [], oneTime: [] });
    const build = (buildId: string, date: IsoDate) => ({ buildId, date, remainingQty: '100', unitPrice: '1.0000', orderCents: null });
    const base = { month: '2026-12', asOf, calendar: CALENDAR, versions: [simple], result: december, trailingDaily: trailing, oneTime: [], targetCents: null } as const;
    expect(forecastMonth({ ...base, planned: [build('nov', '2026-11-25')] }).plannedCents).toBe(BigInt(150000));
    expect(forecastMonth({ ...base, planned: [build('nov', '2026-11-25'), build('dec', '2026-12-01'), build('jan', '2027-01-04')] }).plannedCents).toBe(BigInt(160000));
  });

  it('paused days do not pull the recent average down', () => {
    const paused = { ...CALENDAR, paused: [{ from: '2026-11-09', to: '2026-11-13' }] };
    const daily = eachDay('2026-10-26', '2026-11-23')
      .filter((date) => isWorkDay(CALENDAR, date))
      .map((date) => ({ date, workCents: date >= '2026-11-09' && date <= '2026-11-13' ? BigInt(0) : DAY_CENTS, units: '800' }));
    const result = forecastMonth(input({ calendar: paused, trailingDaily: daily }));
    expect(result.avgDailyWorkCents).toBe(DAY_CENTS);
    expect(forecastMonth(input({ trailingDaily: daily })).avgDailyWorkCents).toBe(BigInt(96600));
  });

  it('MAHCO: an hourly program forecasts from actuals and open builds dated today on (3.8), and shows its minimum gap', () => {
    // MAHCO (7.1): $0.95 per pack, $42.00 per hour, a $12,000 minimum, active all of November.
    const mahco: CardVersion = {
      id: 'm1',
      number: 1,
      effectiveFrom: '2026-09-01',
      rules: [],
      lines: [line({ id: 'm1-unit', kind: 'per_unit', unitPrice: '0.95' }), line({ id: 'm1-hour', kind: 'per_hour', rateCents: 4200 }), line({ id: 'm1-min', kind: 'monthly_minimum', amountCents: '1200000' })],
    };
    const packs = ['m-a', 'm-b', 'm-c', 'm-d'];
    const asOf = '2026-11-25';
    // The Monday run: 500 of each pack, made Mon 200, Tue 200, Wed 100.
    const split: readonly [number, string][] = [[0, '200'], [1, '200'], [2, '100']];
    const output = ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23'].flatMap((monday) =>
      packs.flatMap((pack) =>
        split.map(([offset, qty]) => {
          const workDate = eachDay(monday, '2026-11-30')[offset] as IsoDate;
          return { buildId: `b-${pack}-${monday}`, variantId: pack, workDate, qty, scrapQty: '0', unitPrice: '0.9500', priceSource: 'card' as const, versionId: 'm1', revenueCents: String(Number(qty) * 95), posting: 'program' as const, pulseJobId: null };
        }),
      ),
    );
    // "Sort and recount": 90 minutes ($63.00) on each Tuesday and Thursday through today.
    const time = ['2026-11-03', '2026-11-05', '2026-11-10', '2026-11-12', '2026-11-17', '2026-11-19', '2026-11-24'].map((workDate) => ({ workDate, buildId: null, variantId: null, minutes: 90 }));
    const result = monthCharges({ programId: PROGRAM_ID, month: '2026-11', asOf, calendar: CALENDAR, versions: [mahco], output, finished: [], time, oneTime: [] });
    expect(result.work.perUnitCents).toBe(BigInt(760000));
    expect(result.work.perHourCents).toBe(BigInt(44100));
    expect(result.work.totalCents).toBe(BigInt(804100));
    const trailingDaily = result.byDay.filter((day) => day.date < asOf && isWorkDay(CALENDAR, day.date)).map((day) => ({ date: day.date, workCents: day.workCents, units: day.units }));
    const build = (buildId: string, date: IsoDate, remainingQty: string) => ({ buildId, date, remainingQty, unitPrice: '0.9500', orderCents: null });
    const planned = [
      ...packs.map((pack) => build(`b-${pack}-2026-11-30`, '2026-11-30', '500')),
      build('b-make-up', '2026-11-27', '100'),
      // Past due (dated before today) and next month: not in the 3.8 sum.
      build('b-late', '2026-11-23', '50'),
      build('b-dec', '2026-12-07', '500'),
    ];
    const forecast = forecastMonth({ month: '2026-11', asOf, calendar: CALENDAR, versions: [mahco], result, trailingDaily, planned, oneTime: [], targetCents: null });
    expect(forecast.remainingWorkDays).toBe(2);
    expect(forecast.method).toBe('planned');
    expect(forecast.avgDailyWorkCents).toBe(BigInt(40520));
    // Planned work: $8,041.00 actual + 4 x 500 x $0.95 on Nov 30 + 100 x $0.95 on Nov 27 = $10,036.00.
    // The $12,000 minimum leaves a projected gap of $1,964.00, which the MAHCO alert shows.
    expect(forecast.projectedGapCents).toBe(BigInt(196400));
    expect(forecast.plannedCents).toBe(BigInt(1200000));
    expect(forecast.forecastCents).toBe(BigInt(1200000));
    // Recent: $8,041.00 + the rest of today ($405.20 - $380.00) + 2 days x $405.20 = $8,876.60, a $3,123.40 gap.
    expect(forecast.recentCents).toBe(BigInt(1200000));
    expect(forecastMonth({ month: '2026-11', asOf, calendar: CALENDAR, versions: [mahco], result, trailingDaily, planned: planned.slice(0, 4), oneTime: [], targetCents: null })).toMatchObject({ method: 'recent', projectedGapCents: BigInt(312340) });
  });

  it('has words for each method', () => {
    expect(FORECAST_METHOD_LABELS).toEqual({ planned: 'Based on planned builds', recent: 'Based on recent days' });
  });
});

describe('programHealth', () => {
  it('E44 from planned vs built when there are no targets', () => {
    expect(programHealth({ targetBp: null, dailyTargetUnits: null, recentUnitsPerDay: null, lastWorkDays: [{ planned: '800', built: '720' }, { planned: '800', built: '720' }, { planned: '800', built: '720' }, { planned: '800', built: '720' }, { planned: '800', built: '720' }] })).toEqual({ health: 'at_risk', basis: 'plan' });
  });
  it('the money target wins, with its bands', () => {
    const health = (targetBp: number) => programHealth({ targetBp, dailyTargetUnits: '800', recentUnitsPerDay: '100', lastWorkDays: [] });
    expect(health(10533)).toEqual({ health: 'on_track', basis: 'money_target' });
    expect(health(9000)).toEqual({ health: 'at_risk', basis: 'money_target' });
    expect(health(8999)).toEqual({ health: 'off_track', basis: 'money_target' });
  });
  it('then the daily unit target', () => {
    expect(programHealth({ targetBp: null, dailyTargetUnits: '800', recentUnitsPerDay: '820', lastWorkDays: [] })).toEqual({ health: 'on_track', basis: 'unit_target' });
    expect(programHealth({ targetBp: null, dailyTargetUnits: '800', recentUnitsPerDay: '600', lastWorkDays: [] })).toEqual({ health: 'off_track', basis: 'unit_target' });
    expect(programHealth({ targetBp: null, dailyTargetUnits: '0', recentUnitsPerDay: '600', lastWorkDays: [] })).toBeNull();
  });
  it('plan bands, the last 5 days only, and no data', () => {
    const days = (built: string) => [{ planned: '0', built: '999' }, ...Array.from({ length: 5 }, () => ({ planned: '100', built }))];
    expect(programHealth({ targetBp: null, dailyTargetUnits: null, recentUnitsPerDay: null, lastWorkDays: days('95') })?.health).toBe('on_track');
    expect(programHealth({ targetBp: null, dailyTargetUnits: null, recentUnitsPerDay: null, lastWorkDays: days('84') })?.health).toBe('off_track');
    expect(programHealth({ targetBp: null, dailyTargetUnits: null, recentUnitsPerDay: null, lastWorkDays: [] })).toBeNull();
  });
  it('has words for each state and basis', () => {
    expect(HEALTH_LABELS.at_risk).toBe('At risk');
    expect(HEALTH_BASIS_LABELS.plan).toBe('From planned vs built, last 5 work days');
  });
});

describe('forecastMonth input (spec 3.8 shape)', () => {
  it('works with the fields 3.8 lists: no oneTime', () => {
    const specTrailing = trailing.map(({ date, workCents, units }) => ({ date, workCents, units }));
    const { oneTime: _drop, ...rest } = input({ trailingDaily: specTrailing });
    void _drop;
    const forecast = forecastMonth(rest);
    expect(forecast.forecastCents).toBe(BigInt(3370000));
  });
  it('uses the one time charges already in the result when oneTime is left out', () => {
    const credit: OneTimeCharge = { id: 'c1', kind: 'adjustment', chargeOn: '2026-11-10', amountCents: '-20000', label: 'Credit', variantId: null, countsTowardMinimum: true };
    const result = monthCharges({ programId: PROGRAM_ID, month: '2026-11', asOf: '2026-11-24', calendar: CALENDAR, versions: VERSIONS, output: outputFor(workDaysInMonth(CALENDAR, '2026-11').filter((date) => date <= '2026-11-24')), finished: [], time: [], oneTime: [credit] });
    const { oneTime: _drop, ...rest } = input({ result });
    void _drop;
    expect(forecastMonth(rest).forecastCents).toBe(BigInt(3370000 - 20000));
    expect(forecastMonth({ ...rest, oneTime: [credit] }).forecastCents).toBe(BigInt(3370000 - 20000));
  });
  it('refuses a bad asOf, a bad month or a result of another month', () => {
    expect(() => forecastMonth(input({ asOf: 'nope' }))).toThrow(new RangeError('Not a YYYY-MM-DD date: "nope"'));
    expect(() => forecastMonth(input({ month: '2026-00' }))).toThrow(RangeError);
    expect(() => forecastMonth(input({ month: '2026-12' }))).toThrow(new RangeError('The result is for 2026-11, not 2026-12.'));
  });
});
