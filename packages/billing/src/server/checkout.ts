/**
 * Checkout (docs/billing/CONTRACTS.md section 11.5): the first payment. The server prices the cart
 * from the catalog, makes the gateway session, and builds the return URLs itself. Nothing from the
 * browser but the cart is trusted.
 */
import { eq } from 'drizzle-orm';
import { billingAccounts, billingSubscriptions, stripeCustomers } from '@kitstak/db/schema';
import { CATALOG, normalizeSelection, type PlanSelection, productListLabel } from '../catalog';
import { type BillingResult, billingError, billingOk } from '../errors';
import { isLiveSubscriptionStatus, type PlanState } from '../plan-state';
import { type Quote, quote } from '../quote';
import { recordAudit } from './audit';
import { writeCart } from './cart';
import { type BillingActor, type BillingDb, type BillingRuntime, errorText, logBilling } from './db';
import { getBillingProfile, profileInput } from './profile';
import { enforceRateLimit } from './rate-limit';
import { getPlanState } from './state';
import { applyInvoiceSnapshot, applySubscriptionSnapshot, clearBillingCaches, withCardFallback } from './sync';

const HOUR_MS = 60 * 60 * 1000;
/** A gateway rule: a trial end must be at least 48 hours ahead. Five minutes of slack on top. */
const MIN_TRIAL_AHEAD_MS = 48 * HOUR_MS + 5 * 60 * 1000;

/**
 * The plan cannot be smaller than what is in use. Returns the plain sentence, or null when it fits.
 * Seats matter when a per user app or Pulse is in the stack; warehouses when WMS is.
 */
export function belowUsageMessage(selection: PlanSelection, state: PlanState): string | null {
  const seatsMatter = selection.products.some(
    (id) => CATALOG.products[id].quantityFrom === 'seats' || CATALOG.products[id].includedSeats !== null,
  );
  const perUser = selection.products.some((id) => CATALOG.products[id].quantityFrom === 'seats');
  const used = state.usage.seatsUsed;
  if (seatsMatter && perUser && selection.seats < used) {
    return `You have ${used} people. Pick ${used} seats or more.`;
  }
  if (seatsMatter && !perUser) {
    const included = CATALOG.products.pulse.includedSeats ?? 0;
    if (used > included) return `Pulse covers up to ${included} seats and you have ${used} people. For a bigger team, talk to us.`;
  }
  const warehouses = state.usage.warehousesUsed ?? 0;
  if (selection.products.includes('wms') && selection.warehouses < warehouses) {
    return `You have ${warehouses} warehouses. Pick ${warehouses} or more.`;
  }
  return null;
}

/** When the first charge happens and what is due today, for a cart and the plan as it is now. */
export function firstChargeFor(state: PlanState, total: number, now: Date): { dueTodayCents: number; firstChargeAt: Date; trialEnd: Date | null } {
  const trialRunning = state.phase === 'trial' && state.trial !== null;
  if (trialRunning && state.trial) {
    // Adding a card early never costs trial days. The gateway needs the date 48 hours ahead.
    const trialEnd = new Date(Math.max(state.trial.endsAt.getTime(), now.getTime() + MIN_TRIAL_AHEAD_MS));
    return { dueTodayCents: 0, firstChargeAt: trialEnd, trialEnd };
  }
  return { dueTodayCents: total, firstChargeAt: now, trialEnd: null };
}

/** What the review step shows. No gateway call. */
export async function checkoutPreview(
  rt: Pick<BillingRuntime, 'db' | 'mode' | 'now'>,
  input: { orgId: string; selection: PlanSelection },
): Promise<BillingResult<{ quote: Quote; dueTodayCents: number; firstChargeAt: Date; trialEnd: Date | null; taxNote: boolean }>> {
  const selection = normalizeSelection(input.selection);
  if (selection.products.length === 0) return billingError('invalid_selection');
  const state = await getPlanState(rt, input.orgId);
  const below = belowUsageMessage(selection, state);
  if (below) return billingError('below_usage', below);
  const priced = quote(selection);
  const first = firstChargeFor(state, priced.totalCents, rt.now());
  return billingOk({
    quote: priced,
    ...first,
    // Tax is worked out on the gateway's pay page. Only the two Stripe modes can add it.
    taxNote: rt.mode === 'live' || rt.mode === 'stripe_test',
  });
}

