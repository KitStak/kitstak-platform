import { describe, expect, it } from 'vitest';
import { PRODUCT_IDS, type ProductId } from './catalog';
import {
  type ModuleAccess,
  type NoticeContext,
  type PlanEntitlementInput,
  type PlanPhase,
  type PlanStateInput,
  type PlanSubscriptionInput,
  type PlanViewer,
  derivePlanState,
  planBadgeFor,
  planLockFor,
  planNoticeFor,
} from './plan-state';

const NOW = new Date('2026-11-28T15:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);
const ORG = '22222222-2222-4222-8222-222222222222';

const MANAGER: PlanViewer = { canManage: true, canView: true, ownerName: 'Maya Chen' };
const ADMIN: PlanViewer = { canManage: false, canView: true, ownerName: 'Maya Chen' };
const MEMBER: PlanViewer = { canManage: false, canView: false, ownerName: 'Maya Chen' };

function row(status: PlanEntitlementInput['status'], source: PlanEntitlementInput['source'], access: ModuleAccess, periodEnd: Date | null = null): PlanEntitlementInput {
  return { status, source, periodEnd, access };
}

function rows(partial: Partial<Record<ProductId, PlanEntitlementInput>>): Record<ProductId, PlanEntitlementInput | null> {
  const out = {} as Record<ProductId, PlanEntitlementInput | null>;
  for (const id of PRODUCT_IDS) out[id] = partial[id] ?? null;
  return out;
}

function subscription(overrides: Partial<PlanSubscriptionInput> = {}): PlanSubscriptionInput {
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
    currentPeriodEnd: at(25),
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
    paymentMethod: { brand: 'visa', last4: '4242', expMonth: 8, expYear: 2028 },
    ...overrides,
  };
}

function input(overrides: Partial<PlanStateInput> = {}): PlanStateInput {
  return {
    orgId: ORG,
    mode: 'test_gateway',
    now: NOW,
    account: null,
    subscription: null,
    entitlements: rows({}),
    usage: { seatsUsed: 4, pendingInvites: 1, warehousesUsed: 1 },
    ...overrides,
  };
}

const CART = { products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'monthly' };
const trialAccount = (endsInDays: number) => ({ cart: CART, trialStartedAt: at(endsInDays - 14), trialEndsAt: at(endsInDays) });
const trialRows = (endsInDays: number) =>
  rows({
    crm: row('trialing', 'trial', endsInDays > 0 ? 'full' : 'read_only', at(endsInDays)),
    wms: row('trialing', 'trial', endsInDays > 0 ? 'full' : 'read_only', at(endsInDays)),
  });
const paidRows = (access: ModuleAccess = 'full', status: PlanEntitlementInput['status'] = 'active') =>
  rows({ crm: row(status, 'stripe', access, at(25)), wms: row(status, 'stripe', access, at(25)) });

function context(viewer: PlanViewer, module: ProductId | null = null): NoticeContext {
  return { module, viewer, portalUrl: 'https://kitstak.app', now: NOW };
}

