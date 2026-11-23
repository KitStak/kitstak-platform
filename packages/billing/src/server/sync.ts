/**
 * Gateway snapshots into our tables (docs/billing/CONTRACTS.md sections 8 and 12). Every change of
 * plan state lands here: from a webhook, from the checkout return page, or from a direct gateway
 * answer. `core.entitlements` is written only here and in `startTrial`, always through
 * `setEntitlement`, so a manual grant is never touched.
 *
 * A snapshot is the gateway's current object, never an event body. Applying the same snapshot twice
 * changes nothing, and an old object of a replaced subscription cannot move state backward.
 */
import { and, eq, sql } from 'drizzle-orm';
import {
  billingAccounts,
  billingInvoices,
  billingSubscriptions,
  entitlements,
  organization,
  stripeCustomers,
  type BillingSubscriptionItemJson,
} from '@kitstak/db/schema';
import { type EntitlementsDb, clearEntitlementsCache, setEntitlement } from '@kitstak/entitlements';
import { CATALOG, formatDay, formatMoney, normalizeSelection, productListLabel, type ProductId } from '../catalog';
import { type BillingResult, billingError, billingOk } from '../errors';
import type { GatewayInvoice, GatewayKind, GatewaySubscription } from '../gateway/types';
import { isLiveSubscriptionStatus, type PlanState } from '../plan-state';
import { recordAudit } from './audit';
import { type BillingActor, type BillingDb, type BillingRuntime, errorText, logBilling, SYSTEM_ACTOR } from './db';
import { enqueueForBillingRecipients } from './outbox';
import { clearPlanCache, getPlanState } from './state';

/** The gateway customer of an org, when it was made by the gateway in use. */
export async function customerIdForOrg(db: Pick<BillingDb, 'select'>, orgId: string, gateway: GatewayKind): Promise<string | null> {
  const [account] = await db
    .select({ gateway: billingAccounts.gateway })
    .from(billingAccounts)
    .where(eq(billingAccounts.orgId, orgId));
  if (!account || account.gateway !== gateway) return null;
  const [customer] = await db
    .select({ id: stripeCustomers.stripeCustomerId })
    .from(stripeCustomers)
    .where(eq(stripeCustomers.orgId, orgId));
  return customer?.id ?? null;
}

async function orgName(db: Pick<BillingDb, 'select'>, orgId: string): Promise<string> {
  const [org] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, orgId));
  return org?.name ?? 'your organization';
}

/** Upserts one invoice into the cache. An invoice id that belongs to another org is left alone. */
export async function applyInvoiceSnapshot(
  db: BillingDb,
  input: { orgId: string; gateway: GatewayKind; invoice: GatewayInvoice },
): Promise<void> {
  const { invoice } = input;
  const values = {
    orgId: input.orgId,
    gateway: input.gateway,
    number: invoice.number,
    status: invoice.status,
    billingReason: invoice.billingReason,
    subtotalCents: invoice.subtotalCents,
    discountCents: invoice.discountCents,
    taxCents: invoice.taxCents,
    totalCents: invoice.totalCents,
    amountPaidCents: invoice.amountPaidCents,
    amountDueCents: invoice.amountDueCents,
    lines: invoice.lines.map((line) => ({ ...line })),
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    issuedAt: invoice.issuedAt,
    paidAt: invoice.paidAt,
    attemptCount: invoice.attemptCount,
    nextPaymentAttempt: invoice.nextPaymentAttempt,
    pmLast4: invoice.paymentMethodLast4,
    creditAppliedCents: invoice.creditAppliedCents,
    refundedCents: invoice.refundedCents,
  };
  await db
    .insert(billingInvoices)
    .values({ id: invoice.id, ...values })
    .onConflictDoUpdate({
      target: billingInvoices.id,
      set: { ...values, updatedAt: new Date() },
      setWhere: eq(billingInvoices.orgId, input.orgId),
    });
}

function seatProducts(): ProductId[] {
  return (Object.keys(CATALOG.products) as ProductId[]).filter((id) => CATALOG.products[id].quantityFrom === 'seats');
}

/**
 * Applies the gateway's current subscription: the `core.billing_subscriptions` row, the entitlement
 * rows by the table in CONTRACTS section 8, and the first audit row and email when the phase moved.
 * A subscription with status `incomplete` writes the row and no entitlement, so a declined first
 * payment never grants access.
 */
