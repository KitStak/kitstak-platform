/**
 * A job with a price and units but no cost plan must never read "On track" at a 100% margin.
 * Unknown cost is not zero cost (SPEC 4.13 and rule D4 in 4.14).
 */
import { describe, expect, it } from 'vitest';
import {
  type ActualTotals,
  type PlanTotals,
  type ProjectionInput,
  assessRisk,
  planHasCosts,
  projectJob,
  riskHeadline,
  riskSentence,
} from './index';

const b = (n: number): bigint => BigInt(n);
const NOTHING: ActualTotals = { unitsGood: 0, hours: 0, revenueCents: b(0), laborCents: b(0), materialCents: b(0), otherCents: b(0), sharedCents: b(0) };
/** What the quick add row saves: units and the revenue from the price, nothing on the cost side. */
const PRICE_ONLY: PlanTotals = { units: 1000, revenueCents: b(125000), laborHours: 0, laborCents: b(0), materialCents: b(0), otherCents: b(0), sharedCents: b(0) };
const FULL: PlanTotals = { units: 1000, revenueCents: b(125000), laborHours: 25, laborCents: b(55000), materialCents: b(20000), otherCents: b(0), sharedCents: b(5000) };

const QUICK_ADDED: ProjectionInput = {
  status: 'active',
  kind: 'one_time',
  pricingModel: 'per_unit',
  plannedUnits: 1000,
  plan: PRICE_ONLY,
  actual: NOTHING,
  window: null,
  evidenceDays: 0,
  targetPace: null,
  unitPrice: '1.25',
  fallbackRateCents: b(2400),
  today: '2026-11-18',
};

const risk = (input: ProjectionInput) =>
  assessRisk({
    status: 'active',
    projection: projectJob(input),
    actual: input.actual,
    plan: input.plan,
    plannedUnits: input.plannedUnits,
    targetMarginBp: 3000,
    evidenceDays: input.evidenceDays,
    window: input.window ? { uph: Number(input.window.unitsGood) / Number(input.window.paceHours), paceHours: input.window.paceHours, unitsGood: input.window.unitsGood } : null,
    targetPace: input.targetPace,
    unitPrice: input.unitPrice,
    today: input.today,
  });

describe('planHasCosts', () => {
  it('is false for no plan and for a plan that only holds a price', () => {
    expect(planHasCosts(null)).toBe(false);
    expect(planHasCosts(PRICE_ONLY)).toBe(false);
    expect(planHasCosts(FULL)).toBe(true);
    expect(planHasCosts({ ...PRICE_ONLY, materialCents: b(100) })).toBe(true);
    expect(planHasCosts({ ...PRICE_ONLY, laborHours: '4.00' })).toBe(true);
  });
});

describe('projection with no cost plan', () => {
  it('does not treat unknown cost as zero cost', () => {
    const p = projectJob(QUICK_ADDED);
    expect(p.costKnown).toBe(false);
    expect(p.projectedMarginBp).toBeNull();
    expect(p.costAtFinishCents).toBe(b(0));
    expect(p.projectedProfitCents).toBe(b(0)); // nothing has happened yet, and nothing is invented
  });
  it('is the same with no plan at all', () => {
    const p = projectJob({ ...QUICK_ADDED, plan: null });
    expect(p.costKnown).toBe(false);
    expect(p.projectedMarginBp).toBeNull();
  });
  it('knows the cost once a full plan exists', () => {
    const p = projectJob({ ...QUICK_ADDED, plan: FULL });
    expect(p.costKnown).toBe(true);
    expect(p.projectedMarginBp).toBe(3600);
  });
  it('knows the cost once a day is logged', () => {
    const p = projectJob({
      ...QUICK_ADDED,
      actual: { unitsGood: 400, hours: 32, revenueCents: b(50000), laborCents: b(76800), materialCents: b(0), otherCents: b(0), sharedCents: b(0) },
      window: { days: 1, unitsGood: 400, paceHours: 32, hours: 32, laborCostCents: b(76800) },
      evidenceDays: 1,
    });
    expect(p.costKnown).toBe(true);
    expect(p.costAtFinishCents > b(0)).toBe(true);
  });
  it('does not know the cost when hours are left and no hour has a price', () => {
    const p = projectJob({ ...QUICK_ADDED, plan: null, targetPace: 40, fallbackRateCents: null });
    expect(p.paceKnown).toBe(true);
    expect(p.costKnown).toBe(false);
    expect(p.projectedMarginBp).toBeNull();
  });
});

describe('rule D4: no plan yet', () => {
  it('says Not enough data, never On track, with a next step to add a plan', () => {
    const result = risk(QUICK_ADDED);
    expect(result.status).toBe('no_data');
    expect(result.headline?.rule).toBe('D4');
    expect(result.headline?.nextStep).toBe('add_plan');
    expect(result.laborMissing).toBe(true);
    expect(riskHeadline(result)).toBe('No plan yet, so Pulse cannot tell if this job will make money.');
    expect(riskHeadline(result, { seesMoney: false })).toBe('No plan yet, so Pulse cannot tell how this job will go.');
    expect(riskHeadline(result)).not.toMatch(/On track|100%/);
    // W7 says the same thing in weaker words, so it does not fire next to D4.
    expect(result.reasons.map((reason) => reason.rule)).not.toContain('W7');
  });
  it('fires with no plan at all too', () => {
    expect(risk({ ...QUICK_ADDED, plan: null }).headline?.rule).toBe('D4');
  });
  it('gives way to W7 once a day is logged, and the job is judged on what happened', () => {
    const result = risk({
      ...QUICK_ADDED,
      actual: { unitsGood: 400, hours: 32, revenueCents: b(50000), laborCents: b(30000), materialCents: b(0), otherCents: b(0), sharedCents: b(0) },
      window: { days: 1, unitsGood: 400, paceHours: 32, hours: 32, laborCostCents: b(30000) },
      evidenceDays: 1,
    });
    const rules = result.reasons.map((reason) => reason.rule);
    expect(rules).not.toContain('D4');
    expect(rules).toContain('W7');
    const w7 = result.reasons.find((reason) => reason.rule === 'W7');
    expect(riskSentence(w7 as never)).toBe('This job has a price but no cost plan, so Pulse cannot compare it with anything.');
  });
  it('keeps W7 words for a job with no plan at all', () => {
    expect(riskSentence({ rule: 'W7', params: {} })).toBe('This job has no plan, so Pulse cannot compare it with anything.');
  });
  it('does not fire on a job with a full plan', () => {
    const rules = risk({ ...QUICK_ADDED, plan: FULL }).reasons.map((reason) => reason.rule);
    expect(rules).not.toContain('D4');
    expect(rules).not.toContain('W7');
  });
});