describe('derivePlanState: every phase from rows', () => {
  const cases: readonly [string, PlanStateInput, PlanPhase][] = [
    ['nothing at all', input(), 'none'],
    ['free trial running', input({ account: trialAccount(9), entitlements: trialRows(9) }), 'trial'],
    ['free trial over, nothing paid', input({ account: trialAccount(-2), entitlements: trialRows(-2) }), 'trial_ended'],
    ['paid plan', input({ subscription: subscription(), entitlements: paidRows() }), 'active'],
    [
      'card saved, first charge still ahead',
      input({ account: trialAccount(9), subscription: subscription({ status: 'trialing', trialEnd: at(9), currentPeriodEnd: at(9) }), entitlements: paidRows() }),
      'active',
    ],
    [
      'payment failed, inside the grace days',
      input({ subscription: subscription({ status: 'past_due', pastDueSince: at(-2), amountDueCents: 39520, nextPaymentAttempt: at(1) }), entitlements: paidRows('full', 'past_due') }),
      'past_due',
    ],
    [
      'payment failed, grace over',
      input({ subscription: subscription({ status: 'past_due', pastDueSince: at(-8), amountDueCents: 39520 }), entitlements: paidRows('read_only', 'past_due') }),
      'unpaid',
    ],
    ['gateway says unpaid', input({ subscription: subscription({ status: 'unpaid', pastDueSince: at(-20) }), entitlements: paidRows('read_only', 'canceled') }), 'unpaid'],
    ['cancel at period end', input({ subscription: subscription({ cancelAtPeriodEnd: true, cancelAt: at(25) }), entitlements: paidRows() }), 'cancel_scheduled'],
    [
      'pause set, not started',
      input({ subscription: subscription({ pauseStartsAt: at(25), pauseResumesAt: at(86) }), entitlements: paidRows('full', 'canceled') }),
      'pause_scheduled',
    ],
    [
      'inside a pause',
      input({ subscription: subscription({ pauseStartsAt: at(-3), pauseResumesAt: at(58) }), entitlements: paidRows('read_only', 'canceled') }),
      'paused',
    ],
    [
      'canceled and past its last day',
      input({ subscription: subscription({ status: 'canceled', endedAt: at(-5), canceledAt: at(-30) }), entitlements: paidRows('read_only', 'canceled') }),
      'ended',
    ],
    [
      'a first payment that never finished does not count as a plan',
      input({ account: trialAccount(-2), subscription: subscription({ status: 'incomplete' }), entitlements: trialRows(-2) }),
      'trial_ended',
    ],
  ];

  it.each(cases)('%s', (_name, rowsIn, phase) => {
    expect(derivePlanState(rowsIn).phase).toBe(phase);
  });

  it('is pure: the same rows give the same state', () => {
    const rowsIn = input({ account: trialAccount(9), entitlements: trialRows(9) });
    expect(derivePlanState(rowsIn)).toEqual(derivePlanState(rowsIn));
  });
});

describe('derivePlanState: details', () => {
  it('a running trial has dates, days left, no card and no seat limit', () => {
    const state = derivePlanState(input({ account: trialAccount(9), entitlements: trialRows(9) }));
    expect(state.trial).toEqual({ startedAt: at(-5), endsAt: at(9), daysLeft: 9 });
    expect(state.hasSubscription).toBe(false);
    expect(state.trialEligible).toBe(false);
    expect(state.nextCharge).toBeNull();
    expect(state.usage).toEqual({ seatsUsed: 4, seatsPaid: null, seatLimit: null, pendingInvites: 1, warehousesUsed: 1, warehousesPaid: null });
    expect(state.selection).toEqual(CART);
    expect(state.quote.totalCents).toBe(39520);
    expect(state.modules.crm).toEqual({ product: 'crm', access: 'full', inPlan: true, source: 'trial', quantity: 5 });
    expect(state.modules.projects).toEqual({ product: 'projects', access: 'locked', inPlan: false, source: null, quantity: null });
  });

  it('an ended trial keeps its dates with 0 days left and view only apps', () => {
    const state = derivePlanState(input({ account: trialAccount(-2), entitlements: trialRows(-2) }));
    expect(state.trial?.daysLeft).toBe(0);
    expect(state.modules.crm.access).toBe('read_only');
    expect(state.modules.crm.inPlan).toBe(true);
    expect(state.modules.pulse.access).toBe('locked');
  });

  it('a paid plan has the plan as its selection, a next charge and limits', () => {
    const state = derivePlanState(
      input({ account: { cart: { products: ['pulse'] }, trialStartedAt: at(-40), trialEndsAt: at(-26) }, subscription: subscription(), entitlements: paidRows() }),
    );
    expect(state.selection).toEqual(CART);
    expect(state.hasSubscription).toBe(true);
    expect(state.trial).toBeNull();
    expect(state.nextCharge).toEqual({ amountCents: 39520, at: at(25) });
    expect(state.usage.seatLimit).toBe(5);
    expect(state.usage.seatsPaid).toBe(5);
    expect(state.usage.warehousesPaid).toBe(1);
    expect(state.paymentMethod?.last4).toBe('4242');
    expect(state.modules.wms).toEqual({ product: 'wms', access: 'full', inPlan: true, source: 'paid', quantity: 1 });
  });

  it('card saved in the trial: phase active with the trial still set and the first charge at its end', () => {
    const state = derivePlanState(
      input({ account: trialAccount(9), subscription: subscription({ status: 'trialing', trialEnd: at(9), currentPeriodEnd: at(9) }), entitlements: paidRows() }),
    );
    expect(state.phase).toBe('active');
    expect(state.trial?.endsAt).toEqual(at(9));
    expect(state.nextCharge).toEqual({ amountCents: 39520, at: at(9) });
  });

  it('a late payment has the amount, the retry date and the day access changes (7 days after the invoice)', () => {
    const state = derivePlanState(
      input({ subscription: subscription({ status: 'past_due', pastDueSince: at(-2), amountDueCents: 39520, nextPaymentAttempt: at(1) }), entitlements: paidRows('full', 'past_due') }),
    );
    expect(state.pastDue).toEqual({ since: at(-2), amountDueCents: 39520, nextRetryAt: at(1), accessChangesAt: at(5) });
    expect(state.nextCharge).toBeNull();
  });

  it('cancel, pause and ended carry their dates', () => {
    expect(derivePlanState(input({ subscription: subscription({ cancelAtPeriodEnd: true }), entitlements: paidRows() })).cancelAt).toEqual(at(25));
    expect(
      derivePlanState(input({ subscription: subscription({ pauseStartsAt: at(25), pauseResumesAt: at(86) }), entitlements: paidRows() })).pause,
    ).toEqual({ startsAt: at(25), resumesAt: at(86) });
    const ended = derivePlanState(input({ subscription: subscription({ status: 'canceled', endedAt: at(-5) }), entitlements: paidRows('read_only', 'canceled') }));
    expect(ended.endedAt).toEqual(at(-5));
    expect(ended.hasSubscription).toBe(false);
    expect(ended.trialEligible).toBe(false);
  });

  it('a brand new org may start a trial; a manual grant shows as its own source', () => {
    const state = derivePlanState(input({ entitlements: rows({ pulse: row('active', 'manual', 'full') }) }));
    expect(state.phase).toBe('none');
    expect(state.trialEligible).toBe(true);
    expect(state.modules.pulse).toEqual({ product: 'pulse', access: 'full', inPlan: false, source: 'manual', quantity: null });
  });

  it('a Pulse only plan allows 5 seats; a WMS only plan has no seat limit', () => {
    const pulse = derivePlanState(
      input({ subscription: subscription({ items: [{ product: 'pulse', quantity: 1, unitCents: 2900 }], recurringCents: 2900 }), entitlements: rows({ pulse: row('active', 'stripe', 'full') }) }),
    );
    expect(pulse.usage.seatLimit).toBe(5);
    const wms = derivePlanState(
      input({ subscription: subscription({ items: [{ product: 'wms', quantity: 2, unitCents: 34900 }], warehouses: 2, recurringCents: 69800 }), entitlements: rows({ wms: row('active', 'stripe', 'full') }) }),
    );
    expect(wms.usage.seatLimit).toBeNull();
    expect(wms.usage.warehousesPaid).toBe(2);
  });
});