export async function applySubscriptionSnapshot(
  db: BillingDb,
  input: {
    orgId: string;
    gateway: GatewayKind;
    subscription: GatewaySubscription;
    latestInvoice: GatewayInvoice | null;
    eventId?: string;
    now: Date;
    /** Needed for the emails. With no portal URL the audit rows are still written. */
    portalUrl?: string;
    /** Who caused it. Default: KitStak (a webhook or a job). */
    actor?: BillingActor;
  },
): Promise<void> {
  const { orgId, subscription: sub, latestInvoice, now } = input;
  const actor = input.actor ?? SYSTEM_ACTOR;

  const [prev] = await db.select().from(billingSubscriptions).where(eq(billingSubscriptions.orgId, orgId));
  const live = isLiveSubscriptionStatus(sub.status);

  // One plan per organization. While the plan we know is live, no other subscription of the same
  // gateway may write the row: not an old object of a replaced one (it would undo the live plan), and
  // not a second live one (it would overwrite it and flip seats back and forth at every renewal). A
  // second live one is canceled and refunded by `rejectSecondSubscription` before it gets here.
  if (prev && prev.gatewaySubscriptionId !== sub.id && prev.gateway === input.gateway && isLiveSubscriptionStatus(prev.status)) {
    logBilling(live ? 'warn' : 'info', live ? 'refused a second live subscription' : 'skipped a snapshot of an older subscription', {
      orgId,
      subscriptionId: sub.id,
      current: prev.gatewaySubscriptionId,
    });
    return;
  }
  const samePrev = prev && prev.gatewaySubscriptionId === sub.id ? prev : null;

  const [account] = await db.select({ cart: billingAccounts.cart }).from(billingAccounts).where(eq(billingAccounts.orgId, orgId));
  const cart = normalizeSelection(account?.cart);

  const items: BillingSubscriptionItemJson[] = sub.items.map((item) => ({
    product: item.product,
    priceKey: item.priceKey,
    quantity: item.quantity,
    unitCents: item.unitCents,
    gatewayItemId: item.id,
  }));
  const seatItem = sub.items.find((item) => seatProducts().includes(item.product));
  const warehouseItem = sub.items.find((item) => item.product === 'wms');
  const seats = seatItem?.quantity ?? samePrev?.seats ?? cart.seats;
  const warehouses = warehouseItem?.quantity ?? samePrev?.warehouses ?? cart.warehouses;
  const recurringCents = sub.items.reduce((sum, item) => sum + item.unitCents * item.quantity, 0);

  // Pause: not a status. It is the two dates being set. The start is kept from the first time the
  // pause was seen (the end of the paid period back then), because periods keep rolling while paused.
  const paused = live && sub.pauseResumesAt !== null;
  let pauseStartsAt: Date | null = null;
  if (paused) {
    pauseStartsAt =
      samePrev?.pauseStartsAt ?? (sub.currentPeriodEnd.getTime() > now.getTime() ? sub.currentPeriodEnd : now);
  }

  const openInvoice = latestInvoice && latestInvoice.status === 'open' ? latestInvoice : null;
  const late = sub.status === 'past_due' || sub.status === 'unpaid';
  const pastDueSince = late ? (samePrev?.pastDueSince ?? latestInvoice?.issuedAt ?? now) : null;

  const row = {
    gateway: input.gateway,
    gatewaySubscriptionId: sub.id,
    gatewayCustomerId: sub.customerId,
    status: sub.status,
    interval: sub.interval,
    seats,
    warehouses,
    items,
    recurringCents,
    currentPeriodStart: sub.currentPeriodStart,
    currentPeriodEnd: sub.currentPeriodEnd,
    trialEnd: sub.trialEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    cancelAt: sub.cancelAt,
    canceledAt: sub.canceledAt,
    endedAt: sub.endedAt,
    pauseStartsAt,
    pauseResumesAt: paused ? sub.pauseResumesAt : null,
    pastDueSince,
    amountDueCents: late && openInvoice ? openInvoice.amountDueCents : late ? (samePrev?.amountDueCents ?? null) : null,
    nextPaymentAttempt: late && openInvoice ? openInvoice.nextPaymentAttempt : null,
    lastPaymentError: late ? (openInvoice?.lastErrorCode ?? samePrev?.lastPaymentError ?? null) : null,
    pmBrand: sub.paymentMethod?.brand ?? null,
    pmLast4: sub.paymentMethod?.last4 ?? null,
    pmExpMonth: sub.paymentMethod?.expMonth ?? null,
    pmExpYear: sub.paymentMethod?.expYear ?? null,
    latestInvoiceId: sub.latestInvoiceId,
    // The credit balance and the gateway's own answer for the next bill. Screens show these numbers,
    // so what a person reads is what the next invoice charges.
    creditCents: Math.max(0, Math.round(sub.creditBalanceCents)),
    nextChargeCents: live && sub.upcoming ? Math.max(0, Math.round(sub.upcoming.amountDueCents)) : null,
    nextDiscountCents: live && sub.upcoming ? Math.max(0, Math.round(sub.upcoming.discountCents)) : 0,
    nextDiscountLabel: live && sub.upcoming ? sub.upcoming.discountLabel : null,
    nextCreditCents: live && sub.upcoming ? Math.max(0, Math.round(sub.upcoming.creditAppliedCents)) : 0,
    gatewaySyncedAt: now,
  };
  await db
    .insert(billingSubscriptions)
    .values({ orgId, ...row })
    .onConflictDoUpdate({ target: billingSubscriptions.orgId, set: { ...row, updatedAt: now } });

  if (sub.status === 'incomplete') return;

  // Entitlement rows, one per product in the plan (CONTRACTS section 8).
  let status: 'active' | 'past_due' | 'canceled';
  let periodEnd: Date | null;
  if (sub.status === 'canceled') {
    status = 'canceled';
    periodEnd = sub.endedAt ?? sub.canceledAt ?? now;
  } else if (sub.status === 'unpaid') {
    status = 'canceled';
    periodEnd = pastDueSince ?? now;
  } else if (sub.status === 'past_due') {
    status = 'past_due';
    periodEnd = pastDueSince;
  } else if (paused) {
    status = 'canceled';
    periodEnd = pauseStartsAt;
  } else {
    status = 'active';
    periodEnd = sub.currentPeriodEnd;
  }
  const writer = db as unknown as EntitlementsDb;
  const perUserInPlan = seatItem !== undefined;
  for (const item of sub.items) {
    const pricing = CATALOG.products[item.product];
    const seatCount =
      pricing.quantityFrom === 'seats' ? item.quantity : pricing.includedSeats !== null ? (perUserInPlan ? seats : pricing.includedSeats) : null;
    await setEntitlement(writer, {
      orgId,
      module: item.product,
      status,
      source: 'stripe',
      periodEnd,
      seats: seatCount,
      stripeSubscriptionId: sub.id,
      stripePriceId: item.priceId,
    });
  }

  // Products that left the plan: paid rows for apps that are no longer an item become view only.
  const inPlan = new Set<string>(sub.items.map((item) => item.product));
  const paidRows = await db
    .select({ module: entitlements.module, status: entitlements.status, seats: entitlements.seats, priceId: entitlements.stripePriceId })
    .from(entitlements)
    .where(and(eq(entitlements.orgId, orgId), eq(entitlements.source, 'stripe')));
  for (const paid of paidRows) {
    if (inPlan.has(paid.module) || paid.status === 'canceled') continue;
    await setEntitlement(writer, {
      orgId,
      module: paid.module,
      status: 'canceled',
      source: 'stripe',
      periodEnd: now,
      seats: paid.seats,
      stripeSubscriptionId: sub.id,
      stripePriceId: paid.priceId,
    });
  }

  // The first audit row and email when the phase moved.
  const products = sub.items.map((item) => item.product);
  const period = sub.interval === 'yearly' ? 'year' : 'month';
  const eventId = input.eventId ? { eventId: input.eventId } : {};
  const wasLive = prev ? isLiveSubscriptionStatus(prev.status) : false;

  if (live && !wasLive) {
    await recordAudit(db, {
      orgId,
      actor,
      action: 'plan.started',
      summary: `The plan started: ${productListLabel(products)} for ${formatMoney(recurringCents)} per ${period}.`,
      data: { subscriptionId: sub.id, products, seats, warehouses, interval: sub.interval, recurringCents },
      ...eventId,
    });
    if (input.portalUrl) {
      const trialing = sub.status === 'trialing' && sub.trialEnd !== null;
      await enqueueForBillingRecipients(db, {
        orgId,
        template: 'plan_started',
        payload: {
          orgName: await orgName(db, orgId),
          portalUrl: input.portalUrl,
          products,
          totalCents: recurringCents,
          interval: sub.interval,
          firstChargeAt: (trialing && sub.trialEnd ? sub.trialEnd : sub.currentPeriodStart).toISOString(),
          dueTodayCents: trialing ? 0 : (latestInvoice?.totalCents ?? recurringCents),
          // With a trial still running: what the first bill really charges (after a promo code and credit).
          ...(trialing && sub.upcoming ? { firstChargeCents: sub.upcoming.amountDueCents } : {}),
        },
        dedupeKey: `plan_started:${sub.id}`,
      });
    }
  }

  if (samePrev && samePrev.status !== 'canceled' && sub.status === 'canceled') {
    const endedAt = sub.endedAt ?? sub.canceledAt ?? now;
    await recordAudit(db, {
      orgId,
      actor,
      action: 'plan.ended',
      summary: 'The plan ended. Your apps are view only. Your data is safe.',
      data: { subscriptionId: sub.id, endedAt: endedAt.toISOString() },
      ...eventId,
    });
    if (input.portalUrl) {
      await enqueueForBillingRecipients(db, {
        orgId,
        template: 'plan_ended',
        payload: { orgName: await orgName(db, orgId), portalUrl: input.portalUrl, endedAt: endedAt.toISOString() },
        dedupeKey: `plan_ended:${sub.id}`,
      });
    }
  }

  if (samePrev?.pauseResumesAt && samePrev.pauseStartsAt && samePrev.pauseStartsAt.getTime() <= now.getTime() && live && !paused) {
    await recordAudit(db, {
      orgId,
      actor,
      action: 'plan.resumed',
      summary: 'The plan is active again.',
      data: { subscriptionId: sub.id },
      ...eventId,
    });
  }

  // The pause has begun and the last sync was before it began: this is the first sight of it.
  const pauseBegan = paused && pauseStartsAt !== null && pauseStartsAt.getTime() <= now.getTime();
  const seenBefore =
    samePrev?.pauseStartsAt != null && samePrev.gatewaySyncedAt.getTime() >= samePrev.pauseStartsAt.getTime();
  if (pauseBegan && !seenBefore && sub.pauseResumesAt) {
    await recordAudit(db, {
      orgId,
      actor: SYSTEM_ACTOR,
      action: 'plan.paused',
      summary: `The plan is paused. It starts again on ${formatDay(sub.pauseResumesAt)}.`,
      data: { subscriptionId: sub.id, resumesAt: sub.pauseResumesAt.toISOString() },
      ...eventId,
    });
  }
}

