/**
 * A program job (docs/programs/PULSE_PROGRAMS_SPEC.md 5.2) is judged against the program's month
 * plan, never a quote: W7 (price but no cost plan), D4 (no plan), W8 (past planned units) and the
 * "Add a quote or a budget" next step never fire, even when a typed quote is there.
 */
import { describe, expect, it } from 'vitest';
import { type ActualTotals, type PlanTotals, type ProjectionInput, assessRisk, projectJob } from './index';

const b = (n: number): bigint => BigInt(n);
const NOTHING: ActualTotals = { unitsGood: 0, hours: 0, revenueCents: b(0), laborCents: b(0), materialCents: b(0), otherCents: b(0), sharedCents: b(0) };
/** GLOVE in production: a typed quote of 2,000 kits for $89,260.20, with no cost plan. */
const TYPED_QUOTE: PlanTotals = { units: 2000, revenueCents: b(8926020), laborHours: 0, laborCents: b(0), materialCents: b(0), otherCents: b(0), sharedCents: b(0) };
/** The program's month plan as plan totals: planned units and the forecast, no labor or cost plan. */
const PROGRAM_PLAN: PlanTotals = { units: '800.000', revenueCents: b(3250818), laborHours: null, laborCents: null, materialCents: null, otherCents: null, sharedCents: null };

function judge(input: { plan: PlanTotals | null; plannedUnits: string; actual: ActualTotals; kind: 'one_time' | 'ongoing'; programJob: boolean; evidenceDays?: number; entryDays30?: number }) {
  const projection: ProjectionInput = {
    status: 'active',
    kind: input.kind,
    pricingModel: 'per_unit',
    plannedUnits: input.plannedUnits,
    plan: input.plan,
    actual: input.actual,
    window: null,
    evidenceDays: input.evidenceDays ?? 0,
    targetPace: null,
    unitPrice: null,
    fallbackRateCents: null,
    today: '2026-11-25',
    // Ongoing work is judged on the last 30 days: here, everything so far.
    last30: { ...input.actual },
  };
  return assessRisk({
    status: 'active',
    projection: projectJob(projection),
    actual: input.actual,
    plan: input.plan,
    plannedUnits: input.plannedUnits,
    targetMarginBp: 3000,
    evidenceDays: input.evidenceDays ?? 0,
    today: '2026-11-25',
    entryDays30: input.entryDays30,
    programJob: input.programJob,
  });
}

const rulesOf = (result: ReturnType<typeof judge>) => result.reasons.map((reason) => reason.rule);
const stepsOf = (result: ReturnType<typeof judge>) => result.reasons.map((reason) => reason.nextStep);

/** 21,837 kits so far, far past the quote's 2,000 (J-26131 in production). */
const PAST_THE_QUOTE: ActualTotals = { unitsGood: 21837, hours: 900, revenueCents: b(4300000), laborCents: b(2100000), materialCents: b(0), otherCents: b(0), sharedCents: b(0) };

describe('a program job never gets the quote rules', () => {
  it('a plain job with the same typed quote gets W8 and W7 (the before)', () => {
    const plain = judge({ plan: TYPED_QUOTE, plannedUnits: '2000', actual: PAST_THE_QUOTE, kind: 'one_time', programJob: false, evidenceDays: 5 });
    expect(rulesOf(plain)).toEqual(expect.arrayContaining(['W7', 'W8']));
    expect(stepsOf(plain)).toContain('add_plan');
  });

  it('the same typed quote on a program job fires none of W7, W8, D4 or add_plan', () => {
    const program = judge({ plan: TYPED_QUOTE, plannedUnits: '2000', actual: PAST_THE_QUOTE, kind: 'ongoing', programJob: true, evidenceDays: 5 });
    expect(rulesOf(program)).not.toContain('W7');
    expect(rulesOf(program)).not.toContain('W8');
    expect(rulesOf(program)).not.toContain('D4');
    expect(stepsOf(program)).not.toContain('add_plan');
  });

  it('a program job on its program plan with no cost plan and nothing logged gets no D4 or W7', () => {
    const plain = judge({ plan: { ...TYPED_QUOTE }, plannedUnits: '2000', actual: NOTHING, kind: 'one_time', programJob: false });
    expect(rulesOf(plain)).toContain('D4');
    const program = judge({ plan: PROGRAM_PLAN, plannedUnits: '800.000', actual: NOTHING, kind: 'one_time', programJob: true });
    expect(rulesOf(program)).not.toContain('D4');
    expect(rulesOf(program)).not.toContain('W7');
    expect(stepsOf(program)).not.toContain('add_plan');
  });

  it('a program job past this month\'s planned units gets no W8', () => {
    const actual: ActualTotals = { ...PAST_THE_QUOTE, unitsGood: 900 };
    const program = judge({ plan: PROGRAM_PLAN, plannedUnits: '800.000', actual, kind: 'one_time', programJob: true, evidenceDays: 5 });
    expect(rulesOf(program)).not.toContain('W8');
  });

  it('still keeps the money rules: a program job losing money is still flagged', () => {
    const losing: ActualTotals = { unitsGood: 500, hours: 400, revenueCents: b(100000), laborCents: b(900000), materialCents: b(0), otherCents: b(0), sharedCents: b(0) };
    const program = judge({ plan: PROGRAM_PLAN, plannedUnits: '800.000', actual: losing, kind: 'ongoing', programJob: true, evidenceDays: 5, entryDays30: 10 });
    expect(program.status).toBe('losing');
  });
});