export async function createCheckout(
  rt: BillingRuntime,
  input: { orgId: string; orgName: string; selection: PlanSelection; actor: BillingActor; actorEmail: string },
): Promise<BillingResult<{ url: string; sessionId: string; dueTodayCents: number; firstChargeAt: Date }>> {
  if (!rt.gateway) return billingError('billing_unavailable');
  const gateway = rt.gateway;
  const selection = normalizeSelection(input.selection);
  if (selection.products.length === 0) return billingError('invalid_selection');

  const [existing] = await rt.db
    .select({ status: billingSubscriptions.status })
    .from(billingSubscriptions)
    .where(eq(billingSubscriptions.orgId, input.orgId));
  if (existing && isLiveSubscriptionStatus(existing.status)) return billingError('already_subscribed');

  const state = await getPlanState(rt, input.orgId);
  const below = belowUsageMessage(selection, state);
  if (below) return billingError('below_usage', below);

  const allowed = await enforceRateLimit(rt.db, { key: `checkout:${input.orgId}`, windowSeconds: 600, max: 10 });
  if (!allowed) return billingError('rate_limited');

  await writeCart(rt.db, input.orgId, selection);

  const priced = quote(selection);
  const first = firstChargeFor(state, priced.totalCents, rt.now());
  // Both URLs are built here from the runtime, never from input.
  const successUrl = `${rt.portalUrl}/billing/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${rt.portalUrl}/billing/checkout/canceled`;

  try {
    const profile = await getBillingProfile(rt.db, input.orgId);
    const [account] = await rt.db
      .select({ gateway: billingAccounts.gateway })
      .from(billingAccounts)
      .where(eq(billingAccounts.orgId, input.orgId));
    const [stored] = await rt.db.select().from(stripeCustomers).where(eq(stripeCustomers.orgId, input.orgId));
    // A customer made by another gateway is treated as missing and replaced.
    const existingCustomerId = stored && account?.gateway === gateway.kind ? stored.stripeCustomerId : null;
    const { customerId } = await gateway.ensureCustomer({
      orgId: input.orgId,
      existingCustomerId,
      profile: profileInput(profile, { email: input.actorEmail, name: input.orgName }),
    });
    await rt.db
      .insert(stripeCustomers)
      .values({ orgId: input.orgId, stripeCustomerId: customerId })
      .onConflictDoUpdate({ target: stripeCustomers.orgId, set: { stripeCustomerId: customerId } });
    await rt.db
      .update(billingAccounts)
      .set({ gateway: gateway.kind, updatedAt: rt.now() })
      .where(eq(billingAccounts.orgId, input.orgId));

    const session = await gateway.createCheckoutSession({
      orgId: input.orgId,
      customerId,
      selection,
      trialEnd: first.trialEnd,
      successUrl,
      cancelUrl,
    });
    await recordAudit(rt.db, {
      orgId: input.orgId,
      actor: input.actor,
      action: 'checkout.started',
      summary: `${input.actor.label} started checkout for ${productListLabel(selection.products)}.`,
      data: { selection, sessionId: session.id, totalCents: priced.totalCents },
    });
    return billingOk({
      url: session.url,
      sessionId: session.id,
      dueTodayCents: first.dueTodayCents,
      firstChargeAt: first.firstChargeAt,
    });
  } catch (error) {
    logBilling('error', 'create checkout failed', { orgId: input.orgId, error: errorText(error) });
    return billingError('gateway_error');
  }
}

/**
 * Applies a finished checkout session with the given database handle (a transaction in the webhook).
 * Returns true when the session is complete and was applied. A session that is not paid, or that
 * belongs to another org, applies nothing.
 */
export async function applyCheckoutSession(
  rt: BillingRuntime,
  db: BillingDb,
  input: { orgId: string; sessionId: string; eventId?: string },
): Promise<'applied' | 'not_complete' | 'not_found'> {
  if (!rt.gateway) return 'not_found';
  const session = await rt.gateway.getCheckoutSession(input.sessionId);
  if (!session || session.orgId !== input.orgId) return 'not_found';
  if (session.status !== 'complete' || !session.subscriptionId) return 'not_complete';
  const subscription = await rt.gateway.getSubscription(session.subscriptionId);
  if (!subscription) return 'not_complete';
  if (subscription.orgId !== null && subscription.orgId !== input.orgId) return 'not_found';
  if (session.customerId !== null && subscription.customerId !== session.customerId) return 'not_found';

  const latestInvoice = subscription.latestInvoiceId ? await rt.gateway.getInvoice(subscription.latestInvoiceId) : null;
  if (latestInvoice) {
    await applyInvoiceSnapshot(db, {
      orgId: input.orgId,
      gateway: rt.gateway.kind,
      invoice: withCardFallback(latestInvoice, subscription),
    });
  }
  await applySubscriptionSnapshot(db, {
    orgId: input.orgId,
    gateway: rt.gateway.kind,
    subscription,
    latestInvoice,
    now: rt.now(),
    portalUrl: rt.portalUrl,
    ...(input.eventId ? { eventId: input.eventId } : {}),
  });
  return 'applied';
}

/**
 * Called by the success page and by the webhook. Safe to call many times. The answer is the plan as
 * it is now: when the gateway has not confirmed the payment yet, nothing is granted and the state
 * simply shows no plan.
 */
export async function syncCheckoutSession(
  rt: BillingRuntime,
  input: { orgId: string; sessionId: string },
): Promise<BillingResult<PlanState>> {
  if (!rt.gateway) return billingError('billing_unavailable');
  try {
    const outcome = await rt.db.transaction(async (tx) => applyCheckoutSession(rt, tx, input));
    if (outcome === 'not_found') return billingError('not_found');
  } catch (error) {
    logBilling('error', 'sync checkout session failed', { orgId: input.orgId, error: errorText(error) });
    return billingError('gateway_error');
  } finally {
    clearBillingCaches(input.orgId);
  }
  return billingOk(await getPlanState(rt, input.orgId));
}