/**
 * One writer per organization until the transaction ends. Two webhooks, or a webhook and a return
 * page, then apply their snapshots one after the other, never at the same moment. Outside a
 * transaction this does nothing useful, so every caller that applies a snapshot runs in one.
 */
export async function lockOrgBilling(db: Pick<BillingDb, 'execute'>, orgId: string): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`kitstak-billing-org:${orgId}`}, 0))`);
}

/** True when the org's plan row is live and belongs to another subscription than the one given. */
export async function isForeignSubscription(db: Pick<BillingDb, 'select'>, orgId: string, subscriptionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: billingSubscriptions.gatewaySubscriptionId, status: billingSubscriptions.status })
    .from(billingSubscriptions)
    .where(eq(billingSubscriptions.orgId, orgId));
  return row !== undefined && row.id !== subscriptionId && isLiveSubscriptionStatus(row.status);
}

/**
 * The guard against paying twice. An organization has one plan. When a live subscription arrives
 * for an organization whose own plan is live under another id (two checkout pages were both paid),
 * the newcomer is canceled, its payment is sent back, and an activity line says so. Returns true
 * when the newcomer was rejected; the caller then applies nothing.
 *
 * If the plan we know turns out to be gone at the gateway (an event was lost), that is recorded
 * first and the newcomer is let in.
 */
export async function rejectSecondSubscription(
  rt: BillingRuntime,
  db: BillingDb,
  input: { orgId: string; subscription: GatewaySubscription; eventId?: string },
): Promise<boolean> {
  const gateway = rt.gateway;
  const { orgId, subscription } = input;
  if (!gateway) return false;
  await lockOrgBilling(db, orgId);
  const [prev] = await db.select().from(billingSubscriptions).where(eq(billingSubscriptions.orgId, orgId));
  if (!prev || prev.gatewaySubscriptionId === subscription.id || prev.gateway !== gateway.kind) return false;
  if (!isLiveSubscriptionStatus(prev.status)) return false;
  // `incomplete` counts too: a second first payment that is still being tried must not stay open.
  if (subscription.status === 'canceled') return false;

  const current = await gateway.getSubscription(prev.gatewaySubscriptionId);
  if (!current || !isLiveSubscriptionStatus(current.status)) {
    if (current) {
      await applySubscriptionSnapshot(db, {
        orgId,
        gateway: gateway.kind,
        subscription: current,
        latestInvoice: null,
        now: rt.now(),
        portalUrl: rt.portalUrl,
        ...(input.eventId ? { eventId: input.eventId } : {}),
      });
    } else {
      // The gateway no longer knows the old plan at all. Close our row so the new one can take over.
      await db
        .update(billingSubscriptions)
        .set({ status: 'canceled', endedAt: rt.now(), canceledAt: rt.now(), updatedAt: rt.now() })
        .where(eq(billingSubscriptions.orgId, orgId));
    }
    return false;
  }

  const { refundedCents } = await gateway.cancelAndRefund(subscription.id);
  const invoice = subscription.latestInvoiceId ? await gateway.getInvoice(subscription.latestInvoiceId) : null;
  if (invoice) {
    await applyInvoiceSnapshot(db, { orgId, gateway: gateway.kind, invoice: withCardFallback(invoice, subscription) });
  }
  await recordAudit(db, {
    orgId,
    actor: SYSTEM_ACTOR,
    action: 'checkout.duplicate_refunded',
    summary:
      refundedCents > 0
        ? `A second payment of ${formatMoney(refundedCents)} came in for a plan you already have. We canceled it and sent the money back.`
        : 'A second checkout finished for a plan you already have. We canceled it. Nothing was charged for it.',
    data: { subscriptionId: subscription.id, keptSubscriptionId: prev.gatewaySubscriptionId, refundedCents },
    ...(input.eventId ? { eventId: input.eventId } : {}),
  });
  logBilling('warn', 'canceled and refunded a second subscription', {
    orgId,
    subscriptionId: subscription.id,
    kept: prev.gatewaySubscriptionId,
    refundedCents,
  });
  return true;
}

/**
 * Fetches one subscription and its latest invoice from the gateway and applies both. Returns null
 * when the gateway does not know the subscription, it belongs to another customer, or it was a second
 * subscription for an organization that already has a plan (then it was canceled and refunded).
 */
export async function fetchAndApplySubscription(
  rt: BillingRuntime,
  db: BillingDb,
  input: { orgId: string; subscriptionId: string; eventId?: string; actor?: BillingActor },
): Promise<GatewaySubscription | null> {
  if (!rt.gateway) return null;
  const subscription = await rt.gateway.getSubscription(input.subscriptionId);
  if (!subscription) return null;
  const customerId = await customerIdForOrg(db, input.orgId, rt.gateway.kind);
  const ownedByMetadata = subscription.orgId === input.orgId;
  const ownedByCustomer = customerId !== null && subscription.customerId === customerId;
  if (!ownedByCustomer && !(ownedByMetadata && customerId === null)) {
    logBilling('warn', 'subscription does not belong to the org', { orgId: input.orgId, subscriptionId: subscription.id });
    return null;
  }
  if (await rejectSecondSubscription(rt, db, { orgId: input.orgId, subscription, ...(input.eventId ? { eventId: input.eventId } : {}) })) {
    return null;
  }
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
    ...(input.actor ? { actor: input.actor } : {}),
  });
  return subscription;
}

/** A paid invoice with no card digits on it gets the digits of the card on the subscription. */
export function withCardFallback(invoice: GatewayInvoice, subscription: GatewaySubscription | null): GatewayInvoice {
  if (invoice.paymentMethodLast4 || !subscription?.paymentMethod) return invoice;
  return { ...invoice, paymentMethodLast4: subscription.paymentMethod.last4 };
}

/** Clears both per process caches for an org. Call after a committed write. */
export function clearBillingCaches(orgId: string): void {
  clearEntitlementsCache(orgId);
  clearPlanCache(orgId);
}

/** Fetches the org's subscription and latest invoice from the gateway and applies both. */
export async function refreshFromGateway(rt: BillingRuntime, orgId: string): Promise<BillingResult<PlanState>> {
  if (!rt.gateway) return billingError('billing_unavailable');
  const gateway = rt.gateway;
  const [row] = await rt.db
    .select({ id: billingSubscriptions.gatewaySubscriptionId, gateway: billingSubscriptions.gateway })
    .from(billingSubscriptions)
    .where(eq(billingSubscriptions.orgId, orgId));
  try {
    let subscriptionId = row && row.gateway === gateway.kind ? row.id : null;
    if (!subscriptionId) {
      const customerId = await customerIdForOrg(rt.db, orgId, gateway.kind);
      const found = customerId ? await gateway.findSubscriptionForCustomer(customerId) : null;
      subscriptionId = found?.id ?? null;
    }
    if (!subscriptionId) return billingError('no_subscription');
    const id = subscriptionId;
    const applied = await rt.db.transaction(async (tx) => fetchAndApplySubscription(rt, tx, { orgId, subscriptionId: id }));
    if (!applied) return billingError('no_subscription');
  } catch (error) {
    logBilling('error', 'refresh from gateway failed', { orgId, error: errorText(error) });
    return billingError('gateway_error');
  } finally {
    clearBillingCaches(orgId);
  }
  return billingOk(await getPlanState(rt, orgId));
}
