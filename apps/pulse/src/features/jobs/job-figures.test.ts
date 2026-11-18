/**
 * One job, every place its headline loss, pace and unit cost are shown: the job banner sentence,
 * the Pace card, the estimate slider, the Cost for one card, the Home row and the alert. They
 * must read the same digits, and each must name which number it is.
 */
import { describe, expect, it } from 'vitest';
import { formatMoney, formatPace } from '@/lib/format';
import { assessRisk, projectJob, riskSentence, type ProjectionInput, type RiskReason } from '@/lib/profit';
import type { JobStatsDTO } from '@/lib/types';
import { liveJobAlert, renderAlertWords } from '@/server/domain/alert-words';
import { headlineMoney, jobHeadlineFigures, paceWords, paceYardsticks, planPace } from './job-figures';

const b = (n: number): bigint => BigInt(n);

/** A J-1012 shaped job: losing money, crew under the target pace. */
const INPUT: ProjectionInput = {
  status: 'active',
  kind: 'one_time',
  pricingModel: 'per_unit',
  plannedUnits: 47000,
  plan: { units: 47000, revenueCents: b(6110000), laborHours: 1097, laborCents: b(2468250), materialCents: b(1410000), otherCents: b(0), sharedCents: b(120000) },
  actual: { unitsGood: 21069, hours: 765.5, revenueCents: b(2862700), laborCents: b(1722000), materialCents: b(1150000), otherCents: b(0), sharedCents: b(105719), uph: 27.523 },
  window: { days: 5, unitsGood: 5526, paceHours: '200.00', hours: '200.00', laborCostCents: b(450000) },
  evidenceDays: 12,
  targetPace: 46,
  unitPrice: '1.30',
  today: '2026-11-18',
};

function build() {
  const projection = projectJob(INPUT);
  const risk = assessRisk({
    status: 'active',
    projection,
    actual: INPUT.actual,
    plan: INPUT.plan,
    plannedUnits: INPUT.plannedUnits,
    targetMarginBp: 3000,
    evidenceDays: INPUT.evidenceDays,
    window: { uph: 27.63, paceHours: '200.00', unitsGood: 5526, days: 5 },
    targetPace: 46,
    unitPrice: '1.30',
    today: INPUT.today,
  });
  const reasons = risk.reasons.map((reason: RiskReason) => ({
    rule: reason.rule,
    params: reason.params,
    impactCents: Number(reason.impactCents),
    nextStep: reason.nextStep,
    nextStepLabel: null,
    text: riskSentence(reason, { unitLabel: 'set' }),
  }));
  const cost = INPUT.actual.laborCents + INPUT.actual.materialCents + INPUT.actual.otherCents + INPUT.actual.sharedCents;
  const stats = {
    unitsGood: '21069.000',
    uph: '27.523',
    standardUph: '46.000',
    paceUph: projection.paceUph === null ? null : projection.paceUph.toFixed(3),
    costCents: Number(cost),
    costAtFinishCents: Number(projection.costAtFinishCents),
    projectedProfitCents: Number(projection.projectedProfitCents),
    mode: projection.mode,
    riskReasons: reasons,
  } as unknown as JobStatsDTO;
  return { projection, risk, stats, reasons };
}

describe('one job, one set of numbers', () => {
  const { risk, stats, reasons } = build();
  const figures = jobHeadlineFigures(stats, '47000');

  it('is losing money, so every place has a loss to show', () => {
    expect(risk.status).toBe('losing');
    expect(figures.loss).not.toBeNull();
  });

  it('shows the same loss on the banner, Home and the alert', () => {
    const banner = reasons.find((reason) => reason.rule === 'L1')!.text;
    const home = formatMoney(stats.projectedProfitCents, { cents: false }).replace('-', '');
    const alert = liveJobAlert(
      { params: { rule: 'L1', jobNumber: 'J-1012', jobName: 'Kit', unitLabel: 'set', reason: { lossCents: 1 } }, impactCents: b(-1) },
      reasons.map((reason) => ({ rule: reason.rule, params: reason.params as Record<string, unknown>, impactCents: reason.impactCents })),
    );
    const alertBody = renderAlertWords('job_losing', alert.params, true).body;
    const alertStake = headlineMoney(alert.impactCents);
    expect(alert.impactAsOf).toBe('live');
    expect(banner).toContain(figures.loss!);
    expect(home).toBe(figures.loss);
    expect(alertBody).toContain(figures.loss!);
    expect(alertStake).toBe(figures.loss);
  });

  it('shows the same cost for one set by the finish, and names it as the finish figure', () => {
    const banner = reasons.find((reason) => reason.rule === 'L1')!.text;
    expect(banner).toContain(`By the finish, each set costs ${formatMoney(figures.costPerUnitAtFinishCents!)}`);
    // The card is the cost so far: a different number, and it is labeled so.
    expect(figures.costPerUnitSoFarCents).not.toBeNull();
  });

  it('shows the same paces wherever each one appears, each named', () => {
    // Pace card: the whole job, one decimal.
    expect(formatPace(stats.uph)).toBe('27.5');
    expect(figures.paceWholeJob).toBe('27.5');
    // Reason line: the last evidence days, and it says so.
    const paceReason = reasons.find((reason) => reason.rule === 'R4' || reason.rule === 'W3')!;
    expect(figures.paceRecent?.text).toBe('27.6');
    expect(paceReason.text).toContain(`In the last 5 work days the crew made ${figures.paceRecent!.text} units per person per hour`);
    // Slider: the pace for the rest of the job, at a 0.1 step, which keeps the same digits.
    const slider = Math.round(Number(stats.paceUph) / 0.1) * 0.1;
    expect(formatPace(slider)).toBe(formatPace(Number(stats.paceUph)));
    expect(paceWords(slider)).toBe(figures.paceRestOfJob);
  });

  it('labels a stored alert figure that the job no longer has', () => {
    const stale = liveJobAlert({ params: { rule: 'L1' }, impactCents: b(-466200) }, []);
    expect(stale.impactAsOf).toBe('fired');
    expect(stale.impactCents).toBe(b(-466200));
  });
});

describe('pace yardsticks', () => {
  it('names both yardsticks and explains when they disagree', () => {
    const plan = { units: 30000, revenueCents: b(1800000), laborHours: 451.18, setupHours: 10, laborCents: b(1000000), materialCents: b(0), otherCents: b(0), sharedCents: b(0) };
    const assumed = planPace(plan);
    expect(paceWords(assumed)).toBe('68');
    const sticks = paceYardsticks({ uph: '45.706', targetPace: '44.000', planPace: assumed, planWord: 'quote' });
    expect(sticks.againstTarget).toBe('against the target pace of 44');
    expect(sticks.againstPlan).toBe('against the 68 the quote assumed');
    expect(sticks.conflict).toBe('The quote assumed 68 an hour. Your target pace is 44. The crew beats the target but not the quote.');
  });
  it('says nothing more when both agree', () => {
    expect(paceYardsticks({ uph: 50, targetPace: 44, planPace: 48, planWord: 'budget' }).conflict).toBeNull();
    expect(paceYardsticks({ uph: 40, targetPace: 44, planPace: 48, planWord: 'budget' }).conflict).toBeNull();
  });
  it('has no plan yardstick for a plan that only holds a price', () => {
    expect(planPace({ units: 1000, revenueCents: b(125000), laborHours: 0, laborCents: b(0), materialCents: b(0), otherCents: b(0), sharedCents: b(0) })).toBeNull();
  });
});
