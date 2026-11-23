/**
 * Card updates and paying a late bill (docs/billing/CONTRACTS.md section 11.7). The card form lives
 * on the gateway's page; the portal never sees a card number.
 */
import { eq } from 'drizzle-orm';
import { billingSubscriptions } from '@kitstak/db/schema';
import { formatMoney } from '../catalog';
import { type BillingResult, billingError, billingOk } from '../errors';
import { GatewayCardError } from '../gateway/types';
import { isLiveSubscriptionStatus, type PlanState } from '../plan-state';
import { recordAudit } from './audit';
import { type BillingActor, type BillingRuntime, errorText, logBilling } from './db';
import { getPlanState } from './state';
import { clearBillingCaches, customerIdForOrg, fetchAndApplySubscription } from './sync';

export async function createPaymentUpdateSession(
  rt: BillingRuntime,
  input: { orgId: string; actor: BillingActor },
): Promise<BillingResult<{ url: string }>> {
  if (!rt.gateway) return billingError('billing_unavailable');
  const customerId = await customerIdForOrg(rt.db, input.orgId, rt.gateway.kind);
  if (!customerId) return billingError('no_subscription');
  try {
    // The return URL is built here from the runtime, never from input.
    const session = await rt.gateway.createPaymentUpdateSession({
      customerId,
      returnUrl: `${rt.portalUrl}/billing?updated=card`,
    });
    return billingOk({ url: session.url });
  } catch (error) {
    logBilling('error', 'card update session failed', { orgId: input.orgId, error: errorText(error) });
    return billingError('gateway_error');
  }
}

/** Pays the open invoice now with the card on file. Used after a card update and by the "Pay now" button. */
export async function retryPayment(
  rt: BillingRuntime,
  input: { orgId: string; actor: BillingActor },
): Promise<BillingResult<PlanState>> {
  if (!rt.gateway) return billingError('billing_unavailable');
  const gateway = rt.gateway;
  const [row] = await rt.db.select().from(billingSubscriptions).where(eq(billingSubscriptions.orgId, input.orgId));
  if (!row || !isLiveSubscriptionStatus(row.status) || row.gateway !== gateway.kind) {
    return billingError('no_subscription');
  }
  // Nothing is late: there is nothing to pay.
  if (row.status !== 'past_due' && row.status !== 'unpaid') return billingOk(await getPlanState(rt, input.orgId));

  let declined = false;
  try {
    const invoice = await gateway.payLatestInvoice(row.gatewaySubscriptionId);
    if (invoice.status === 'paid') {
      await recordAudit(rt.db, {
        orgId: input.orgId,
        actor: input.actor,
        action: 'payment.retried',
        summary: `${input.actor.label} paid the open bill of ${formatMoney(invoice.amountPaidCents)}.`,
        data: { invoiceId: invoice.id, amountPaidCents: invoice.amountPaidCents },
      });
    }
  } catch (error) {
    if (!(error instanceof GatewayCardError)) {
      logBilling('error', 'retry payment failed', { orgId: input.orgId, error: errorText(error) });
      return billingError('gateway_error');
    }
    declined = true;
  }

  try {
    await rt.db.transaction(async (tx) =>
      fetchAndApplySubscription(rt, tx, { orgId: input.orgId, subscriptionId: row.gatewaySubscriptionId, actor: input.actor }),
    );
  } catch (error) {
    logBilling('error', 'refresh after payment failed', { orgId: input.orgId, error: errorText(error) });
  } finally {
    clearBillingCaches(input.orgId);
  }
  if (declined) return billingError('card_declined');
  return billingOk(await getPlanState(rt, input.orgId));
}
