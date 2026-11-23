/**
 * The one door for gateway events (docs/billing/CONTRACTS.md section 12.2). The Stripe route and the
 * test gateway both call `processWebhook`.
 *
 *  1. Verify the signature on the raw body. A bad one answers 400 and writes nothing at all.
 *  2. An event id already processed or ignored answers 200 `duplicate`. Nothing else is touched.
 *  3. Find the org. None: record the event as `ignored`.
 *  4. In one transaction: the ledger row, then the handler. The handler never trusts the event body
 *     for state. It fetches the current object from the gateway and applies that snapshot.
 *  5. If the handler throws: roll back, record the event as `failed`, answer 500 so the gateway retries.
 *  6. After commit: clear the entitlement and plan caches for the org.
 */
import { eq, sql } from 'drizzle-orm';
import { billingEvents, billingSubscriptions, organization, stripeCustomers } from '@kitstak/db/schema';
import { CATALOG, formatMoney } from '../catalog';
import { type GatewayEvent, type GatewayInvoice, WebhookSignatureError } from '../gateway/types';
import { isLiveSubscriptionStatus } from '../plan-state';
import { recordAudit } from './audit';
import { applyCheckoutSession } from './checkout';
import { type BillingDb, type BillingRuntime, errorText, isUuid, logBilling, SYSTEM_ACTOR } from './db';
import { enqueueForBillingRecipients } from './outbox';
import { applyInvoiceSnapshot, clearBillingCaches, customerIdForOrg, fetchAndApplySubscription, withCardFallback } from './sync';

export type WebhookOutcome =
  | { readonly status: 400; readonly result: 'bad_signature' }
  | { readonly status: 200; readonly result: 'processed' | 'duplicate' | 'ignored'; readonly eventId: string }
  | { readonly status: 500; readonly result: 'failed'; readonly eventId: string };

const DAY_MS = 24 * 60 * 60 * 1000;

type Handled = 'processed' | 'ignored';

function cardWords(brand: string | null | undefined, last4: string | null | undefined): string {
  if (!last4) return 'card';
  const name = brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : 'card';
  return `${name} ending ${last4}`;
}

async function orgNameOf(db: BillingDb, orgId: string): Promise<string> {
  const [org] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, orgId));
  return org?.name ?? 'your organization';
}

/** Finds the org an event is about: the id on the object, else the customer we stored. */
async function findOrg(rt: BillingRuntime, event: GatewayEvent): Promise<string | null> {
  let fromCustomer: string | null = null;
  if (event.customerId) {
    const [row] = await rt.db
      .select({ orgId: stripeCustomers.orgId })
      .from(stripeCustomers)
      .where(eq(stripeCustomers.stripeCustomerId, event.customerId));
    fromCustomer = row?.orgId ?? null;
  }
  let fromEvent: string | null = null;
  if (isUuid(event.orgId)) {
    const [org] = await rt.db.select({ id: organization.id }).from(organization).where(eq(organization.id, event.orgId));
    fromEvent = org?.id ?? null;
  }
  if (fromEvent && fromCustomer && fromEvent !== fromCustomer) {
    logBilling('warn', 'event names one org and its customer belongs to another', { eventId: event.id });
    return null;
  }
  return fromEvent ?? fromCustomer;
}

/** Fetches the invoice of an event and checks that it belongs to the org. */
async function fetchInvoice(rt: BillingRuntime, db: BillingDb, orgId: string, event: GatewayEvent): Promise<GatewayInvoice | null> {
  if (!rt.gateway || !event.invoiceId) return null;
  const invoice = await rt.gateway.getInvoice(event.invoiceId);
  if (!invoice) return null;
  const customerId = await customerIdForOrg(db, orgId, rt.gateway.kind);
  const owned = customerId !== null ? invoice.customerId === customerId : event.orgId === orgId;
  if (!owned) {
    logBilling('warn', 'invoice does not belong to the org', { orgId, invoiceId: invoice.id });
    return null;
  }
  return invoice;
}

