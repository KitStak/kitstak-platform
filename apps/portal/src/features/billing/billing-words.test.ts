/**
 * The words on the billing screens (SPEC 6.1 and 6.3). Every sentence is built from a real
 * `PlanState` made by `derivePlanState`, so these tests break when the plan rules or the copy drift.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SELECTION, PRODUCT_IDS, type PlanSelection, type ProductId } from '@kitstak/billing/catalog';
import {
  derivePlanState,
  type PlanEntitlementInput,
  type PlanPhase,
  type PlanState,
  type PlanStateInput,
  type PlanSubscriptionInput,
} from '@kitstak/billing/plan-state';
import {
  addAppDeltaCents,
  addAppPriceNote,
  addMonthsUtc,
  cardExpiry,
  cardLabel,
  describeChange,
  oneSeatSavingCents,
  sameSelection,
} from './format';
import { invoiceStatus, invoiceTitle } from './invoices/invoice-words';
import { memberLine, nextChargeCopy, phaseCopy } from './phase-copy';

const NOW = new Date('2026-11-23T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const days = (count: number) => new Date(NOW.getTime() + count * DAY);
const CART: PlanSelection = { products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'monthly' };
const VISA = { brand: 'visa', last4: '4242', expMonth: 8, expYear: 2028 };

function noRows(): Record<ProductId, PlanEntitlementInput | null> {
  return { crm: null, wms: null, projects: null, pulse: null };
}

function subscription(over: Partial<PlanSubscriptionInput> = {}): PlanSubscriptionInput {
  return {
    status: 'active',
    interval: 'monthly',
    seats: 5,
    warehouses: 1,
    items: [
      { product: 'crm', quantity: 5, unitCents: 2320 },
      { product: 'wms', quantity: 1, unitCents: 27920 },
    ],
    recurringCents: 39520,
    currentPeriodEnd: days(30),
    trialEnd: null,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    canceledAt: null,
    endedAt: null,
    pauseStartsAt: null,
    pauseResumesAt: null,
    pastDueSince: null,
    amountDueCents: null,
    nextPaymentAttempt: null,
    paymentMethod: VISA,
    ...over,
  };
}

function state(over: Partial<PlanStateInput> = {}): PlanState {
  return derivePlanState({
    orgId: 'org_1',
    mode: 'test_gateway',
    now: NOW,
    account: null,
    subscription: null,
    entitlements: noRows(),
    usage: { seatsUsed: 3, pendingInvites: 0, warehousesUsed: 1 },
    ...over,
  });
}

const paidRows = (): Record<ProductId, PlanEntitlementInput | null> => ({
  ...noRows(),
  crm: { status: 'active', source: 'stripe', periodEnd: days(30), access: 'full' },
  wms: { status: 'active', source: 'stripe', periodEnd: days(30), access: 'full' },
});
const trialRows = (access: 'full' | 'read_only' = 'full'): Record<ProductId, PlanEntitlementInput | null> => ({
  ...noRows(),
  crm: { status: 'trialing', source: 'trial', periodEnd: days(9), access },
  wms: { status: 'trialing', source: 'trial', periodEnd: days(9), access },
});
const trialAccount = (endsIn: number) => ({ cart: CART, trialStartedAt: days(endsIn - 14), trialEndsAt: days(endsIn) });

const STATES: Readonly<Record<PlanPhase, PlanState>> = {
  none: state(),
  trial: state({ account: trialAccount(9), entitlements: trialRows() }),
  trial_ended: state({ account: trialAccount(-1), entitlements: trialRows('read_only') }),
  active: state({ subscription: subscription(), entitlements: paidRows() }),
  past_due: state({
    subscription: subscription({ status: 'past_due', pastDueSince: days(-1), amountDueCents: 39520, nextPaymentAttempt: days(2) }),
    entitlements: paidRows(),
  }),
  unpaid: state({
    subscription: subscription({ status: 'past_due', pastDueSince: days(-9), amountDueCents: 39520 }),
    entitlements: paidRows(),
  }),
  cancel_scheduled: state({ subscription: subscription({ cancelAtPeriodEnd: true }), entitlements: paidRows() }),
  pause_scheduled: state({ subscription: subscription({ pauseStartsAt: days(30), pauseResumesAt: days(91) }), entitlements: paidRows() }),
  paused: state({ subscription: subscription({ pauseStartsAt: days(-2), pauseResumesAt: days(59) }), entitlements: paidRows() }),
  ended: state({ subscription: subscription({ status: 'canceled', endedAt: days(-3) }), entitlements: paidRows() }),
};

describe('fixtures', () => {
  it('cover every phase', () => {
    for (const [phase, built] of Object.entries(STATES)) expect(built.phase).toBe(phase);
  });
});

describe('phaseCopy', () => {
  const copy = (phase: PlanPhase) => phaseCopy(STATES[phase], 'UTC');

  it('says the SPEC 6.1 line and main button for each phase', () => {
    expect(copy('none').line).toBe('You have no plan yet. Try any app free for 14 days.');
    expect(copy('none').primary.label).toBe('Start free trial');
    expect(copy('trial').line).toBe('Free trial. 9 days left. Ends Dec 2, 2026.');
    expect(copy('trial').primary.label).toBe('Pick a plan');
    expect(copy('trial').others.map((action) => action.label)).toEqual(['Change trial apps']);
    expect(copy('trial_ended').line).toBe('Your free trial ended on Nov 22, 2026. Your apps are view only. Your data is safe.');
    expect(copy('trial_ended').primary.label).toBe('Pick a plan');
    expect(copy('active').line).toBe('Your plan is active.');
    expect(copy('active').primary.label).toBe('Change plan');
    expect(copy('active').others.map((action) => action.label)).toEqual(['Update card', 'Cancel plan']);
    expect(copy('past_due').line).toBe('We could not charge your Visa ending 4242 for $395.20. We will try again on Nov 25.');
    expect(copy('past_due').primary.label).toBe('Update card');
    expect(copy('past_due').others.map((action) => action.label)).toEqual(['Pay now']);
    expect(copy('unpaid').line).toBe('Your payment is late, so your apps are view only.');
    expect(copy('unpaid').others.map((action) => action.label)).toEqual(['Pay now', 'Cancel plan']);
    expect(copy('cancel_scheduled').line).toBe('Your plan ends on Dec 23, 2026. You keep everything until then.');
    expect(copy('cancel_scheduled').primary.label).toBe('Keep my plan');
    expect(copy('pause_scheduled').line).toBe('Your plan pauses on Dec 23, 2026 and starts again on Feb 22, 2027.');
    expect(copy('pause_scheduled').primary.label).toBe('Undo pause');
    expect(copy('paused').line).toBe('Your plan is paused. It starts again on Jan 21, 2027.');
    expect(copy('paused').primary.label).toBe('Start again now');
    expect(copy('ended').line).toBe('Your plan ended on Nov 20, 2026. Your apps are view only. Your data is safe.');
    expect(copy('ended').primary.label).toBe('Pick a plan');
  });

  it('shows a saved card during the trial as a trial with a first payment date', () => {
    const withCard = state({
      account: trialAccount(9),
      subscription: subscription({ status: 'trialing', trialEnd: days(9), currentPeriodEnd: days(9) }),
      entitlements: paidRows(),
    });
    const words = phaseCopy(withCard, 'UTC');
    expect(words.line).toBe('Free trial. Your first payment is on Dec 2, 2026.');
    expect(words.badge.label).toBe('Free trial');
    expect(words.primary.label).toBe('Change plan');
    expect(nextChargeCopy(withCard, 'UTC')).toEqual({ headline: 'Dec 2, 2026', detail: '$395.20 to your Visa ending 4242.' });
  });

  it('offers a plan, not a second trial, to an org that already had one', () => {
    const used = state({ account: { cart: null, trialStartedAt: days(-60), trialEndsAt: null } });
    expect(used.phase).toBe('none');
    expect(phaseCopy(used, 'UTC').primary.label).toBe('Pick a plan');
  });

  it('never uses a dash, a double dash or a long sentence', () => {
    for (const built of Object.values(STATES)) {
      const lines = [phaseCopy(built, 'UTC').line, memberLine(built, 'Northwind Robotics', 'UTC'), ...Object.values(nextChargeCopy(built, 'UTC'))];
      for (const line of lines) {
        expect(line).not.toMatch(/[–—]|--/);
        for (const sentence of line.split(/(?<=\.)\s+/)) expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(20);
      }
    }
  });
});

describe('memberLine', () => {
  it('names the organization and the date, and never an amount', () => {
    expect(memberLine(STATES.trial, 'Northwind Robotics', 'UTC')).toBe('Northwind Robotics is on a free trial that ends Dec 2, 2026.');
    for (const built of Object.values(STATES)) expect(memberLine(built, 'Northwind Robotics', 'UTC')).not.toContain('$');
  });
});

describe('nextChargeCopy', () => {
  it('matches the phase', () => {
    expect(nextChargeCopy(STATES.trial, 'UTC')).toEqual({ headline: 'No charge planned', detail: 'Pick a plan to keep your apps after Dec 2.' });
    expect(nextChargeCopy(STATES.active, 'UTC')).toEqual({ headline: 'Dec 23, 2026', detail: '$395.20 to your Visa ending 4242.' });
    expect(nextChargeCopy(STATES.past_due, 'UTC').headline).toBe('Nov 25, 2026');
    expect(nextChargeCopy(STATES.past_due, 'UTC').detail).toBe('We will try $395.20 again. Your apps stay open until Nov 29.');
    expect(nextChargeCopy(STATES.cancel_scheduled, 'UTC').headline).toBe('No more charges');
    expect(nextChargeCopy(STATES.paused, 'UTC').detail).toBe('No bills while paused. Then $395.20.');
    expect(nextChargeCopy(STATES.ended, 'UTC').headline).toBe('No charge planned');
  });
});

describe('format helpers', () => {
  it('describe a card', () => {
    expect(cardLabel(VISA)).toBe('Visa ending 4242');
    expect(cardExpiry(VISA)).toBe('08/28');
    expect(cardLabel(null)).toBe('card');
  });

  it('name a change the way the confirm panel shows it', () => {
    expect(describeChange(CART, { ...CART, seats: 6 })).toBe('Add 1 seat');
    expect(describeChange(CART, { ...CART, seats: 3 })).toBe('Remove 2 seats');
    expect(describeChange(CART, { ...CART, products: ['crm', 'wms', 'pulse'] })).toBe('Add Pulse');
    expect(describeChange(CART, { ...CART, products: ['crm'], interval: 'yearly' })).toBe('Remove WMS and switch to yearly');
    expect(describeChange(CART, { ...CART, warehouses: 2, seats: 6, interval: 'yearly' })).toBe('Add 1 seat, add 1 warehouse and switch to yearly');
    expect(describeChange(CART, CART)).toBe('No change');
  });

  it('compare selections by what is billed', () => {
    expect(sameSelection(CART, { ...CART })).toBe(true);
    expect(sameSelection(CART, { ...CART, seats: 6 })).toBe(false);
    // Seats do not change a WMS only plan, so a different seat number is the same plan.
    const wmsOnly: PlanSelection = { ...CART, products: ['wms'] };
    expect(sameSelection(wmsOnly, { ...wmsOnly, seats: 40 })).toBe(true);
  });

  it('price an added app from two quotes, bundle discount included', () => {
    // CRM 5 seats alone is $145.00. With Pulse both get 20% off: $116.00 + $23.20.
    expect(addAppDeltaCents({ ...CART, products: ['crm'] }, 'pulse')).toBe(-580);
    // In a bundle already, Projects for 5 seats adds 5 x $9.60.
    expect(addAppDeltaCents(CART, 'projects')).toBe(4800);
    expect(oneSeatSavingCents(CART)).toBe(2320);
    expect(oneSeatSavingCents({ ...CART, seats: 1 })).toBe(0);
  });

  it('say what adding an app does, in each phase', () => {
    expect(addAppPriceNote(STATES.none, 'crm')).toBe('Free for 14 days. No card needed.');
    expect(addAppPriceNote(STATES.trial, 'projects')).toBe('Free during your trial. Then adds $48.00 per month.');
    expect(addAppPriceNote(STATES.active, 'pulse')).toBe('Adds $23.20 per month.');
    const crmOnly = state({
      subscription: subscription({ items: [{ product: 'crm', quantity: 5, unitCents: 2900 }], recurringCents: 14500 }),
      entitlements: { ...noRows(), crm: { status: 'active', source: 'stripe', periodEnd: days(30), access: 'full' } },
    });
    expect(addAppPriceNote(crmOnly, 'pulse')).toBe('Adds the bundle discount. You pay $5.80 less per month.');
    expect(addAppPriceNote(crmOnly, 'wms')).toBe('Adds $250.20 per month with the bundle discount.');
  });

  it('add calendar months the way the gateway does', () => {
    expect(addMonthsUtc(new Date('2026-01-31T10:00:00Z'), 1).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addMonthsUtc(new Date('2026-11-23T10:00:00Z'), 12).toISOString()).toBe('2027-11-23T10:00:00.000Z');
  });

  it('keep the catalog as the only source of products', () => {
    expect(PRODUCT_IDS).toHaveLength(4);
    expect(DEFAULT_SELECTION.products).toHaveLength(0);
  });
});

describe('invoice words', () => {
  const line = { description: 'KitStak CRM', product: 'crm' as const, quantity: 5, unitCents: 2320, amountCents: 11600, proration: false };
  it('name what an invoice was for', () => {
    const month = { periodStart: days(0), periodEnd: days(30), lines: [line] };
    expect(invoiceTitle({ ...month, billingReason: 'subscription_cycle' })).toBe('Monthly plan');
    expect(invoiceTitle({ ...month, billingReason: 'subscription_create' })).toBe('Monthly plan, first payment');
    expect(invoiceTitle({ ...month, periodEnd: days(365), billingReason: 'subscription_cycle' })).toBe('Yearly plan');
    expect(invoiceTitle({ ...month, billingReason: 'subscription_update' })).toBe('Plan change');
    expect(invoiceTitle({ ...month, billingReason: null, lines: [{ ...line, proration: true }] })).toBe('Plan change');
  });
  it('map gateway statuses to three plain words', () => {
    expect(invoiceStatus({ status: 'paid' }).label).toBe('Paid');
    expect(invoiceStatus({ status: 'open' }).label).toBe('Due');
    expect(invoiceStatus({ status: 'void' }).label).toBe('Void');
  });
});