function sentences(text: string): string[] {
  return text.split(/(?<=[.?!])\s+/).filter((sentence) => sentence.length > 0);
}

describe('planNoticeFor: the words in SPEC 9.2', () => {
  const trial9 = derivePlanState(input({ account: trialAccount(9), entitlements: trialRows(9) }));
  const trial2 = derivePlanState(input({ account: trialAccount(2), entitlements: trialRows(2) }));
  const trialToday = derivePlanState(input({ account: trialAccount(0.2), entitlements: trialRows(0.2) }));
  const trialTomorrow = derivePlanState(input({ account: trialAccount(0.9), entitlements: trialRows(0.9) }));
  const withCard = derivePlanState(
    input({ account: trialAccount(9), subscription: subscription({ status: 'trialing', trialEnd: at(9), currentPeriodEnd: at(9) }), entitlements: paidRows() }),
  );
  const trialEnded = derivePlanState(input({ account: trialAccount(-2), entitlements: trialRows(-2) }));
  const pastDue = derivePlanState(
    input({ subscription: subscription({ status: 'past_due', pastDueSince: at(-2), amountDueCents: 39520, nextPaymentAttempt: at(1) }), entitlements: paidRows('full', 'past_due') }),
  );
  const unpaid = derivePlanState(input({ subscription: subscription({ status: 'past_due', pastDueSince: at(-8) }), entitlements: paidRows('read_only', 'past_due') }));
  const canceling = derivePlanState(input({ subscription: subscription({ cancelAtPeriodEnd: true, cancelAt: at(25) }), entitlements: paidRows() }));
  const pauseSoon = derivePlanState(input({ subscription: subscription({ pauseStartsAt: at(25), pauseResumesAt: at(86) }), entitlements: paidRows('full', 'canceled') }));
  const paused = derivePlanState(input({ subscription: subscription({ pauseStartsAt: at(-3), pauseResumesAt: at(58) }), entitlements: paidRows('read_only', 'canceled') }));
  const ended = derivePlanState(input({ subscription: subscription({ status: 'canceled', endedAt: at(-5) }), entitlements: paidRows('read_only', 'canceled') }));
  const active = derivePlanState(input({ subscription: subscription(), entitlements: paidRows() }));

  const table: readonly [string, ReturnType<typeof derivePlanState>, string, 'info' | 'warning' | 'danger', string, string, string][] = [
    ['trial', trial9, 'trial', 'info', 'Free trial. 9 days left. Ends Dec 7.', 'Pick a plan', 'https://kitstak.app/billing/plan'],
    ['trial ending', trial2, 'trial_ending', 'warning', 'Your free trial ends in 2 days, on Nov 30.', 'Pick a plan', 'https://kitstak.app/billing/plan'],
    ['trial last day', trialToday, 'trial_ending', 'warning', 'Your free trial ends today.', 'Pick a plan', 'https://kitstak.app/billing/plan'],
    ['trial ends tomorrow', trialTomorrow, 'trial_ending', 'warning', 'Your free trial ends tomorrow, on Nov 29.', 'Pick a plan', 'https://kitstak.app/billing/plan'],
    ['trial with card', withCard, 'trial_with_card', 'info', 'Free trial. Your first payment of $395.20 is on Dec 7.', 'See my plan', 'https://kitstak.app/billing'],
    ['trial ended', trialEnded, 'trial_ended', 'danger', 'Your free trial ended on Nov 26. Your data is safe. Pick a plan to keep working.', 'Pick a plan', 'https://kitstak.app/billing/plan'],
    [
      'payment failed',
      pastDue,
      'payment_failed',
      'warning',
      'We could not charge your Visa ending 4242 for $395.20. We will try again on Nov 29. Update your card by Dec 3 to keep full access.',
      'Update card',
      'https://kitstak.app/billing?fix=payment',
    ],
    ['unpaid', unpaid, 'unpaid', 'danger', 'Your payment is late, so your apps are view only. Pay now to turn them back on.', 'Update card', 'https://kitstak.app/billing?fix=payment'],
    ['cancel scheduled', canceling, 'cancel_scheduled', 'info', 'Your plan ends on Dec 23. You keep everything until then.', 'Keep my plan', 'https://kitstak.app/billing'],
    ['pause scheduled', pauseSoon, 'pause_scheduled', 'info', 'Your plan pauses on Dec 23 and starts again on Feb 22.', 'Undo pause', 'https://kitstak.app/billing'],
    ['paused', paused, 'paused', 'danger', 'Your plan is paused, so your apps are view only. It starts again on Jan 25.', 'Start again now', 'https://kitstak.app/billing'],
    ['ended', ended, 'ended', 'danger', 'Your plan ended on Nov 23. Your data is safe. Pick a plan to keep working.', 'Pick a plan', 'https://kitstak.app/billing/plan'],
  ];

  it.each(table)('%s (owner, in the portal)', (_name, state, kind, tone, text, label, href) => {
    const notice = planNoticeFor(state, context(MANAGER));
    expect(notice).toEqual({ kind, tone, text, action: { label, href }, testId: `plan-notice-${kind}` });
  });

  it.each(table)('%s: every sentence is 20 words or fewer, with no dash', (_name, state) => {
    for (const viewer of [MANAGER, ADMIN, MEMBER]) {
      for (const module of [null, 'crm', 'projects'] as const) {
        const notice = planNoticeFor(state, context(viewer, module));
        if (!notice) continue;
        expect(notice.text).not.toMatch(/[\u2013\u2014]|-{2}/);
        for (const sentence of sentences(notice.text)) expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(20);
      }
    }
  });

  it('shows nothing for a plan in good standing or for no plan', () => {
    expect(planNoticeFor(active, context(MANAGER))).toBeNull();
    expect(planNoticeFor(active, context(MEMBER, 'crm'))).toBeNull();
    expect(planNoticeFor(derivePlanState(input()), context(MANAGER))).toBeNull();
  });

  it('admins see every kind, like owners', () => {
    expect(planNoticeFor(trial9, context(ADMIN))?.kind).toBe('trial');
    expect(planNoticeFor(pastDue, context(ADMIN))?.kind).toBe('payment_failed');
  });

  it('other members see a banner only when apps are view only, with no button', () => {
    for (const quiet of [trial9, trial2, withCard, pastDue, canceling, pauseSoon]) {
      expect(planNoticeFor(quiet, context(MEMBER, 'crm'))).toBeNull();
    }
    for (const [state, kind] of [
      [trialEnded, 'trial_ended'],
      [unpaid, 'unpaid'],
      [paused, 'paused'],
      [ended, 'ended'],
    ] as const) {
      expect(planNoticeFor(state, context(MEMBER, 'crm'))).toEqual({
        kind,
        tone: 'danger',
        text: 'This app is view only right now. Ask Maya Chen to pick a plan.',
        action: null,
        testId: `plan-notice-${kind}`,
      });
    }
    expect(planNoticeFor(trialEnded, context(MEMBER))?.text).toBe('Your apps are view only right now. Ask Maya Chen to pick a plan.');
    expect(planNoticeFor(trialEnded, context({ ...MEMBER, ownerName: null }, 'wms'))?.text).toBe(
      'This app is view only right now. Ask your organization owner to pick a plan.',
    );
  });

  it('in an app, the banner shows only when that app is in the trial or the plan', () => {
    expect(planNoticeFor(trial9, context(MANAGER, 'crm'))?.kind).toBe('trial');
    expect(planNoticeFor(trial9, context(MANAGER, 'projects'))).toBeNull();
    expect(planNoticeFor(trial9, context(MANAGER, 'crm'))?.action?.href).toBe('https://kitstak.app/billing/plan?from=crm');
    const withManual = derivePlanState(
      input({ account: trialAccount(-2), entitlements: { ...trialRows(-2), pulse: row('active', 'manual', 'full') } }),
    );
    expect(planNoticeFor(withManual, context(MANAGER, 'pulse'))).toBeNull();
  });

  it('an app that left the plan is view only and says how to add it back', () => {
    const removed = derivePlanState(
      input({
        subscription: subscription({ items: [{ product: 'wms', quantity: 1, unitCents: 34900 }], recurringCents: 34900 }),
        entitlements: rows({ wms: row('active', 'stripe', 'full', at(25)), crm: row('canceled', 'stripe', 'read_only', at(-1)) }),
      }),
    );
    expect(removed.modules.crm).toMatchObject({ access: 'read_only', inPlan: false });
    expect(planNoticeFor(removed, context(MANAGER, 'crm'))).toEqual({
      kind: 'app_removed',
      tone: 'warning',
      text: 'CRM is view only because it is not in your plan. Add it to make changes.',
      action: { label: 'Add CRM', href: 'https://kitstak.app/billing/plan?add=crm&from=crm' },
      testId: 'plan-notice-app_removed',
    });
    expect(planNoticeFor(removed, context(MEMBER, 'crm'))?.text).toBe('This app is view only right now. Ask Maya Chen to add it.');
    expect(planBadgeFor(removed, 'crm')).toBe('view_only');
  });

  it('uses the viewer time zone for dates', () => {
    const lateUtc = derivePlanState(
      input({ account: { cart: CART, trialStartedAt: at(-5), trialEndsAt: new Date('2026-12-08T03:00:00.000Z') }, entitlements: trialRows(9) }),
    );
    expect(planNoticeFor(lateUtc, context(MANAGER))?.text).toContain('Ends Dec 8.');
    expect(planNoticeFor(lateUtc, { ...context(MANAGER), timeZone: 'America/Chicago' })?.text).toContain('Ends Dec 7.');
  });
});

