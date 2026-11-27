import { describe, expect, it } from 'vitest';
import { planSummaryFor, type PlanSummaryInput, type PlanSummaryState } from './model';

/** An en dash, an em dash, or two hyphens in a row: none may appear in UI copy. */
const DASHES = new RegExp('[\\u2013\\u2014]|-{2}');

const day = (date: Date) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const BASE: PlanSummaryState = {
  phase: 'active',
  selection: { products: ['crm', 'pulse'] },
  trial: null,
  trialEligible: false,
  nextCharge: { amountCents: 39520, at: new Date('2026-12-07T12:00:00Z') },
  pastDue: null,
  cancelAt: null,
  pause: null,
  endedAt: null,
  usage: { seatsUsed: 4, seatsPaid: 5, seatLimit: 5, warehousesUsed: 1, warehousesPaid: 2 },
};

function input(over: Partial<PlanSummaryInput> & { state?: Partial<PlanSummaryState> } = {}): PlanSummaryInput {
  const { state, ...rest } = over;
  return {
    app: 'crm',
    badge: 'active',
    canView: true,
    ownerName: 'Maya Chen',
    billingHref: 'https://portal.test/billing?from=crm',
    pulseIncludedSeats: 5,
    contactHref: 'https://kitstak.com/contact',
    format: { money, day },
    ...rest,
    state: { ...BASE, ...state },
  };
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

describe('planSummaryFor', () => {
  it('shows the next payment with the amount and the date', () => {
    const view = planSummaryFor(input());
    expect(view.line).toBe('Your next payment of $395.20 is on Dec 7, 2026.');
    expect(view.facts).toEqual(['4 of 5 seats in use.']);
    expect(view.action).toEqual({ label: 'Open billing', href: 'https://portal.test/billing?from=crm' });
    expect(view.extra).toBeNull();
  });

  it('counts the free trial down and says there is no seat limit', () => {
    const view = planSummaryFor(
      input({
        badge: 'trial',
        state: {
          phase: 'trial',
          nextCharge: null,
          trial: { endsAt: new Date('2026-12-07T12:00:00Z'), daysLeft: 9 },
          usage: { seatsUsed: 1, seatsPaid: null, seatLimit: null, warehousesUsed: null, warehousesPaid: null },
        },
      }),
    );
    expect(view.line).toBe('Free trial. 9 days left. It ends on Dec 7, 2026.');
    expect(view.facts).toEqual(['1 seat in use.', 'No seat limit during your free trial.']);
  });

  it('says first payment when a card is saved during the trial', () => {
    const view = planSummaryFor(
      input({ badge: 'trial', state: { trial: { endsAt: new Date('2026-12-07T12:00:00Z'), daysLeft: 9 } } }),
    );
    expect(view.line).toBe('Free trial. Your first payment of $395.20 is on Dec 7, 2026.');
  });

  it('names the amount and the last day of full access when a payment failed', () => {
    const view = planSummaryFor(
      input({
        badge: 'past_due',
        state: { phase: 'past_due', pastDue: { amountDueCents: 39520, accessChangesAt: new Date('2026-12-14T12:00:00Z') } },
      }),
    );
    expect(view.line).toBe('A payment of $395.20 failed. Update your card by Dec 14, 2026 to keep full access.');
    expect(view.action?.label).toBe('Fix payment');
  });

  it('offers to pick a plan after the trial or the plan ended', () => {
    for (const phase of ['trial_ended', 'ended', 'none'] as const) {
      expect(planSummaryFor(input({ state: { phase, nextCharge: null } })).action?.label).toBe('Pick a plan');
    }
  });

  it('says "plan", never "billing", in the WMS, where billing means 3PL client billing', () => {
    expect(planSummaryFor(input({ app: 'wms' })).action?.label).toBe('Manage plan');
    expect(planSummaryFor(input({ app: 'wms', canView: false })).line).toBe(
      'Maya Chen manages the plan for your team. Ask them about the plan.',
    );
    for (const phase of ['none', 'trial', 'active', 'past_due', 'unpaid', 'paused', 'ended'] as const) {
      const view = planSummaryFor(input({ app: 'wms', state: { phase } }));
      expect(`${view.line} ${view.facts.join(' ')} ${view.action?.label ?? ''}`).not.toMatch(/billing/i);
    }
  });

  it('reports warehouses for the WMS', () => {
    expect(planSummaryFor(input({ app: 'wms' })).facts).toEqual(['1 of 2 warehouses in use.']);
    const trial = planSummaryFor(
      input({
        app: 'wms',
        badge: 'trial',
        state: {
          phase: 'trial',
          trial: { endsAt: new Date('2026-12-07T12:00:00Z'), daysLeft: 9 },
          usage: { seatsUsed: 2, seatsPaid: null, seatLimit: null, warehousesUsed: 3, warehousesPaid: null },
        },
      }),
    );
    expect(trial.facts).toEqual(['3 warehouses in use.', 'No warehouse limit during your free trial.']);
    const fresh = planSummaryFor(
      input({ app: 'wms', state: { usage: { seatsUsed: 2, seatsPaid: null, seatLimit: null, warehousesUsed: null, warehousesPaid: null } } }),
    );
    expect(fresh.facts).toEqual([]);
  });

  it('explains the Pulse 5 seat rule when Pulse is the only app', () => {
    const view = planSummaryFor(
      input({
        app: 'pulse',
        // The billing package reports the flat price's 5 seats as both the paid count and the limit.
        state: { selection: { products: ['pulse'] }, usage: { seatsUsed: 5, seatsPaid: 5, seatLimit: 5, warehousesUsed: null, warehousesPaid: null } },
      }),
    );
    expect(view.facts).toEqual([
      '5 of 5 seats in use.',
      'Pulse is one flat price for up to 5 seats. For a bigger team, talk to us.',
    ]);
    expect(view.extra).toEqual({ label: 'Talk to us', href: 'https://kitstak.com/contact' });
  });

  it('says the seat count comes from the other apps when Pulse is in a bundle', () => {
    const small = planSummaryFor(input({ app: 'pulse' }));
    expect(small.facts).toEqual(['4 of 5 seats in use.', 'Your seat count comes from your other apps. Pulse covers every seat for one flat price.']);
    expect(small.extra).toBeNull();
    // A bigger team is covered too: no "5 seats" and no "Talk to us" (review round 5).
    const big = planSummaryFor(
      input({ app: 'pulse', state: { usage: { seatsUsed: 7, seatsPaid: 8, seatLimit: 8, warehousesUsed: null, warehousesPaid: null } } }),
    );
    expect(big.facts).toEqual(['7 of 8 seats in use.', 'Your seat count comes from your other apps. Pulse covers every seat for one flat price.']);
    expect(big.extra).toBeNull();
  });

  it('tells a member who to ask, with no link and no money', () => {
    const view = planSummaryFor(input({ canView: false }));
    expect(view.line).toBe('Maya Chen manages the plan for your team. Ask them about billing.');
    expect(view.action).toBeNull();
    expect(view.facts).toEqual([]);
    expect(planSummaryFor(input({ canView: false, ownerName: null })).line).toContain('your organization owner');
  });

  it('says every app is included when the allow all switch is on and there is no plan', () => {
    const view = planSummaryFor(input({ badge: 'included', openAccess: true, state: { phase: 'none', nextCharge: null } }));
    expect(view.line).toBe('Every app is included for your organization right now. Nothing is charged.');
    expect(view.action?.label).toBe('Open billing');
  });

  it('reports nothing about seats for an app that is not in the plan', () => {
    expect(planSummaryFor(input({ badge: 'not_in_plan' })).facts).toEqual([]);
  });

  it('keeps every sentence short and free of dashes, in every phase and app', () => {
    const phases = ['none', 'trial', 'trial_ended', 'active', 'past_due', 'unpaid', 'cancel_scheduled', 'pause_scheduled', 'paused', 'ended'] as const;
    const at = new Date('2026-12-23T12:00:00Z');
    for (const app of ['crm', 'wms', 'projects', 'pulse'] as const) {
      for (const phase of phases) {
        for (const canView of [true, false]) {
          const view = planSummaryFor(
            input({
              app,
              canView,
              state: {
                phase,
                trial: phase === 'trial' || phase === 'trial_ended' ? { endsAt: at, daysLeft: phase === 'trial' ? 3 : 0 } : null,
                pastDue: phase === 'past_due' || phase === 'unpaid' ? { amountDueCents: 39520, accessChangesAt: at } : null,
                cancelAt: phase === 'cancel_scheduled' ? at : null,
                pause: phase === 'paused' || phase === 'pause_scheduled' ? { startsAt: at, resumesAt: at } : null,
                endedAt: phase === 'ended' ? at : null,
              },
            }),
          );
          for (const text of [view.line, ...view.facts]) {
            expect(text).not.toMatch(DASHES);
            for (const sentence of sentences(text)) {
              expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(20);
            }
          }
        }
      }
    }
  });
});
