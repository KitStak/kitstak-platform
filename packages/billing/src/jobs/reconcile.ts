/**
 * The safety net under the webhooks (docs/billing/CONTRACTS.md section 14). Webhooks are the main
 * path. This job asks the gateway again about plans that are in a state where a missed event would
 * hurt: a late payment, a first payment that never finished, or a cancel, pause or renewal date
 * that has passed while our copy still says otherwise.
 *
 * It only reads from the gateway and applies the answer with the same snapshot code the webhooks
 * use. It never charges anything.
 */
import { and, asc, eq, lt, or, sql } from 'drizzle-orm';
import { billingSubscriptions } from '@kitstak/db/schema';
import { errorText, logBilling, type BillingRuntime } from '../server/db';
import { refreshFromGateway } from '../server/sync';

const HOUR_MS = 60 * 60 * 1000;

export async function reconcileSubscriptions(rt: BillingRuntime, options?: { limit?: number }): Promise<number> {
  if (!rt.gateway) return 0;
  const limit = Math.min(Math.max(Math.round(options?.limit ?? 20), 1), 100);
  const now = rt.now();
  const nowIso = now.toISOString();
  const stale = new Date(now.getTime() - HOUR_MS);

  const due = await rt.db
    .select({ orgId: billingSubscriptions.orgId })
    .from(billingSubscriptions)
    .where(
      and(
        eq(billingSubscriptions.gateway, rt.gateway.kind),
        lt(billingSubscriptions.gatewaySyncedAt, stale),
        or(
          eq(billingSubscriptions.status, 'past_due'),
          eq(billingSubscriptions.status, 'incomplete'),
          // A date has passed and our copy has not caught up with it yet.
          sql`(${billingSubscriptions.status} <> 'canceled' AND (
                 ${billingSubscriptions.cancelAt} <= ${nowIso}::timestamptz
              OR (${billingSubscriptions.cancelAtPeriodEnd} AND ${billingSubscriptions.currentPeriodEnd} <= ${nowIso}::timestamptz)
              OR ${billingSubscriptions.pauseStartsAt} <= ${nowIso}::timestamptz
              OR ${billingSubscriptions.pauseResumesAt} <= ${nowIso}::timestamptz
              OR ${billingSubscriptions.currentPeriodEnd} <= ${nowIso}::timestamptz
              OR ${billingSubscriptions.trialEnd} <= ${nowIso}::timestamptz AND ${billingSubscriptions.status} = 'trialing'))`,
        ),
      ),
    )
    .orderBy(asc(billingSubscriptions.gatewaySyncedAt))
    .limit(limit);

  let reconciled = 0;
  for (const { orgId } of due) {
    let ok = false;
    try {
      const result = await refreshFromGateway(rt, orgId);
      ok = result.ok;
      if (!result.ok) logBilling('warn', 'reconcile could not refresh a plan', { orgId, code: result.error.code });
    } catch (error) {
      logBilling('error', 'reconcile failed for one organization', { orgId, error: errorText(error) });
    }
    if (ok) {
      reconciled += 1;
    } else {
      // Look again in an hour, not every minute. One broken plan must not crowd out the others.
      await rt.db
        .update(billingSubscriptions)
        .set({ gatewaySyncedAt: now })
        .where(eq(billingSubscriptions.orgId, orgId))
        .catch(() => undefined);
    }
  }
  return reconciled;
}