describe('planLockFor: the lock screen in SPEC 9.3', () => {
  const lockContext = (viewer: PlanViewer, module: ProductId) => ({ ...context(viewer, module), module });
  const fresh = derivePlanState(input());
  const inTrial = derivePlanState(input({ account: trialAccount(9), entitlements: trialRows(9) }));
  const paid = derivePlanState(input({ subscription: subscription(), entitlements: paidRows() }));
  const paidOne = derivePlanState(
    input({ subscription: subscription({ items: [{ product: 'wms', quantity: 1, unitCents: 34900 }], recurringCents: 34900 }), entitlements: rows({ wms: row('active', 'stripe', 'full') }) }),
  );

  it('free trial still open to them', () => {
    expect(planLockFor(fresh, lockContext(MANAGER, 'crm'))).toEqual({
      kind: 'trial_available',
      title: 'CRM is not in your plan yet',
      body: 'Try it free for 14 days. No card needed.',
      priceLine: 'After that, CRM is $29 per user each month.',
      primary: { label: 'Start free trial', href: 'https://kitstak.app/billing/plan?add=crm&from=crm' },
      secondary: { label: 'Back to Portal', href: 'https://kitstak.app' },
      testId: 'plan-lock',
    });
    // Admins can start the free trial too.
    expect(planLockFor(fresh, lockContext(ADMIN, 'crm')).primary?.label).toBe('Start free trial');
  });

  it('in a free trial', () => {
    const lock = planLockFor(inTrial, lockContext(MANAGER, 'projects'));
    expect(lock.title).toBe('Projects is not in your trial yet');
    expect(lock.body).toBe('Add it now. It is free until Dec 7.');
    expect(lock.priceLine).toBe('After your trial, Projects is $9.60 per user each month with your bundle discount.');
    expect(lock.primary).toEqual({ label: 'Add Projects to my trial', href: 'https://kitstak.app/billing/plan?add=projects&from=projects' });
    expect(lock.kind).toBe('trial_available');
  });

  it('paid plan: the price with the bundle discount', () => {
    const lock = planLockFor(paid, lockContext(MANAGER, 'projects'));
    expect(lock.kind).toBe('not_in_plan');
    expect(lock.title).toBe('Projects is not in your plan yet');
    expect(`${lock.body} ${lock.priceLine}`).toBe('Add Projects for $9.60 per user each month. That price includes your bundle discount.');
    expect(lock.primary?.label).toBe('Add Projects to my plan');

    const second = planLockFor(paidOne, lockContext(MANAGER, 'crm'));
    expect(second.body).toBe('Add CRM for $23.20 per user each month.');
    expect(second.priceLine).toBe('That price includes the bundle discount. Your other app gets 20% off too.');

    const pulse = planLockFor(paid, lockContext(MANAGER, 'pulse'));
    expect(pulse.body).toBe('Add Pulse for $23.20 each month for your whole team.');
  });

  it('cannot manage: who to ask, and only the way back', () => {
    for (const state of [fresh, inTrial, paid]) {
      const lock = planLockFor(state, lockContext(MEMBER, 'crm'));
      expect(lock).toMatchObject({ body: 'Ask Maya Chen to add it.', primary: null, priceLine: null });
      expect(lock.secondary).toEqual({ label: 'Back to Portal', href: 'https://kitstak.app' });
    }
    // An admin can change trial apps but not a paid plan.
    expect(planLockFor(inTrial, lockContext(ADMIN, 'projects')).primary).not.toBeNull();
    expect(planLockFor(paid, lockContext(ADMIN, 'projects')).primary).toBeNull();
  });

  it('every lock sentence is 20 words or fewer', () => {
    for (const state of [fresh, inTrial, paid, paidOne]) {
      for (const viewer of [MANAGER, ADMIN, MEMBER]) {
        for (const module of PRODUCT_IDS) {
          const lock = planLockFor(state, lockContext(viewer, module));
          for (const sentence of sentences(`${lock.title}. ${lock.body} ${lock.priceLine ?? ''}`)) {
            expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(20);
          }
        }
      }
    }
  });
});

