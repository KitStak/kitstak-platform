/**
 * Changing a paid plan (docs/billing/CONTRACTS.md section 11.6, SPEC P9). One rule for every change:
 * it starts right away, an increase is charged now for the days left, a decrease becomes credit on
 * the next bill. The person always sees the amount first.
 *
 * Three rules keep the money honest (review round 1, CONTRACTS section 24):
 *  - The server picks the date a change is prorated from (`proration.ts`): whole days, charges
 *    rounded up, credits rounded down. A date from the browser is never used for money.
 *  - A preview carries a `basis`: a fingerprint of the plan it was worked out for. Confirming with a
 *    basis that no longer matches is refused with "The amount changed while you were looking", even
 *    when the dollars happen to match. So a stale panel can never apply to a plan it did not show.
 *  - The amount due today must equal a fresh preview to the cent.
 */
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { billingSubscriptions, type BillingSubscription } from '@kitstak/db/schema';
import {
  CATALOG,
  formatMoney,
  normalizeSelection,
  type PlanSelection,
  PRODUCT_IDS,
  productListLabel,
} from '../catalog';
import { changeWords, type ChangeWords } from '../change-words';
import { type BillingResult, billingError, billingOk } from '../errors';
import {
  type BillingGateway,
  type ChangePreview,
  GatewayCardError,
  type GatewayInvoice,
  type GatewaySubscription,
} from '../gateway/types';
import { isLiveSubscriptionStatus, type PlanState } from '../plan-state';
import { prorationDateFor, prorationDaysLeft, prorationDirection, type ProrationDirection } from '../proration';
import { quote } from '../quote';
import { recordAudit } from './audit';
import { writeCart } from './cart';
import { belowUsageMessage } from './checkout';
import { type BillingActor, type BillingRuntime, errorText, logBilling } from './db';
import { withOrgBillingTurn } from './lock';
import { enforceRateLimit } from './rate-limit';
import { getPlanState } from './state';
import { applyInvoiceSnapshot, applySubscriptionSnapshot, clearBillingCaches, lockOrgBilling, withCardFallback } from './sync';

/** What the confirm panel gets: the gateway's preview plus what it was based on. */
export interface PlanChangePreview extends ChangePreview, ChangeWords {
  /** A fingerprint of the plan this preview was worked out for. Pass it back unchanged to confirm. */
  readonly basis: string;
  /**
   * Whole days the prorated amount is for: rounded up for a charge (a day that has started counts),
   * rounded down for a credit (only full days come back). null when nothing is prorated (free
   * trial, no change). The panel shows `dueTodayNote` and `creditNote`, which are written from it.
   */
  readonly daysLeft: number | null;
  /** Credit the organization holds before this change. */
  readonly creditBalanceCents: number;
}

interface Ready {
  readonly row: BillingSubscription;
  readonly state: PlanState;
  readonly selection: PlanSelection;
}

async function prepare(
  rt: BillingRuntime,
  input: { orgId: string; selection: PlanSelection },
): Promise<{ ok: true; ready: Ready } | { ok: false; error: ReturnType<typeof billingError> }> {
  if (!rt.gateway) return { ok: false, error: billingError('billing_unavailable') };
  const selection = normalizeSelection(input.selection);
  // Removing the last app is a cancel, and cancel has its own screen.
  if (selection.products.length === 0) return { ok: false, error: billingError('invalid_selection') };

  const [row] = await rt.db.select().from(billingSubscriptions).where(eq(billingSubscriptions.orgId, input.orgId));
  if (!row || !isLiveSubscriptionStatus(row.status) || row.gateway !== rt.gateway.kind) {
    return { ok: false, error: billingError('no_subscription') };
  }
  if (row.status === 'past_due' || row.status === 'unpaid') {
    return { ok: false, error: billingError('payment_failed', 'Fix your payment first. Then you can change your plan.') };
  }
  if (row.pauseResumesAt) {
    return { ok: false, error: billingError('invalid_input', 'Your plan is paused. Start it again first, then change it.') };
  }
  const state = await getPlanState(rt, input.orgId);
  const below = belowUsageMessage(selection, state);
  if (below) return { ok: false, error: billingError('below_usage', below) };
  return { ok: true, ready: { row, state, selection } };
}

function sameSelection(a: PlanSelection, b: PlanSelection): boolean {
  const perUser = (s: PlanSelection) => s.products.some((id) => CATALOG.products[id].quantityFrom === 'seats');
  return (
    a.interval === b.interval &&
    a.products.join(',') === b.products.join(',') &&
    (!perUser(a) || a.seats === b.seats) &&
    (!a.products.includes('wms') || a.warehouses === b.warehouses)
  );
}