async function handleEvent(rt: BillingRuntime, db: BillingDb, orgId: string, event: GatewayEvent): Promise<Handled> {
  const gateway = rt.gateway;
  if (!gateway) return 'ignored';

  switch (event.type) {
    case 'checkout.session.completed': {
      if (!event.checkoutSessionId) return 'ignored';
      const outcome = await applyCheckoutSession(rt, db, { orgId, sessionId: event.checkoutSessionId, eventId: event.id });
      return outcome === 'not_found' ? 'ignored' : 'processed';
    }

    case 'checkout.session.expired': {
      const [row] = await db
        .select({ status: billingSubscriptions.status })
        .from(billingSubscriptions)
        .where(eq(billingSubscriptions.orgId, orgId));
      if (!row || !isLiveSubscriptionStatus(row.status)) {
        await recordAudit(db, {
          orgId,
          actor: SYSTEM_ACTOR,
          action: 'checkout.expired',
          summary: 'A checkout page closed before it was finished. No charge was made.',
          eventId: event.id,
        });
      }
      return 'processed';
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed': {
      if (!event.subscriptionId) return 'ignored';
      const applied = await fetchAndApplySubscription(rt, db, { orgId, subscriptionId: event.subscriptionId, eventId: event.id });
      return applied ? 'processed' : 'ignored';
    }

    case 'invoice.finalized':
    case 'invoice.voided':
    case 'invoice.marked_uncollectible': {
      const invoice = await fetchInvoice(rt, db, orgId, event);
      if (!invoice) return 'ignored';
      await applyInvoiceSnapshot(db, { orgId, gateway: gateway.kind, invoice });
      return 'processed';
    }

    case 'invoice.paid': {
      const invoice = await fetchInvoice(rt, db, orgId, event);
      if (!invoice) return 'ignored';
      const subscription = invoice.subscriptionId
        ? await fetchAndApplySubscription(rt, db, { orgId, subscriptionId: invoice.subscriptionId, eventId: event.id })
        : null;
      const stored = withCardFallback(invoice, subscription);
      await applyInvoiceSnapshot(db, { orgId, gateway: gateway.kind, invoice: stored });
      if (invoice.amountPaidCents > 0) {
        await recordAudit(db, {
          orgId,
          actor: SYSTEM_ACTOR,
          action: 'payment.succeeded',
          summary: `Payment of ${formatMoney(invoice.amountPaidCents)} succeeded.`,
          data: { invoiceId: invoice.id, amountPaidCents: invoice.amountPaidCents },
          eventId: event.id,
        });
        const renews =
          subscription &&
          isLiveSubscriptionStatus(subscription.status) &&
          !subscription.cancelAtPeriodEnd &&
          !subscription.cancelAt &&
          !subscription.pauseResumesAt;
        await enqueueForBillingRecipients(db, {
          orgId,
          template: 'receipt',
          payload: {
            orgName: await orgNameOf(db, orgId),
            portalUrl: rt.portalUrl,
            invoiceId: invoice.id,
            invoiceNumber: invoice.number,
            amountPaidCents: invoice.amountPaidCents,
            taxCents: invoice.taxCents,
            paidAt: (invoice.paidAt ?? rt.now()).toISOString(),
            last4: stored.paymentMethodLast4,
            lines: invoice.lines.map((line) => ({ description: line.description, amountCents: line.amountCents })),
            nextChargeAt: renews && subscription ? subscription.currentPeriodEnd.toISOString() : null,
          },
          dedupeKey: `receipt:${invoice.id}`,
        });
      }
      return 'processed';
    }

    case 'invoice.payment_failed': {
      const invoice = await fetchInvoice(rt, db, orgId, event);
      if (!invoice) return 'ignored';
      const subscription = invoice.subscriptionId
        ? await fetchAndApplySubscription(rt, db, { orgId, subscriptionId: invoice.subscriptionId, eventId: event.id })
        : null;
      const stored = withCardFallback(invoice, subscription);
      await applyInvoiceSnapshot(db, { orgId, gateway: gateway.kind, invoice: stored });
      await recordAudit(db, {
        orgId,
        actor: SYSTEM_ACTOR,
        action: 'payment.failed',
        summary: `We could not charge the ${cardWords(subscription?.paymentMethod?.brand, stored.paymentMethodLast4)} for ${formatMoney(invoice.amountDueCents)}.`,
        data: { invoiceId: invoice.id, amountDueCents: invoice.amountDueCents, attempt: invoice.attemptCount },
        eventId: event.id,
      });
      // The email is for a plan that is late. A first payment that fails on the pay page is shown there.
      if (subscription && (subscription.status === 'past_due' || subscription.status === 'unpaid')) {
        const [row] = await db
          .select({ pastDueSince: billingSubscriptions.pastDueSince })
          .from(billingSubscriptions)
          .where(eq(billingSubscriptions.orgId, orgId));
        const since = row?.pastDueSince ?? invoice.issuedAt;
        await enqueueForBillingRecipients(db, {
          orgId,
          template: 'payment_failed',
          payload: {
            orgName: await orgNameOf(db, orgId),
            portalUrl: rt.portalUrl,
            amountDueCents: invoice.amountDueCents,
            last4: stored.paymentMethodLast4,
            nextRetryAt: invoice.nextPaymentAttempt ? invoice.nextPaymentAttempt.toISOString() : null,
            accessChangesAt: new Date(since.getTime() + CATALOG.graceDays * DAY_MS).toISOString(),
            attempt: invoice.attemptCount,
          },
          dedupeKey: `payment_failed:${invoice.id}:${invoice.attemptCount}`,
        });
      }
      return 'processed';
    }

    case 'invoice.payment_action_required': {
      const invoice = await fetchInvoice(rt, db, orgId, event);
      if (!invoice) return 'ignored';
      await applyInvoiceSnapshot(db, { orgId, gateway: gateway.kind, invoice });
      await enqueueForBillingRecipients(db, {
        orgId,
        template: 'payment_action_required',
        payload: {
          orgName: await orgNameOf(db, orgId),
          portalUrl: rt.portalUrl,
          amountDueCents: invoice.amountDueCents,
          last4: invoice.paymentMethodLast4,
        },
        dedupeKey: `payment_action:${invoice.id}`,
      });
      return 'processed';
    }

    case 'customer.updated':
    case 'payment_method.attached': {
      const [row] = await db
        .select({
          id: billingSubscriptions.gatewaySubscriptionId,
          gateway: billingSubscriptions.gateway,
          last4: billingSubscriptions.pmLast4,
        })
        .from(billingSubscriptions)
        .where(eq(billingSubscriptions.orgId, orgId));
      if (!row || row.gateway !== gateway.kind) return 'processed';
      const subscription = await fetchAndApplySubscription(rt, db, { orgId, subscriptionId: row.id, eventId: event.id });
      const method = subscription?.paymentMethod ?? null;
      if (method && method.last4 !== row.last4) {
        await recordAudit(db, {
          orgId,
          actor: SYSTEM_ACTOR,
          action: 'card.updated',
          summary: `The card on file is now ${cardWords(method.brand, method.last4)}.`,
          data: { last4: method.last4, brand: method.brand },
          eventId: event.id,
        });
      }
      return 'processed';
    }

    default:
      return 'ignored';
  }
}

