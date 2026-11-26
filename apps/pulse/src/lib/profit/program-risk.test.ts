import { describe, expect, it } from 'vitest';
import type { IsoDate } from './types';
import { eachDay, isWorkDay } from './calendar';
import { type JobCostLine, type ProgramLine, programMonthFigures } from './program';
import { PROGRAM_ALERT_ACTION_LABELS, type ProgramRiskInput, programAlerts } from './program-risk';

const b = (value: number): bigint => BigInt(value);
const ZERO = BigInt(0);
const WORK_DAYS = eachDay('2026-11-02', '2026-11-24').filter((date) => isWorkDay(date) && date !== '2026-11-26');

interface DayPlan {
  /** Small Brown kits and revenue. */
  readonly a?: { units: string; cents: number };
  /** XL Yellow kits and revenue. */
  readonly b?: { units: string; cents: number };
  /** Program job hours and labor. Null leaves the day with no hours. */
  readonly job?: { hours: string; cents: number } | null;
}

/** A healthy GLOVE month: 300 Small Brown at $1.95 and 100 XL Yellow at $2.20 a day, 20 hours at $20.00. */
function month(dayPlan: (date: IsoDate) => DayPlan = () => ({})) {
  const lines: ProgramLine[] = [];
  const jobCosts: JobCostLine[] = [];
  for (const date of WORK_DAYS) {
    const plan = dayPlan(date);
    const a = plan.a ?? { units: '300', cents: 58500 };
    const x = plan.b ?? { units: '100', cents: 22000 };
    lines.push({ date, variantId: 'v-S-BRN', units: a.units, revenueCents: b(a.cents) });
    lines.push({ date, variantId: 'v-XL-YLW', units: x.units, revenueCents: b(x.cents) });
    const job = plan.job === undefined ? { hours: '20', cents: 40000 } : plan.job;
    if (job) jobCosts.push({ date, hours: job.hours, laborCents: b(job.cents) });
  }
  return programMonthFigures({ month: '2026-11', lines, fees: [], jobCosts });
}

function input(partial: Partial<ProgramRiskInput> = {}): ProgramRiskInput {
  return {
    programLabel: 'GLOVE',
    asOf: '2026-11-24',
    figures: month(),
    plan: { projectedGapCents: ZERO, minimumCents: b(3000000) },
    forecastMarginBp: 4500,
    targetMarginBp: 3000,
    thresholds: { atRiskGapBp: 1000, marginFloorBp: 1000 },
    closedMonths: [],
    variantNames: { 'v-S-BRN': 'Small Brown', 'v-XL-YLW': 'XL Yellow' },
    ...partial,
  };
}

const KIT = { unitLabel: 'kit' } as const;
const rules = (partial: Partial<ProgramRiskInput> = {}, options = KIT) => programAlerts(input(partial), options).map((alert) => alert.rule);
const sentence = (rule: string, partial: Partial<ProgramRiskInput> = {}, options = KIT) => programAlerts(input(partial), options).find((alert) => alert.rule === rule)?.sentence;

