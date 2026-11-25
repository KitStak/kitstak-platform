import { describe, expect, it } from 'vitest';
import type { DayRollupDTO, ForecastResultDTO, MonthResultDTO } from '@/lib/program-types';
import { alertViews, avgPerDayText, chargeGroupOf, compareWithLastMonth, cumulativeThrough, groupTotals, minimumKpi, minimumReason, monthChart, monthLong, variantChartColor, weekdayDate } from './overview-model';

const unit = { singular: 'kit', plural: 'kits' };
const day = (date: string, units: string, cumulative: string, planned = '0.000'): DayRollupDTO => ({ date, units, plannedUnits: planned, workCents: '0', feeCents: '0', cumulativeCents: cumulative });

const result = (minimum: MonthResultDTO['minimum']): MonthResultDTO => ({ month: '2026-11', units: '0', work: null, fixed: null, adjustments: null, minimum, totalCents: '0', unpricedUnits: '0' });
const forecast = (projectedGapCents: string | null): ForecastResultDTO => ({ actualCents: '0', recentCents: '0', plannedCents: '0', forecastCents: '0', method: 'planned', methodText: 'Based on planned builds', remainingWorkDays: 3, avgDailyWorkCents: '0', projectedGapCents, targetGapCents: null, targetBp: null });

describe('alerts', () => {
  const context = { unit, programKey: 'GLOVE', today: '2026-11-25', seesSync: false, variantName: () => 'Small Brown' };
  it('words the over plan alert from the seed', () => {
    const [alert] = alertViews([{ kind: 'over_plan', buildId: 'b', buildKey: 'GLOVE-212', overQty: '12.000', date: '2026-11-20' }], context);
    expect(alert?.text).toBe('GLOVE-212 is 12 kits over plan');
    expect(alert?.actionLabel).toBe('Open');
  });
  it('says yesterday only for yesterday', () => {
    expect(alertViews([{ kind: 'no_output_yesterday', date: '2026-11-24', builds: 3 }], context)[0]?.text).toBe('No output logged yesterday for 3 builds');
    expect(alertViews([{ kind: 'no_output_yesterday', date: '2026-11-20', builds: 1 }], context)[0]?.text).toBe('No output logged on Nov 20 for 1 build');
  });
  it('hides sync gaps from people who do not see sync until 10 minutes pass', () => {
    const alert = { kind: 'pulse_out_of_sync' as const, deltaCents: '1240', reason: 'gap' as const };
    expect(alertViews([alert], context)).toHaveLength(0);
    expect(alertViews([alert], { ...context, gapMinutes: 12 })[0]?.text).toBe('Pulse is catching up');
    expect(alertViews([alert], { ...context, seesSync: true })[0]?.text).toBe('Pulse is $12.40 off from Projects');
  });
  it('sorts the worst first', () => {
    const views = alertViews([{ kind: 'version_starts_soon', versionNumber: 3, effectiveFrom: '2027-01-01' }, { kind: 'minimum_at_risk', projectedGapCents: '124000' }], context);
    expect(views.map((view) => view.kind)).toEqual(['minimum_at_risk', 'version_starts_soon']);
    expect(views[0]?.text).toBe('May miss the minimum by $1,240.00');
  });
});

describe('KPIs', () => {
  it('compares with last month at the same day', () => {
    const now = [day('2026-11-01', '0', '0'), day('2026-11-02', '1', '12700')];
    const then = [day('2026-10-01', '0', '0'), day('2026-10-02', '1', '10000')];
    expect(cumulativeThrough(now, 2)).toBe(BigInt(12700));
    expect(compareWithLastMonth(now, then, '2026-11-02')).toEqual({ text: 'up 27% vs last month at this point', tone: 'success' });
    expect(compareWithLastMonth(now, [], '2026-11-02')).toBeNull();
  });
  it('averages units per work day', () => {
    expect(avgPerDayText('14172.000', 18)).toBe('Avg 787 a work day');
    expect(avgPerDayText('0', 0)).toBeNull();
  });
  it('words the minimum', () => {
    expect(minimumKpi(result(null), forecast(null)).value).toBe('Not set');
    expect(minimumKpi(result({ minimumCents: '3000000', gapSoFarCents: '0', topUpCents: '0', status: 'met', statusText: '' }), forecast('0')).value).toBe('Met');
    expect(minimumKpi(result({ minimumCents: '3000000', gapSoFarCents: '152960', topUpCents: '0', status: 'pending', statusText: '' }), forecast('0'))).toEqual({ value: 'Below minimum by $1,529.60 so far', line: 'on track to meet it', tone: 'neutral', reason: null });
    expect(minimumKpi(result({ minimumCents: '3000000', gapSoFarCents: '152960', topUpCents: '0', status: 'pending', statusText: '' }), forecast('124000')).value).toBe('May miss it by $1,240.00');
  });
});

describe('month chart', () => {
  it('draws actual through today and one forecast line to the month end', () => {
    const byDay = [day('2026-11-28', '10', '1000', '10'), day('2026-11-29', '0', '1000', '10'), day('2026-11-30', '0', '1000', '20')];
    const chart = monthChart({ month: '2026-11', asOf: '2026-11-28', byDay, metric: 'revenue', forecastCents: '3000', targetCents: '6000', minimumCents: '500', dailyTargetUnits: null, workDays: 20 });
    expect(chart.actual).toEqual([10, null, null]);
    expect(chart.forecast).toEqual([10, 20, 30]);
    expect(chart.target?.[2]).toBe(60);
    expect(chart.minimum).toEqual([5, 5, 5]);
    expect(chart.daily.map((entry) => entry.future)).toEqual([false, true, true]);
    const units = monthChart({ month: '2026-11', asOf: '2026-11-28', byDay, metric: 'units', forecastCents: null, targetCents: null, minimumCents: null, dailyTargetUnits: null, workDays: 20 });
    expect(units.forecast).toEqual([10, 20, 40]);
  });
});

describe('statement groups', () => {
  it('maps ledger kinds and totals by group in order', () => {
    expect(chargeGroupOf('minimum_top_up')).toBe('minimum_top_up');
    expect(groupTotals([{ kind: 'setup', cents: '25000' }, { kind: 'flat_monthly', cents: '48333' }, { kind: 'adjustment', cents: '-1000' }]).map((group) => [group.group, String(group.cents)])).toEqual([
      ['flat_monthly', '48333'],
      ['setup', '25000'],
      ['adjustment', '-1000'],
    ]);
  });
});

describe('words', () => {
  it('formats months, days and colors', () => {
    expect(monthLong('2026-11')).toBe('November 2026');
    expect(weekdayDate('2026-11-25')).toBe('Wed Nov 25');
    expect(variantChartColor('blue', 0)).toBe('var(--label-blue)');
    expect(variantChartColor(null, 1)).toBe('var(--chart-2)');
  });
});

describe('minimumReason', () => {
  it('explains a minimum cut for a mid month start for a mid month start', () => {
    expect(minimumReason('290000', '300000', '2026-11', '2026-11-02')).toBe('$3,000.00 on the card, cut for the Nov 2 start');
    expect(minimumReason('300000', '300000', '2026-11', '2026-11-02')).toBeNull();
    expect(minimumReason('300000', null, '2026-11', '2026-11-02')).toBeNull();
    expect(minimumReason('150000', '300000', '2026-12', '2026-11-02', '2026-12-15')).toBe('$3,000.00 on the card, cut for the Dec 15 end');
  });
});