export async function processWebhook(
  rt: BillingRuntime,
  input: { rawBody: string; signature: string | null },
): Promise<WebhookOutcome> {
  const gateway = rt.gateway;
  if (!gateway) return { status: 400, result: 'bad_signature' };

  // 1. Signature first. Nothing is read or written for an event that is not verified.
  let event: GatewayEvent;
  try {
    event = gateway.verifyWebhook(input.rawBody, input.signature);
  } catch (error) {
    if (!(error instanceof WebhookSignatureError)) {
      logBilling('warn', 'webhook could not be verified', { error: errorText(error, 200) });
    }
    return { status: 400, result: 'bad_signature' };
  }

  // 2. Idempotency.
  const [seen] = await rt.db.select({ status: billingEvents.status }).from(billingEvents).where(eq(billingEvents.id, event.id));
  if (seen && seen.status !== 'failed') return { status: 200, result: 'duplicate', eventId: event.id };

  const now = rt.now();
  const base = { id: event.id, type: event.type, payload: event.payload, gateway: gateway.kind, receivedAt: now, processedAt: now };

  // 3. The org.
  const orgId = await findOrg(rt, event);
  if (!orgId) {
    await rt.db
      .insert(billingEvents)
      .values({ ...base, orgId: null, status: 'ignored' })
      .onConflictDoUpdate({
        target: billingEvents.id,
        set: { status: 'ignored', error: null, processedAt: now },
        setWhere: eq(billingEvents.status, 'failed'),
      });
    return { status: 200, result: 'ignored', eventId: event.id };
  }

  // 4. The ledger row and the state change commit together.
  try {
    const outcome = await rt.db.transaction(async (tx): Promise<Handled | 'duplicate'> => {
      const claimed = await tx
        .insert(billingEvents)
        .values({ ...base, orgId, status: 'processed' })
        .onConflictDoUpdate({
          target: billingEvents.id,
          set: {
            status: 'processed',
            error: null,
            orgId,
            processedAt: now,
            attempts: sql`${billingEvents.attempts} + 1`,
          },
          setWhere: eq(billingEvents.status, 'failed'),
        })
        .returning({ id: billingEvents.id });
      // Another delivery of the same event finished first.
      if (claimed.length === 0) return 'duplicate';
      const handled = await handleEvent(rt, tx, orgId, event);
      if (handled === 'ignored') {
        await tx.update(billingEvents).set({ status: 'ignored' }).where(eq(billingEvents.id, event.id));
      }
      return handled;
    });
    // 6. After commit.
    clearBillingCaches(orgId);
    return { status: 200, result: outcome, eventId: event.id };
  } catch (error) {
    // 5. Rolled back. Record the failure so the retry is counted, and ask the gateway to try again.
    const text = errorText(error);
    logBilling('error', 'webhook handler failed', { eventId: event.id, type: event.type, orgId, error: text });
    try {
      await rt.db
        .insert(billingEvents)
        .values({ ...base, orgId, status: 'failed', error: text })
        .onConflictDoUpdate({
          target: billingEvents.id,
          set: { status: 'failed', error: text, attempts: sql`${billingEvents.attempts} + 1` },
          setWhere: eq(billingEvents.status, 'failed'),
        });
    } catch (ledgerError) {
      logBilling('error', 'could not record the failed event', { eventId: event.id, error: errorText(ledgerError) });
    }
    clearBillingCaches(orgId);
    return { status: 500, result: 'failed', eventId: event.id };
  }
}