describe('planBadgeFor', () => {
  it('names each state', () => {
    const trial = derivePlanState(input({ account: trialAccount(9), entitlements: { ...trialRows(9), pulse: row('active', 'manual', 'full') } }));
    expect(planBadgeFor(trial, 'crm')).toBe('trial');
    expect(planBadgeFor(trial, 'projects')).toBe('not_in_plan');
    expect(planBadgeFor(trial, 'pulse')).toBe('included');

    const paid = derivePlanState(input({ subscription: subscription(), entitlements: paidRows() }));
    expect(planBadgeFor(paid, 'crm')).toBe('active');

    const withCard = derivePlanState(
      input({ account: trialAccount(9), subscription: subscription({ status: 'trialing', trialEnd: at(9) }), entitlements: paidRows() }),
    );
    expect(planBadgeFor(withCard, 'crm')).toBe('trial');

    const late = derivePlanState(input({ subscription: subscription({ status: 'past_due', pastDueSince: at(-2) }), entitlements: paidRows('full', 'past_due') }));
    expect(planBadgeFor(late, 'wms')).toBe('past_due');

    const ended = derivePlanState(input({ account: trialAccount(-2), entitlements: trialRows(-2) }));
    expect(planBadgeFor(ended, 'crm')).toBe('view_only');
  });
});
