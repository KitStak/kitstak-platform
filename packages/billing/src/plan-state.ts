/**
 * Plan state, notices, lock screens and badges (docs/billing/CONTRACTS.md section 7, SPEC sections 8
 * and 9). PURE and deterministic: the same input gives the same words in the portal and in every app.
 *
 * All phase rules live in `derivePlanState`. The per app access rule lives in `moduleAccess` in
 * `@kitstak/entitlements`; the caller passes its answer in with each entitlement row, so this file
 * imports no database code.
 */
import {
  type BillingInterval,
  CATALOG,
  daysLeft,
  formatDay,
  formatDayShort,
  formatMoney,
  isBundle,
  normalizeSelection,
  type PlanSelection,
  priceTermsLabel,
  PRODUCT_IDS,
  type ProductId,
  quantityFor,
  seatLimitFor,
  toStack,
  unitCents,
} from './catalog';
import { billingLink } from './links';
import { type Quote, quote } from './quote';

export type { ProductId };

export type ModuleAccess = 'full' | 'read_only' | 'locked';
export type BillingMode = 'live' | 'stripe_test' | 'test_gateway' | 'unavailable';
export type PlanPhase =
  | 'none' // never had a trial or a plan
  | 'trial' // free trial running, no card
  | 'trial_ended' // free trial over, nothing paid
  | 'active' // paid plan in good standing (also: card saved, first charge still ahead)
  | 'past_due' // a payment failed, inside the grace days, full access
  | 'unpaid' // grace over, view only, the plan is still open and can be paid
  | 'cancel_scheduled' // ends at period end, can be undone
  | 'pause_scheduled' // pause starts at period end, can be undone
  | 'paused' // inside a pause, view only
  | 'ended'; // canceled and past its last day

export interface ModulePlan {
  readonly product: ProductId;
  readonly access: ModuleAccess;
  /** In the trial or the paid plan. */
  readonly inPlan: boolean;
  /** manual = granted by KitStak, not billed. */
  readonly source: 'trial' | 'paid' | 'manual' | null;
  readonly quantity: number | null;
}

export interface PlanUsage {
  /** Active members who are not guest only. */
  readonly seatsUsed: number;
  /** null in trial, WMS only plans and no plan. */
  readonly seatsPaid: number | null;
  /** seatLimitFor(), null = no limit. */
  readonly seatLimit: number | null;
  /** Open invites that would use a seat. */
  readonly pendingInvites: number;
  /**
   * The lowest seat count the plan can have: people plus open invites. An open invite holds a seat,
   * so the plan cannot be made smaller than this until someone is removed or an invite is canceled.
   */
  readonly seatFloor: number;
  /** null when the org has no warehouse schema yet. */
  readonly warehousesUsed: number | null;
  readonly warehousesPaid: number | null;
}

export interface PaymentMethodSummary {
  readonly brand: string;
  readonly last4: string;
  readonly expMonth: number;
  readonly expYear: number;
}

export interface PlanState {
  readonly orgId: string;
  readonly phase: PlanPhase;
  readonly mode: BillingMode;
  /** The paid plan, else the saved cart, else the trial products. */
  readonly selection: PlanSelection;
  /** quote(selection) */
  readonly quote: Quote;
  readonly modules: Readonly<Record<ProductId, ModulePlan>>;
  readonly usage: PlanUsage;
  readonly trial: { readonly startedAt: Date; readonly endsAt: Date; readonly daysLeft: number } | null;
  /** This org may still start a free trial. */
  readonly trialEligible: boolean;
  readonly hasSubscription: boolean;
  readonly paymentMethod: PaymentMethodSummary | null;
  /**
   * The next bill. `amountCents` is what the card will really be charged: the plan price, minus a
   * promo code, minus credit. It comes from the gateway's own preview of the next invoice.
   */
  readonly nextCharge: {
    readonly amountCents: number;
    readonly at: Date;
    /** The plan price for the period, before a promo code and before credit. */
    readonly planCents: number;
    readonly discountCents: number;
    /** 'Promo code TEST10 (10% off)'. null when there is no discount. */
    readonly discountLabel: string | null;
    /** Credit that comes off this bill. */
    readonly creditAppliedCents: number;
  } | null;
  /** Credit the organization holds from plan changes. 0 when there is none. */
  readonly creditCents: number;
  readonly currentPeriodEnd: Date | null;
  readonly pastDue: {
    readonly since: Date;
    readonly amountDueCents: number;
    readonly nextRetryAt: Date | null;
    readonly accessChangesAt: Date;
  } | null;
  /**
   * The day the plan is set to end, whenever a cancel is set on a live plan. Set in phase
   * `cancel_scheduled`, and also when a cancel sits on a plan that is late or paused (review round
   * 3), so every screen can show "Keep my plan" and never a second "Cancel plan".
   */
  readonly cancelAt: Date | null;
  readonly pause: { readonly startsAt: Date; readonly resumesAt: Date } | null;
  readonly endedAt: Date | null;
  /**
   * Why the plan ended (review round 3). null while the plan runs, and for plans that ended before
   * the reason was recorded.
   */
  readonly endedReason: PlanEndedReason | null;
  /** The bill that was dropped ('canceled_unpaid') or never collected ('payment_failed'). */
  readonly endedAmountCents: number | null;
  /** How many times the card was tried for that bill. */
  readonly endedAttempts: number | null;
}