/**
 * The fingerprint of a plan as the gateway has it now: which subscription, what is on it, the paid
 * period, and the credit. Any change that lands (seats, apps, billing period, a renewal, credit
 * used) gives a new value.
 */
export function planBasis(subscription: GatewaySubscription): string {
  const items = subscription.items
    .map((item) => `${item.product}:${item.quantity}:${item.unitCents}`)
    .sort()
    .join(',');
  const parts = [
    subscription.id,
    subscription.status,
    subscription.interval,
    items,
    subscription.currentPeriodStart.getTime(),
    subscription.currentPeriodEnd.getTime(),
    subscription.trialEnd ? subscription.trialEnd.getTime() : 0,
    subscription.creditBalanceCents,
    subscription.cancelAtPeriodEnd ? 1 : 0,
    subscription.pauseResumesAt ? subscription.pauseResumesAt.getTime() : 0,
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

interface Pricing {
  readonly subscription: GatewaySubscription;
  readonly basis: string;
  readonly direction: ProrationDirection;
  readonly prorationDate: Date;
  readonly daysLeft: number | null;
}

/** Reads the plan from the gateway and picks the date this change is prorated from. Nothing from the caller but the cart. */
async function pricingFor(gateway: BillingGateway, row: BillingSubscription, selection: PlanSelection, now: Date): Promise<Pricing | null> {
  const subscription = await gateway.getSubscription(row.gatewaySubscriptionId);
  if (!subscription || !isLiveSubscriptionStatus(subscription.status)) return null;
  const oldRecurringCents = subscription.items.reduce((sum, item) => sum + item.unitCents * item.quantity, 0);
  const direction = prorationDirection({
    oldRecurringCents,
    newRecurringCents: quote(selection).totalCents,
    intervalChanged: selection.interval !== subscription.interval,
  });
  const window = { periodStart: subscription.currentPeriodStart, periodEnd: subscription.currentPeriodEnd, now, direction };
  const trialing = subscription.status === 'trialing' && subscription.trialEnd !== null;
  return {
    subscription,
    basis: planBasis(subscription),
    direction,
    prorationDate: prorationDateFor(window),
    // Inside a free trial nothing has been paid, so nothing is prorated.
    daysLeft: trialing ? null : prorationDaysLeft(window),
  };
}

export async function previewPlanChange(
  rt: BillingRuntime,
  input: { orgId: string; selection: PlanSelection },
): Promise<BillingResult<PlanChangePreview>> {
  const prepared = await prepare(rt, input);
  if (!prepared.ok) return prepared.error;
  const { row, state, selection } = prepared.ready;
  const gateway = rt.gateway!;
  try {
    const pricing = await pricingFor(gateway, row, selection, rt.now());
    if (!pricing) return billingError('no_subscription');
    const extra = { basis: pricing.basis, creditBalanceCents: pricing.subscription.creditBalanceCents };
    if (sameSelection(state.selection, selection)) {
      // The same plan: nothing to pay, nothing changes.
      return billingOk({
        dueTodayCents: 0,
        creditCents: 0,
        newRecurringCents: row.recurringCents,
        recurringDeltaCents: 0,
        nextChargeAt: row.trialEnd && row.status === 'trialing' ? row.trialEnd : (row.currentPeriodEnd ?? rt.now()),
        prorationDate: pricing.prorationDate,
        lines: [],
        taxCents: 0,
        proratedCents: 0,
        creditAppliedCents: 0,
        daysLeft: null,
        dueTodayNote: 'Nothing to pay now.',
        creditNote: null,
        ...extra,
      });
    }
    const preview = await gateway.previewChange({
      subscriptionId: row.gatewaySubscriptionId,
      selection,
      prorationDate: pricing.prorationDate,
    });
    const words = changeWords({
      dueTodayCents: preview.dueTodayCents,
      creditCents: preview.creditCents,
      creditAppliedCents: preview.creditAppliedCents,
      taxCents: preview.taxCents,
      lines: preview.lines,
      daysLeft: pricing.daysLeft,
      direction: pricing.direction,
      fromInterval: pricing.subscription.interval,
      toInterval: selection.interval,
    });
    return billingOk({ ...preview, daysLeft: pricing.daysLeft, ...words, ...extra });
  } catch (error) {
    logBilling('error', 'preview plan change failed', { orgId: input.orgId, error: errorText(error) });
    return billingError('gateway_error');
  }
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** A full plain sentence or two for the activity page: what changed, and what the plan is now. */
export function describePlanChange(actor: string, before: PlanSelection, after: PlanSelection): string {
  const parts: string[] = [];
  const added = PRODUCT_IDS.filter((id) => after.products.includes(id) && !before.products.includes(id));
  const removed = PRODUCT_IDS.filter((id) => before.products.includes(id) && !after.products.includes(id));
  const perUser = (s: PlanSelection) => s.products.some((id) => CATALOG.products[id].quantityFrom === 'seats');
  if (added.length > 0) parts.push(`added ${productListLabel(added)}`);
  if (removed.length > 0) parts.push(`removed ${productListLabel(removed)}`);
  let tail = '';
  if (perUser(before) && perUser(after) && after.seats !== before.seats) {
    const diff = after.seats - before.seats;
    parts.push(diff > 0 ? `added ${plural(diff, 'seat', 'seats')}` : `removed ${plural(-diff, 'seat', 'seats')}`);
    tail = ` The plan is now ${plural(after.seats, 'seat', 'seats')}.`;
  }
  if (before.products.includes('wms') && after.products.includes('wms') && after.warehouses !== before.warehouses) {
    const diff = after.warehouses - before.warehouses;
    parts.push(diff > 0 ? `added ${plural(diff, 'warehouse', 'warehouses')}` : `removed ${plural(-diff, 'warehouse', 'warehouses')}`);
    tail += ` The plan is now ${plural(after.warehouses, 'warehouse', 'warehouses')}.`;
  }
  if (after.interval !== before.interval) {
    parts.push(after.interval === 'yearly' ? 'switched to paying yearly' : 'switched to paying monthly');
  }
  if (parts.length === 0) return `${actor} confirmed the plan.`;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${actor} ${list}.${tail}`;
}

/** What the change did to money, as one plain sentence for the activity page. Empty when nothing moved. */
export function describeChangeMoney(preview: Pick<ChangePreview, 'dueTodayCents' | 'creditCents' | 'creditAppliedCents'>): string {
  if (preview.creditCents > 0) return ` ${formatMoney(preview.creditCents)} credit was added. It comes off the next bills.`;
  if (preview.creditAppliedCents > 0 && preview.dueTodayCents === 0) {
    return ` ${formatMoney(preview.creditAppliedCents)} was paid from credit. Nothing was charged.`;
  }
  if (preview.creditAppliedCents > 0) {
    return ` ${formatMoney(preview.creditAppliedCents)} was paid from credit and ${formatMoney(preview.dueTodayCents)} was charged.`;
  }
  if (preview.dueTodayCents > 0) return ` ${formatMoney(preview.dueTodayCents)} was charged for the days left.`;
  return '';
}

export async function applyPlanChange(
  rt: BillingRuntime,
  input: {
    orgId: string;
    selection: PlanSelection;
    /** The `basis` of the preview the person confirmed. */
    basis: string;
    expectedDueTodayCents: number;
    actor: BillingActor;
    /**
     * Ignored. Older callers sent the date of their preview; the server now picks the date itself,
     * so a date from the browser can never move money.
     */
    prorationDate?: unknown;
  },
): Promise<BillingResult<PlanState>> {
  // A first look without the turn: an answer a person can fix needs no waiting.
  const early = await prepare(rt, input);
  if (!early.ok) return early.error;
  if (sameSelection(early.ready.state.selection, early.ready.selection)) return billingOk(early.ready.state);

  const allowed = await enforceRateLimit(rt.db, { key: `plan-change:${input.orgId}`, windowSeconds: 3600, max: 20 });
  if (!allowed) return billingError('rate_limited');

  // One confirm at a time per organization (review round 2). The basis check, the fresh preview and
  // the gateway call are one step now. Confirms that arrive together run one after the other: the
  // first applies the change, and each later one reads the plan the first one left. It then either
  // finds its change already done and returns the plan as it is, or is told the amount changed.
  // The gateway is asked to charge once.
  try {
    const turn = await withOrgBillingTurn(rt.db, { orgId: input.orgId, purpose: 'plan_change' }, () => confirmChange(rt, input));
    return turn.ok ? turn.value : billingError('busy');
  } catch (error) {
    logBilling('error', 'apply plan change failed', { orgId: input.orgId, error: errorText(error) });
    return billingError('gateway_error');
  } finally {
    clearBillingCaches(input.orgId);
  }
}

/**
 * What a change did to money, read from the gateway's own answer and not from the preview: the
 * invoice it made for this change, and the credit balance before and after.
 */
function moneyOfChange(
  before: GatewaySubscription,
  after: GatewaySubscription,
  invoice: GatewayInvoice | null,
  preview: ChangePreview,
): Pick<ChangePreview, 'dueTodayCents' | 'creditCents' | 'creditAppliedCents'> & { invoiceId: string | null } {
  const made = invoice !== null && invoice.id !== before.latestInvoiceId && invoice.status === 'paid' ? invoice : null;
  if (made) {
    return { dueTodayCents: made.amountPaidCents, creditCents: 0, creditAppliedCents: made.creditAppliedCents, invoiceId: made.id };
  }
  // No invoice: nothing was charged. Credit went up (a decrease) or down (credit paid for the change).
  const delta = after.creditBalanceCents - before.creditBalanceCents;
  return {
    dueTodayCents: 0,
    creditCents: delta > 0 ? delta : preview.creditCents > 0 && delta === 0 ? preview.creditCents : 0,
    creditAppliedCents: delta < 0 ? -delta : 0,
    invoiceId: null,
  };
}

/** The body of `applyPlanChange`. Only ever runs while the organization's billing turn is held. */
async function confirmChange(
  rt: BillingRuntime,
  input: { orgId: string; selection: PlanSelection; basis: string; expectedDueTodayCents: number; actor: BillingActor },
): Promise<BillingResult<PlanState>> {
  // Read again, now that the turn is ours: another confirm may have finished while this one waited.
  clearBillingCaches(input.orgId);
  const prepared = await prepare(rt, input);
  if (!prepared.ok) return prepared.error;
  const { row, state, selection } = prepared.ready;
  const gateway = rt.gateway!;
  // The same change was confirmed a moment ago (a double click, two tabs). It is done; say so.
  if (sameSelection(state.selection, selection)) return billingOk(state);

  try {
    const pricing = await pricingFor(gateway, row, selection, rt.now());
    if (!pricing) return billingError('no_subscription');
    // Another change landed since the preview (another tab, another person, a renewal). The panel the
    // person confirmed described a plan that no longer exists, so it is shown again with new numbers.
    if (typeof input.basis !== 'string' || input.basis.length === 0 || input.basis !== pricing.basis) {
      return billingError('price_changed');
    }
    const fresh = await gateway.previewChange({
      subscriptionId: row.gatewaySubscriptionId,
      selection,
      prorationDate: pricing.prorationDate,
    });
    if (!Number.isFinite(input.expectedDueTodayCents) || fresh.dueTodayCents !== Math.round(input.expectedDueTodayCents)) {
      return billingError('price_changed');
    }

    const subscription = await gateway.applyChange({
      subscriptionId: row.gatewaySubscriptionId,
      selection,
      prorationDate: fresh.prorationDate,
    });
    const latestInvoice = subscription.latestInvoiceId ? await gateway.getInvoice(subscription.latestInvoiceId) : null;
    const money = moneyOfChange(pricing.subscription, subscription, latestInvoice, fresh);
    await rt.db.transaction(async (tx) => {
      await lockOrgBilling(tx, input.orgId);
      if (latestInvoice) {
        await applyInvoiceSnapshot(tx, {
          orgId: input.orgId,
          gateway: gateway.kind,
          invoice: withCardFallback(latestInvoice, subscription),
        });
      }
      await applySubscriptionSnapshot(tx, {
        orgId: input.orgId,
        gateway: gateway.kind,
        subscription,
        latestInvoice,
        now: rt.now(),
        portalUrl: rt.portalUrl,
        actor: input.actor,
      });
      await writeCart(tx, input.orgId, selection);
      const after = quote(selection);
      await recordAudit(tx, {
        orgId: input.orgId,
        actor: input.actor,
        action: 'plan.changed',
        summary: `${describePlanChange(input.actor.label, state.selection, selection)}${describeChangeMoney(money)}`,
        data: {
          before: state.selection,
          after: selection,
          dueTodayCents: money.dueTodayCents,
          creditCents: money.creditCents,
          creditAppliedCents: money.creditAppliedCents,
          invoiceId: money.invoiceId,
          creditBalanceCents: subscription.creditBalanceCents,
          daysLeft: pricing.daysLeft,
          newRecurringCents: after.totalCents,
          newRecurring: formatMoney(after.totalCents),
        },
      });
    });
  } catch (error) {
    if (error instanceof GatewayCardError) return billingError('card_declined');
    logBilling('error', 'apply plan change failed', { orgId: input.orgId, error: errorText(error) });
    return billingError('gateway_error');
  } finally {
    clearBillingCaches(input.orgId);
  }
  return billingOk(await getPlanState(rt, input.orgId));
}