describe('programAlerts', () => {
  it('a healthy month has no alerts', () => {
    expect(programAlerts(input(), KIT)).toEqual([]);
  });

  it('P1 fires when the forecast margin is more than the at risk gap under the target', () => {
    const alerts = programAlerts(input({ forecastMarginBp: 1800 }), KIT);
    expect(alerts).toEqual([{ rule: 'P1', sentence: 'GLOVE is heading for an 18% margin this month. The target is 30%.', action: 'see_variants', actionLabel: 'See by variant', variantId: null }]);
    expect(sentence('P1', { forecastMarginBp: 1500 })).toBe('GLOVE is heading for a 15% margin this month. The target is 30%.');
  });

  it('P1 does not fire inside the gap, with no forecast, or before 3 work days with units', () => {
    expect(rules({ forecastMarginBp: 2000 })).toEqual([]);
    expect(rules({ forecastMarginBp: 2500 })).toEqual([]);
    expect(rules({ forecastMarginBp: null })).toEqual([]);
    const early = programMonthFigures({
      month: '2026-11',
      lines: [
        { date: '2026-11-02', variantId: 'v-S-BRN', units: '300', revenueCents: b(58500) },
        { date: '2026-11-03', variantId: 'v-S-BRN', units: '300', revenueCents: b(58500) },
      ],
      fees: [],
      jobCosts: [
        { date: '2026-11-02', hours: '20', laborCents: b(40000) },
        { date: '2026-11-03', hours: '20', laborCents: b(40000) },
      ],
    });
    expect(rules({ figures: early, forecastMarginBp: 500, asOf: '2026-11-03' })).toEqual([]);
  });

  it('P2 fires under the floor and takes the place of P1', () => {
    expect(programAlerts(input({ forecastMarginBp: 900 }), KIT)).toEqual([{ rule: 'P2', sentence: 'GLOVE is heading below the 10% floor this month.', action: 'see_variants', actionLabel: 'See by variant', variantId: null }]);
    expect(rules({ forecastMarginBp: -500 })).toEqual(['P2']);
    expect(rules({ forecastMarginBp: 1000 })).toEqual(['P1']);
  });

  it('P3 fires when cost per unit is more than 10% above the last 3 closed months', () => {
    // This month: $40,000.00 a day over 400 kits is $1.00 a kit. Closed months: $0.90.
    const closedMonths = [
      { month: '2026-10', units: '1000', costCents: b(90000) },
      { month: '2026-09', units: '1000', costCents: b(90000) },
      { month: '2026-08', units: '1000', costCents: b(90000) },
      // older than the last 3: not read
      { month: '2026-07', units: '1000', costCents: b(10) },
    ];
    expect(programAlerts(input({ closedMonths }), KIT)).toEqual([{ rule: 'P3', sentence: 'Each kit costs $1.00 this month, up from $0.90.', action: 'see_days', actionLabel: 'See days', variantId: null }]);
  });

  it('P3 does not fire at 10% or less, or with no closed months', () => {
    expect(rules({ closedMonths: [{ month: '2026-10', units: '1100', costCents: b(100000) }] })).toEqual([]);
    expect(rules({ closedMonths: [{ month: '2026-10', units: '1000', costCents: b(95000) }] })).toEqual([]);
    expect(rules({ closedMonths: [] })).toEqual([]);
  });

  it('P4 fires for a variant under the floor with at least 100 units, worst first', () => {
    // XL Yellow carries a quarter of the labor: $100.00 a day for 100 kits.
    const losing = month(() => ({ b: { units: '100', cents: 6900 } }));
    expect(programAlerts(input({ figures: losing }), KIT)).toEqual([{ rule: 'P4', sentence: 'XL Yellow loses $0.31 a kit.', action: 'open_variant', actionLabel: 'Open variant', variantId: 'v-XL-YLW' }]);
    const thin = month(() => ({ b: { units: '100', cents: 10500 } }));
    expect(sentence('P4', { figures: thin })).toBe('XL Yellow makes $0.05 a kit, under the 10% floor.');
    const both = month(() => ({ a: { units: '300', cents: 31000 }, b: { units: '100', cents: 6900 } }));
    expect(programAlerts(input({ figures: both }), KIT).map((alert) => alert.variantId)).toEqual(['v-XL-YLW', 'v-S-BRN']);
    expect(sentence('P4', { figures: losing, variantNames: {} })).toBe('Removed variant loses $0.31 a kit.');
  });

  it('P4 does not fire under 100 units or above the floor', () => {
    const few = programMonthFigures({
      month: '2026-11',
      lines: [
        { date: '2026-11-24', variantId: 'v-S-BRN', units: '300', revenueCents: b(58500) },
        { date: '2026-11-24', variantId: 'v-XL-YLW', units: '99', revenueCents: b(100) },
      ],
      fees: [],
      jobCosts: [{ date: '2026-11-24', hours: '20', laborCents: b(40000) }],
    });
    expect(rules({ figures: few })).not.toContain('P4');
    expect(rules({ figures: month(() => ({ b: { units: '100', cents: 11200 } })) })).not.toContain('P4');
  });

  it('P5 fires when the forecast misses the monthly minimum', () => {
    expect(programAlerts(input({ plan: { projectedGapCents: b(124000), minimumCents: b(290000) } }), KIT)).toEqual([
      { rule: 'P5', sentence: 'May miss the $2,900 minimum by $1,240.00.', action: 'open_in_projects', actionLabel: 'Open program in Projects', variantId: null },
    ]);
  });

  it('P5 does not fire with no gap or no minimum', () => {
    expect(rules({ plan: { projectedGapCents: ZERO, minimumCents: b(290000) } })).toEqual([]);
    expect(rules({ plan: { projectedGapCents: ZERO, minimumCents: null } })).toEqual([]);
  });

  it('P6 fires for days with kits and no hours', () => {
    const one = month((date) => ({ job: date === '2026-11-10' ? null : undefined }));
    expect(programAlerts(input({ figures: one }), KIT)).toEqual([{ rule: 'P6', sentence: '1 day has kits but no hours.', action: 'add_hours', actionLabel: 'Add hours', variantId: null }]);
    const three = month((date) => ({ job: ['2026-11-09', '2026-11-10', '2026-11-11'].includes(date) ? null : undefined }));
    expect(sentence('P6', { figures: three })).toBe('3 days have kits but no hours.');
    expect(programAlerts(input({ figures: three })).find((alert) => alert.rule === 'P6')?.sentence).toBe('3 days have units but no hours.');
  });

  it('P6 does not fire when every day with kits has hours', () => {
    expect(rules()).not.toContain('P6');
  });

  it('P7 fires when units per hour this week is 15% or more under the month', () => {
    const slow = month((date) => ({ job: date >= '2026-11-23' ? { hours: '25', cents: 50000 } : undefined }));
    // This week: 800 kits in 50 hours (16.0). Month: 6,800 kits in 350 hours (19.4).
    expect(programAlerts(input({ figures: slow }), KIT)).toEqual([{ rule: 'P7', sentence: 'The crew is 18% slower this week.', action: 'see_days', actionLabel: 'See days', variantId: null }]);
  });

  it('P7 does not fire for a small slowdown or with no hours this week', () => {
    const mild = month((date) => ({ job: date >= '2026-11-23' ? { hours: '23', cents: 46000 } : undefined }));
    expect(rules({ figures: mild })).not.toContain('P7');
    expect(rules({ asOf: '2026-11-30' })).not.toContain('P7');
  });

  it('lists alerts in rule order', () => {
    const figures = month((date) => ({ b: { units: '100', cents: 6900 }, job: date === '2026-11-03' ? null : date >= '2026-11-23' ? { hours: '25', cents: 50000 } : undefined }));
    const alerts = programAlerts(
      input({ figures, forecastMarginBp: 1500, plan: { projectedGapCents: b(50000), minimumCents: b(3000000) }, closedMonths: [{ month: '2026-10', units: '1000', costCents: b(50000) }] }),
      KIT,
    );
    expect(alerts.map((alert) => alert.rule)).toEqual(['P1', 'P3', 'P4', 'P5', 'P6', 'P7']);
    for (const alert of alerts) expect(alert.actionLabel).toBe(PROGRAM_ALERT_ACTION_LABELS[alert.action]);
  });

  it('gives a reader who cannot see money only the rules with no money in them', () => {
    const figures = month((date) => ({ b: { units: '100', cents: 6900 }, job: date === '2026-11-03' ? null : date >= '2026-11-23' ? { hours: '25', cents: 50000 } : undefined }));
    const alerts = programAlerts(input({ figures, forecastMarginBp: 500, plan: { projectedGapCents: b(50000), minimumCents: b(3000000) } }), { ...KIT, seesMoney: false });
    expect(alerts.map((alert) => alert.rule)).toEqual(['P6', 'P7']);
    for (const alert of alerts) expect(alert.sentence).not.toMatch(/\$|%\smargin/);
  });
});