/**
 * 'canceled': the customer canceled and the paid time ran out. 'canceled_unpaid': the customer
 * canceled while a bill was open, so the plan ended that day and the bill was dropped.
 * 'payment_failed': the gateway gave up after its last failed try.
 */
export type PlanEndedReason = 'canceled' | 'canceled_unpaid' | 'payment_failed';

/* ===== input rows ===== */

export type PlanSubscriptionStatus = 'incomplete' | 'trialing' | 'active' | 'past_due' | 'unpaid' | 'canceled';

/** `core.billing_accounts`, the parts the plan needs. */
export interface PlanAccountInput {
  /** Raw `cart` column. Read through `normalizeSelection`. */
  readonly cart: unknown;
  readonly trialStartedAt: Date | null;
  readonly trialEndsAt: Date | null;
}

/** `core.billing_subscriptions`, the parts the plan needs. */
export interface PlanSubscriptionInput {
  readonly status: PlanSubscriptionStatus;
  readonly interval: BillingInterval;
  readonly seats: number;
  readonly warehouses: number;
  readonly items: readonly { readonly product: ProductId; readonly quantity: number; readonly unitCents: number }[];
  readonly recurringCents: number;
  readonly currentPeriodEnd: Date | null;
  readonly trialEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly cancelAt: Date | null;
  readonly canceledAt: Date | null;
  readonly endedAt: Date | null;
  readonly pauseStartsAt: Date | null;
  readonly pauseResumesAt: Date | null;
  readonly pastDueSince: Date | null;
  readonly amountDueCents: number | null;
  readonly nextPaymentAttempt: Date | null;
  readonly paymentMethod: PaymentMethodSummary | null;
  /** Credit balance at the gateway. Missing means 0. */
  readonly creditCents?: number;
  /** What the next bill charges the card. Missing or null means the plan price. */
  readonly nextChargeCents?: number | null;
  readonly nextDiscountCents?: number;
  readonly nextDiscountLabel?: string | null;
  readonly nextCreditCents?: number;
  /** Why the plan ended, with the bill that was open then. Missing on rows from before 0010. */
  readonly endedReason?: PlanEndedReason | null;
  readonly endedAmountCents?: number | null;
  readonly endedAttempts?: number | null;
}

/** One `core.entitlements` row plus the answer of `moduleAccess` for it. */
export interface PlanEntitlementInput {
  readonly status: 'active' | 'trialing' | 'past_due' | 'canceled';
  readonly source: 'stripe' | 'manual' | 'trial';
  readonly periodEnd: Date | null;
  readonly access: ModuleAccess;
}

export interface PlanStateInput {
  readonly orgId: string;
  readonly mode: BillingMode;
  readonly now: Date;
  readonly account: PlanAccountInput | null;
  readonly subscription: PlanSubscriptionInput | null;
  readonly entitlements: Readonly<Record<ProductId, PlanEntitlementInput | null>>;
  readonly usage: {
    readonly seatsUsed: number;
    readonly pendingInvites: number;
    readonly warehousesUsed: number | null;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const LIVE_STATUSES: readonly PlanSubscriptionStatus[] = ['trialing', 'active', 'past_due', 'unpaid'];

/** True for a subscription the gateway still runs (not canceled, not an unfinished first payment). */
export function isLiveSubscriptionStatus(status: PlanSubscriptionStatus): boolean {
  return LIVE_STATUSES.includes(status);
}

function selectionFromSubscription(subscription: PlanSubscriptionInput): PlanSelection {
  return normalizeSelection({
    products: subscription.items.map((item) => item.product),
    seats: subscription.seats,
    warehouses: subscription.warehouses,
    interval: subscription.interval,
  });
}

function phaseOf(input: PlanStateInput): PlanPhase {
  const { subscription, account, now } = input;
  if (subscription && subscription.status !== 'incomplete') {
    if (subscription.status === 'canceled') return 'ended';
    if (subscription.status === 'unpaid') return 'unpaid';
    if (subscription.status === 'past_due') {
      const since = subscription.pastDueSince;
      if (!since) return 'unpaid';
      return now.getTime() <= since.getTime() + CATALOG.graceDays * DAY_MS ? 'past_due' : 'unpaid';
    }
    if (subscription.pauseResumesAt) {
      const startsAt = subscription.pauseStartsAt;
      return startsAt && now.getTime() < startsAt.getTime() ? 'pause_scheduled' : 'paused';
    }
    if (subscription.cancelAtPeriodEnd || subscription.cancelAt) return 'cancel_scheduled';
    return 'active';
  }
  if (account?.trialEndsAt) {
    return now.getTime() < account.trialEndsAt.getTime() ? 'trial' : 'trial_ended';
  }
  return 'none';
}

/** Pure. All phase rules live here. `getPlanState` loads the rows and calls it. */
export function derivePlanState(input: PlanStateInput): PlanState {
  const { subscription, account, now } = input;
  const phase = phaseOf(input);
  const counted = subscription && subscription.status !== 'incomplete' ? subscription : null;
  const live = counted && isLiveSubscriptionStatus(counted.status) ? counted : null;

  const cart = normalizeSelection(account?.cart);
  const trialProducts = PRODUCT_IDS.filter((id) => {
    const row = input.entitlements[id];
    return row !== null && row.source === 'trial' && row.status === 'trialing';
  });

  let selection: PlanSelection;
  if (live) selection = selectionFromSubscription(live);
  else if (cart.products.length > 0) selection = cart;
  else if (counted) selection = selectionFromSubscription(counted);
  else if (trialProducts.length > 0) selection = { ...cart, products: trialProducts };
  else selection = cart;

  const planProducts = new Set<ProductId>(counted ? counted.items.map((item) => item.product) : []);
  const modules = {} as Record<ProductId, ModulePlan>;
  for (const product of PRODUCT_IDS) {
    const row = input.entitlements[product];
    const inSubscription = planProducts.has(product);
    const inTrial = !counted && row !== null && row.source === 'trial' && row.status === 'trialing';
    const inPlan = inSubscription || inTrial;
    const item = counted?.items.find((entry) => entry.product === product);
    modules[product] = {
      product,
      access: row ? row.access : 'locked',
      inPlan,
      source: row === null ? null : row.source === 'stripe' ? 'paid' : row.source,
      quantity: item ? item.quantity : inTrial ? quantityFor(product, selection) : null,
    };
  }

  const seatLimit = live ? seatLimitFor(selectionFromSubscription(live)) : null;
  const usage: PlanUsage = {
    seatsUsed: input.usage.seatsUsed,
    seatsPaid: seatLimit,
    seatLimit,
    pendingInvites: input.usage.pendingInvites,
    seatFloor: input.usage.seatsUsed + input.usage.pendingInvites,
    warehousesUsed: input.usage.warehousesUsed,
    warehousesPaid: live && planProducts.has('wms') ? live.warehouses : null,
  };

  let trial: PlanState['trial'] = null;
  if (live && live.status === 'trialing' && live.trialEnd && live.trialEnd.getTime() > now.getTime()) {
    trial = {
      startedAt: account?.trialStartedAt ?? now,
      endsAt: live.trialEnd,
      daysLeft: daysLeft(live.trialEnd, now),
    };
  } else if ((phase === 'trial' || phase === 'trial_ended') && account?.trialEndsAt) {
    trial = {
      startedAt: account.trialStartedAt ?? account.trialEndsAt,
      endsAt: account.trialEndsAt,
      daysLeft: phase === 'trial' ? daysLeft(account.trialEndsAt, now) : 0,
    };
  }

  let nextCharge: PlanState['nextCharge'] = null;
  if (live && phase === 'active') {
    const at = live.status === 'trialing' ? (live.trialEnd ?? live.currentPeriodEnd) : live.currentPeriodEnd;
    if (at) {
      nextCharge = {
        amountCents: Math.max(0, live.nextChargeCents ?? live.recurringCents),
        at,
        planCents: live.recurringCents,
        discountCents: Math.max(0, live.nextDiscountCents ?? 0),
        discountLabel: live.nextDiscountLabel ?? null,
        creditAppliedCents: Math.max(0, live.nextCreditCents ?? 0),
      };
    }
  }

  let pastDue: PlanState['pastDue'] = null;
  if (live && (phase === 'past_due' || phase === 'unpaid')) {
    const since = live.pastDueSince ?? now;
    pastDue = {
      since,
      amountDueCents: live.amountDueCents ?? live.recurringCents,
      nextRetryAt: live.nextPaymentAttempt,
      accessChangesAt: new Date(since.getTime() + CATALOG.graceDays * DAY_MS),
    };
  }

  const trialEligible =
    !account?.trialStartedAt &&
    !subscription &&
    !PRODUCT_IDS.some((id) => input.entitlements[id]?.source === 'trial');

  return {
    orgId: input.orgId,
    phase,
    mode: input.mode,
    selection,
    quote: quote(selection),
    modules,
    usage,
    trial,
    trialEligible,
    hasSubscription: live !== null,
    paymentMethod: counted?.paymentMethod ?? null,
    nextCharge,
    creditCents: Math.max(0, counted?.creditCents ?? 0),
    currentPeriodEnd: live?.currentPeriodEnd ?? null,
    pastDue,
    cancelAt: live && (live.cancelAtPeriodEnd || live.cancelAt) ? (live.cancelAt ?? live.currentPeriodEnd) : null,
    pause:
      live && live.pauseResumesAt && (phase === 'paused' || phase === 'pause_scheduled')
        ? { startsAt: live.pauseStartsAt ?? now, resumesAt: live.pauseResumesAt }
        : null,
    endedAt: phase === 'ended' && counted ? (counted.endedAt ?? counted.canceledAt ?? counted.currentPeriodEnd) : null,
    endedReason: phase === 'ended' && counted ? (counted.endedReason ?? null) : null,
    endedAmountCents: phase === 'ended' && counted ? (counted.endedAmountCents ?? null) : null,
    endedAttempts: phase === 'ended' && counted ? (counted.endedAttempts ?? null) : null,
  };
}

/* ===== why a plan ended ===== */

/**
 * The words for a plan that ended, by reason. `audit` is one sentence for the activity log (the
 * log row carries its own date). `line(day)` is the sentence for billing home and the app banners,
 * with the day the plan ended. PURE, so the email, the screens and the log say the same thing.
 *
 *  - gave up:  'We could not collect $164.00 after 4 tries, so your plan ended on Nov 23, 2026.'
 *  - canceled with a bill open: 'You canceled, so your plan ended on Nov 24, 2026. We did not charge the $348.80.'
 *  - canceled: 'Your plan ended on Dec 16, 2026.'
 */
export function planEndedWords(input: {
  readonly reason: PlanEndedReason | null;
  readonly amountCents: number | null;
  readonly attempts: number | null;
}): { readonly audit: string; readonly line: (endedOn: string | null) => string } {
  const amount = input.amountCents !== null && input.amountCents > 0 ? formatMoney(input.amountCents) : null;
  const tries = input.attempts !== null && input.attempts >= 1 ? ` after ${input.attempts} ${input.attempts === 1 ? 'try' : 'tries'}` : '';
  const on = (endedOn: string | null) => (endedOn ? ` on ${endedOn}` : '');
  if (input.reason === 'payment_failed') {
    const what = amount ?? 'your payment';
    return {
      audit: `We could not collect ${what}${tries}, so the plan ended.`,
      line: (endedOn) => `We could not collect ${what}${tries}, so your plan ended${on(endedOn)}.`,
    };
  }
  if (input.reason === 'canceled_unpaid') {
    return {
      audit: 'The plan ended.',
      line: (endedOn) =>
        amount ? `You canceled, so your plan ended${on(endedOn)}. We did not charge the ${amount}.` : `You canceled, so your plan ended${on(endedOn)}.`,
    };
  }
  return { audit: 'The plan ended.', line: (endedOn) => `Your plan ended${on(endedOn)}.` };
}

/** The sentence for an ended plan, with its day in the viewer's time zone. null when the plan has not ended. */
export function planEndedLine(state: PlanState, timeZone?: string, short = false): string | null {
  if (state.phase !== 'ended') return null;
  const endedOn = state.endedAt ? (short ? formatDayShort(state.endedAt, timeZone) : formatDay(state.endedAt, timeZone)) : null;
  return planEndedWords({ reason: state.endedReason, amountCents: state.endedAmountCents, attempts: state.endedAttempts }).line(endedOn);
}

/* ===== cancel: what pressing the button will do ===== */

export interface CancelWords {
  /**
   * 'trial': a free trial with a card saved; it ends by itself and nothing is charged.
   * 'period_end': the plan runs to the end of the paid time and can be kept until then.
   * 'now': a bill is open, so the plan ends today and that bill is dropped.
   */
  readonly mode: 'trial' | 'period_end' | 'now';
  /** The sentences at the top of the cancel page: what happens, and when. */
  readonly notice: string;
  /** One more line under the notice, or null. */
  readonly detail: string | null;
  /** The other way out, said before the person decides, or null. */
  readonly instead: string | null;
  /** The words on the confirm button. */
  readonly confirmLabel: string;
  /** The line billing home shows right after the cancel. */
  readonly doneNotice: string;
  /** Mode 'now' only: the bill that will be dropped. */
  readonly openBillCents: number | null;
}

/**
 * What the cancel page says, from the plan as it is now (review round 3). PURE. The rule it states:
 *
 *  - A plan in good standing ends on the last day that was paid for, and can be kept until then.
 *  - A plan with a bill open (a late payment) ends today, and that bill is dropped. Nobody is told
 *    "you keep everything until" a day they have not paid for, and nothing is charged after a cancel.
 *
 * `scheduleCancel` in `server/cancel.ts` does exactly what these words say.
 */
export function cancelWords(state: PlanState, timeZone?: string): CancelWords {
  const day = (date: Date) => formatDay(date, timeZone);
  const endsAt = state.currentPeriodEnd;
  const endLabel = endsAt ? day(endsAt) : null;

  if (state.pastDue) {
    const amount = formatMoney(state.pastDue.amountDueCents);
    const viewOnly = state.phase === 'unpaid';
    const notice = viewOnly
      ? `You have an unpaid bill of ${amount}, and your apps are view only now. If you cancel, your plan ends today and we will not charge the ${amount}. Nothing is deleted.`
      : `You have an unpaid bill of ${amount}. If you cancel now, your plan ends today and we will not charge the ${amount}. Your apps become view only today. Nothing is deleted.`;
    return {
      mode: 'now',
      notice,
      detail: null,
      instead: endLabel
        ? `Want to keep your plan? Pay the ${amount} and you have full access until ${endLabel}.`
        : `Want to keep your plan? Pay the ${amount} and your apps open again.`,
      confirmLabel: 'End my plan today',
      doneNotice: `Your plan has ended. We will not charge the ${amount}. Your data is safe.`,
      openBillCents: state.pastDue.amountDueCents,
    };
  }

  if (state.trial) {
    return {
      mode: 'trial',
      notice: `Your free trial still runs until ${endLabel ?? 'its last day'}. After that your apps are view only. Nothing is charged. Nothing is deleted.`,
      detail: null,
      instead: null,
      confirmLabel: 'Cancel my plan',
      doneNotice: 'Your plan is set to end. You keep everything until then. You can undo this any time before that day.',
      openBillCents: null,
    };
  }

  if (state.phase === 'paused') {
    return {
      mode: 'period_end',
      notice: endLabel
        ? `Your plan is paused, so your apps are view only now. If you cancel, it ends on ${endLabel} and does not start again. Nothing more is charged. Nothing is deleted.`
        : 'Your plan is paused, so your apps are view only now. If you cancel, it does not start again. Nothing more is charged. Nothing is deleted.',
      detail: null,
      instead: null,
      confirmLabel: 'Cancel my plan',
      doneNotice: 'Your plan is set to end. It will not start again. You can undo this any time before that day.',
      openBillCents: null,
    };
  }

  return {
    mode: 'period_end',
    notice: `Your plan will end on ${endLabel ?? 'the last day you paid for'}. You keep everything until then. After that your apps are view only. Nothing is deleted.`,
    detail: state.selection.interval === 'yearly' && endLabel ? `You are paid up until ${endLabel}.` : null,
    instead: null,
    confirmLabel: 'Cancel my plan',
    doneNotice: 'Your plan is set to end. You keep everything until then. You can undo this any time before that day.',
    openBillCents: null,
  };
}

/* ===== notices ===== */

export interface PlanViewer {
  /** Owner or billing manager. */
  readonly canManage: boolean;
  /** Owner, admin or billing manager. */
  readonly canView: boolean;
  /** Who a member should ask. */
  readonly ownerName: string | null;
}

export type PlanNoticeKind =
  | 'trial'
  | 'trial_ending'
  | 'trial_with_card'
  | 'trial_ended'
  | 'payment_failed'
  | 'unpaid'
  | 'cancel_scheduled'
  | 'pause_scheduled'
  | 'paused'
  | 'ended'
  /** Added during build (CONTRACTS section 24): an app that left the trial or the plan is view only. */
  | 'app_removed';

export interface PlanNotice {
  readonly kind: PlanNoticeKind;
  readonly tone: 'info' | 'warning' | 'danger';
  /** One to three short sentences, SPEC 9.2. */
  readonly text: string;
  readonly action: { readonly label: string; readonly href: string } | null;
  /** `plan-notice-${kind}` */
  readonly testId: string;
}

export interface PlanLock {
  readonly kind: 'not_in_plan' | 'trial_available';
  readonly title: string;
  readonly body: string;
  /** One more plain line about the price, or null. Shown under the body. */
  readonly priceLine: string | null;
  readonly primary: { readonly label: string; readonly href: string } | null;
  readonly secondary: { readonly label: string; readonly href: string };
  readonly testId: 'plan-lock';
}

export interface NoticeContext {
  /** null in the portal. */
  readonly module: ProductId | null;
  readonly viewer: PlanViewer;
  readonly portalUrl: string;
  /**
   * The organization the notice is about. Product apps pass it, so every billing link opens the
   * Portal for this organization, also when the person last used another one there (review round
   * 4). The Portal itself leaves it out: its links stay inside the organization that is open.
   */
  readonly orgId?: string;
  readonly now: Date;
  readonly timeZone?: string;
  /**
   * True when every app is open whatever the plan says (`ENTITLEMENTS_DEV_ALLOW_ALL`, which stays
   * on in production until the last go live step). The notice then never says "view only", because
   * that would not be true, and a member with no billing rights is shown nothing.
   */
  readonly appsOpen?: boolean;
}

function askWho(viewer: PlanViewer): string {
  return viewer.ownerName ? viewer.ownerName : 'your organization owner';
}

function cardLabel(method: PaymentMethodSummary | null): string {
  if (!method || !method.last4) return 'card';
  const brand = method.brand ? method.brand.charAt(0).toUpperCase() + method.brand.slice(1) : 'card';
  return `${brand} ending ${method.last4}`;
}

/**
 * The words under the date on the Next charge card: what the card will be charged and why it is not
 * the plan price. '$325.61 to your Visa ending 3184, after $46.39 credit.' null when no charge is
 * coming.
 */
export function nextChargeLine(state: PlanState): string | null {
  const charge = state.nextCharge;
  if (!charge) return null;
  const parts: string[] = [];
  if (charge.amountCents === 0 && charge.creditAppliedCents > 0) {
    parts.push(`${formatMoney(0)}. Your credit pays this bill in full.`);
  } else if (charge.creditAppliedCents > 0) {
    parts.push(
      `${formatMoney(charge.amountCents)} to your ${cardLabel(state.paymentMethod)}, after ${formatMoney(charge.creditAppliedCents)} credit.`,
    );
  } else {
    parts.push(`${formatMoney(charge.amountCents)} to your ${cardLabel(state.paymentMethod)}.`);
  }
  if (charge.discountCents > 0) {
    parts.push(`${charge.discountLabel ?? 'Promo code'}: ${formatMoney(charge.discountCents)} off.`);
  }
  return parts.join(' ');
}

/** 'Credit: $713.40. It comes off your next bills.' null when the organization has no credit. */
export function creditLine(state: PlanState): string | null {
  if (state.creditCents <= 0) return null;
  const onNext = state.nextCharge?.creditAppliedCents ?? 0;
  if (state.phase === 'cancel_scheduled' || state.phase === 'ended') {
    return `Credit: ${formatMoney(state.creditCents)}. It stays on your account. If you come back, it comes off your first bill.`;
  }
  const bills = onNext >= state.creditCents ? 'next bill' : 'next bills';
  return `Credit: ${formatMoney(state.creditCents)}. It comes off your ${bills}.`;
}

function sameCalendarDay(a: Date, b: Date, timeZone?: string): boolean {
  return formatDayShort(a, timeZone) === formatDayShort(b, timeZone);
}

function notice(
  kind: PlanNoticeKind,
  tone: PlanNotice['tone'],
  text: string,
  action: PlanNotice['action'],
): PlanNotice {
  return { kind, tone, text, action, testId: `plan-notice-${kind}` };
}

const MEMBER_KINDS: readonly PlanNoticeKind[] = ['trial_ended', 'unpaid', 'paused', 'ended'];

/**
 * null means show nothing. Pure and deterministic: same input, same words, in every app.
 *
 * Three kinds of viewer (review round 4):
 *   - can pay (owner, billing manager): the words and the one button that fixes it,
 *   - can see billing but cannot pay (admin): the same facts, then who to ask. Never a pay button,
 *     because that button would end on a page that says "only an owner can do this",
 *   - a member: a line only when the app is view only, with who to ask.
 */
export function planNoticeFor(state: PlanState, context: NoticeContext): PlanNotice | null {
  const { module, viewer, portalUrl, timeZone } = context;
  const from = module ?? undefined;
  const appsOpen = context.appsOpen === true;
  const day = (date: Date) => formatDayShort(date, timeZone);
  const link = (intent: Parameters<typeof billingLink>[1]) => billingLink(portalUrl, intent, from, context.orgId);
  /** May pay and change a paid plan. An admin may see billing and change the apps of a free trial. */
  const payer = viewer.canManage;
  const who = askWho(viewer);
  /** The quiet button for a person who can see billing but cannot pay. */
  const seePlan = { label: 'See my plan', href: link({ to: 'home' }) };

  if (module) {
    const plan = state.modules[module];
    if (!plan.inPlan) {
      // An app that is not part of the trial or the plan gets a lock screen, never a banner. The one
      // exception: it was in the trial or the plan before and is view only now.
      if (plan.access !== 'read_only' || plan.source === 'manual') return null;
      // Every app is open: nothing is view only, so there is nothing to say.
      if (appsOpen) return null;
      const name = CATALOG.products[module].shortName;
      if (!viewer.canView) {
        return notice('app_removed', 'warning', `This app is view only right now. Ask ${who} to add it.`, null);
      }
      // The same rule as the lock screen: an admin can add an app to a free trial, not to a paid plan.
      const canAdd = payer || state.phase === 'trial';
      if (!canAdd) {
        return notice('app_removed', 'warning', `${name} is view only because it is not in your plan. Ask ${who} to add it.`, null);
      }
      return notice(
        'app_removed',
        'warning',
        `${name} is view only because it is not in your plan. Add it to make changes.`,
        { label: `Add ${name}`, href: link({ to: 'add', product: module }) },
      );
    }
  }

  let kind: PlanNoticeKind | null = null;
  switch (state.phase) {
    case 'none':
      kind = null;
      break;
    case 'trial':
      kind = state.trial && state.trial.daysLeft <= 3 ? 'trial_ending' : 'trial';
      break;
    case 'trial_ended':
      kind = 'trial_ended';
      break;
    case 'active':
      kind = state.trial ? 'trial_with_card' : null;
      break;
    case 'past_due':
      kind = 'payment_failed';
      break;
    case 'unpaid':
      kind = 'unpaid';
      break;
    case 'cancel_scheduled':
      kind = 'cancel_scheduled';
      break;
    case 'pause_scheduled':
      kind = 'pause_scheduled';
      break;
    case 'paused':
      kind = 'paused';
      break;
    case 'ended':
      kind = 'ended';
      break;
  }
  if (!kind) return null;

  if (!viewer.canView) {
    // A member hears about the plan only when it stops their work. With every app open it does not.
    if (appsOpen || !MEMBER_KINDS.includes(kind)) return null;
    const subject = module ? 'This app is' : 'Your apps are';
    return notice(kind, 'danger', `${subject} view only right now. Ask ${who} to pick a plan.`, null);
  }

  switch (kind) {
    case 'trial': {
      const trial = state.trial;
      if (!trial) return null;
      // No banner on the first day. A person who started a "no card needed" trial a minute ago is
      // not asked to pick a plan in their first session. The launcher tiles and billing home still
      // show the days left.
      if (context.now.getTime() - trial.startedAt.getTime() < DAY_MS) return null;
      return notice(
        'trial',
        'info',
        `Free trial. ${trial.daysLeft} days left. Ends ${day(trial.endsAt)}.`,
        payer ? { label: 'Pick a plan', href: link({ to: 'plan' }) } : seePlan,
      );
    }
    case 'trial_ending': {
      const trial = state.trial;
      if (!trial) return null;
      let text: string;
      if (trial.daysLeft >= 2) {
        text = `Your free trial ends in ${trial.daysLeft} days, on ${day(trial.endsAt)}.`;
      } else if (sameCalendarDay(trial.endsAt, context.now, timeZone)) {
        text = 'Your free trial ends today.';
      } else {
        text = `Your free trial ends tomorrow, on ${day(trial.endsAt)}.`;
      }
      if (!payer) return notice('trial_ending', 'warning', `${text} Ask ${who} to pick a plan.`, null);
      return notice('trial_ending', 'warning', text, { label: 'Pick a plan', href: link({ to: 'plan' }) });
    }
    case 'trial_with_card': {
      const charge = state.nextCharge;
      const trial = state.trial;
      if (!trial) return null;
      const text = charge
        ? `Free trial. Your first payment of ${formatMoney(charge.amountCents)} is on ${day(charge.at)}.`
        : `Free trial. Your first payment is on ${day(trial.endsAt)}.`;
      return notice('trial_with_card', 'info', text, seePlan);
    }
    case 'trial_ended': {
      const ended = state.trial ? ` on ${day(state.trial.endsAt)}` : '';
      if (!payer) {
        return notice('trial_ended', 'danger', `Your free trial ended${ended}. Your data is safe. Ask ${who} to pick a plan.`, null);
      }
      return notice(
        'trial_ended',
        'danger',
        `Your free trial ended${ended}. Your data is safe. Pick a plan to keep working.`,
        { label: 'Pick a plan', href: link({ to: 'plan' }) },
      );
    }
    case 'payment_failed': {
      const due = state.pastDue;
      if (!due) return null;
      const card = cardLabel(state.paymentMethod);
      const parts = [`We could not charge ${payer ? 'your' : 'the'} ${card} for ${formatMoney(due.amountDueCents)}.`];
      // Only a try that is still ahead is named.
      if (due.nextRetryAt && due.nextRetryAt.getTime() > context.now.getTime()) parts.push(`We will try again on ${day(due.nextRetryAt)}.`);
      if (!payer) {
        parts.push(`Ask ${who} to update the card by ${day(due.accessChangesAt)} to keep full access.`);
        return notice('payment_failed', 'warning', parts.join(' '), null);
      }
      parts.push(`Update your card by ${day(due.accessChangesAt)} to keep full access.`);
      return notice('payment_failed', 'warning', parts.join(' '), {
        label: 'Update card',
        href: link({ to: 'fix_payment' }),
      });
    }
    case 'unpaid': {
      // One name for the fix (review round 4): the sentence and the button both say "update card".
      const late = appsOpen ? 'Your payment is late.' : 'Your payment is late, so your apps are view only.';
      if (!payer) return notice('unpaid', 'danger', `${late} Ask ${who} to update the card.`, null);
      return notice(
        'unpaid',
        'danger',
        appsOpen ? `${late} Update your card to keep your apps open.` : `${late} Update your card to turn them back on.`,
        { label: 'Update card', href: link({ to: 'fix_payment' }) },
      );
    }
    case 'cancel_scheduled': {
      const text = state.cancelAt
        ? `Your plan ends on ${day(state.cancelAt)}. You keep everything until then.`
        : 'Your plan is set to end. You keep everything until then.';
      return notice('cancel_scheduled', 'info', text, payer ? { label: 'Keep my plan', href: link({ to: 'home' }) } : seePlan);
    }
    case 'pause_scheduled': {
      if (!state.pause) return null;
      return notice(
        'pause_scheduled',
        'info',
        `Your plan pauses on ${day(state.pause.startsAt)} and starts again on ${day(state.pause.resumesAt)}.`,
        payer ? { label: 'Undo pause', href: link({ to: 'home' }) } : seePlan,
      );
    }
    case 'paused': {
      const again = state.pause ? ` It starts again on ${day(state.pause.resumesAt)}.` : '';
      const text = appsOpen ? `Your plan is paused.${again}` : `Your plan is paused, so your apps are view only.${again}`;
      if (!payer) return notice('paused', 'danger', `${text} Ask ${who} to start it sooner.`, null);
      return notice('paused', 'danger', text, {
        label: 'Start again now',
        href: link({ to: 'home' }),
      });
    }
    case 'ended': {
      // The reason comes first, so a customer who never canceled is told why (review round 3).
      const ended = planEndedLine(state, timeZone, true) ?? 'Your plan ended.';
      if (!payer) return notice('ended', 'danger', `${ended} Your data is safe. Ask ${who} to pick a plan.`, null);
      return notice(
        'ended',
        'danger',
        `${ended} Your data is safe. Pick a plan to keep working.`,
        { label: 'Pick a plan', href: link({ to: 'plan' }) },
      );
    }
  }
}

/* ===== lock screen ===== */

function priceWords(product: ProductId, interval: BillingInterval, bundle: boolean): string {
  return `${formatMoney(unitCents(product, interval, bundle), { trimZeroCents: true })} ${priceTermsLabel(product, interval)}`;
}

/** Only for a module whose access is 'locked'. */
export function planLockFor(state: PlanState, context: NoticeContext & { module: ProductId }): PlanLock {
  const { module, viewer, portalUrl, timeZone } = context;
  const name = CATALOG.products[module].shortName;
  const secondary = { label: 'Back to Portal', href: portalUrl.replace(/\/+$/, '') };
  const addHref = billingLink(portalUrl, { to: 'add', product: module }, module, context.orgId);
  const base = { secondary, testId: 'plan-lock' as const };

  const inTrial = state.phase === 'trial';
  const freeTrialOpen = state.phase === 'none' && state.trialEligible;
  // Owners, admins and billing managers can start a trial and change trial apps. Only owners and
  // billing managers can change a paid plan.
  const canAct = inTrial || freeTrialOpen ? viewer.canView || viewer.canManage : viewer.canManage;

  if (!canAct) {
    return {
      ...base,
      kind: 'not_in_plan',
      title: `${name} is not in your plan yet`,
      body: `Ask ${askWho(viewer)} to add it.`,
      priceLine: null,
      primary: null,
    };
  }

  const current = toStack(state.selection.products.filter((id) => id !== module));
  const after = toStack([...current, module]);
  const interval = state.selection.interval;
  const bundleAfter = isBundle(after);

  if (freeTrialOpen) {
    return {
      ...base,
      kind: 'trial_available',
      title: `${name} is not in your plan yet`,
      body: `Try it free for ${CATALOG.trialDays} days. No card needed.`,
      priceLine: `After that, ${name} is ${priceWords(module, 'monthly', false)}.`,
      primary: { label: 'Start free trial', href: addHref },
    };
  }

  if (inTrial && state.trial) {
    return {
      ...base,
      kind: 'trial_available',
      title: `${name} is not in your trial yet`,
      body: `Add it now. It is free until ${formatDayShort(state.trial.endsAt, timeZone)}.`,
      priceLine: bundleAfter
        ? `After your trial, ${name} is ${priceWords(module, interval, true)} with your bundle discount.`
        : `After your trial, ${name} is ${priceWords(module, interval, false)}.`,
      primary: { label: `Add ${name} to my trial`, href: addHref },
    };
  }

  let priceLine: string | null = null;
  if (bundleAfter) {
    priceLine = isBundle(current)
      ? 'That price includes your bundle discount.'
      : `That price includes the bundle discount. Your other app gets ${CATALOG.bundlePercentOff}% off too.`;
  }
  return {
    ...base,
    kind: 'not_in_plan',
    title: `${name} is not in your plan yet`,
    body: `Add ${name} for ${priceWords(module, interval, bundleAfter)}.`,
    priceLine,
    primary: { label: `Add ${name} to my plan`, href: addHref },
  };
}

/* ===== badges ===== */

/** Badge text for tiles and the app switcher. */
export type PlanBadge = 'trial' | 'active' | 'past_due' | 'view_only' | 'not_in_plan' | 'included';

/** The words each badge shows on screen. */
export const PLAN_BADGE_LABELS: Readonly<Record<PlanBadge, string>> = {
  trial: 'Trial',
  active: 'Active',
  past_due: 'Payment due',
  view_only: 'View only',
  not_in_plan: 'Not in your plan',
  included: 'Included',
};

export function planBadgeFor(state: PlanState, product: ProductId): PlanBadge {
  const plan = state.modules[product];
  if (plan.access === 'locked') return 'not_in_plan';
  if (plan.access === 'read_only') return 'view_only';
  if (plan.source === 'manual') return 'included';
  if (plan.source === 'trial') return 'trial';
  if (plan.inPlan && state.phase === 'past_due') return 'past_due';
  if (plan.inPlan && state.trial) return 'trial';
  return 'active';
}
