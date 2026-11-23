/**
 * Changing a paid plan (docs/billing/CONTRACTS.md section 11.6, SPEC P9). One rule for every change:
 * it starts right away, an increase is charged now for the time left, a decrease becomes credit on
 * the next bill. The person always sees the amount first, and the change is confirmed only if a
 * fresh preview still shows that amount.
 */
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
import { type BillingResult, billingError, billingOk } from '../errors';
import { type ChangePreview, GatewayCardError } from '../gateway/types';
import { isLiveSubscriptionStatus, type PlanState } from '../plan-state';
import { quote } from '../quote';
import { recordAudit } from './audit';
import { writeCart } from './cart';
import { belowUsageMessage } from './checkout';
import { type BillingActor, type BillingRuntime, errorText, logBilling } from './db';
import { enforceRateLimit } from './rate-limit';
import { getPlanState } from './state';
import { applyInvoiceSnapshot, applySubscriptionSnapshot, clearBillingCaches, withCardFallback } from './sync';

const HOUR_MS = 60 * 60 * 1000;

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

/** The preview for the same plan: nothing to pay, nothing changes. */
function emptyPreview(row: BillingSubscription, now: Date): ChangePreview {
  return {
    dueTodayCents: 0,
    creditCents: 0,
    newRecurringCents: row.recurringCents,
    recurringDeltaCents: 0,
    nextChargeAt: row.trialEnd && row.status === 'trialing' ? row.trialEnd : (row.currentPeriodEnd ?? now),
    prorationDate: now,
    lines: [],
    taxCents: 0,
  };
}

/** Whole seconds: gateways keep proration dates to the second, so the preview and the change match. */
function toWholeSecond(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

export async function previewPlanChange(
  rt: BillingRuntime,
  input: { orgId: string; selection: PlanSelection },
): Promise<BillingResult<ChangePreview>> {
  const prepared = await prepare(rt, input);
  if (!prepared.ok) return prepared.error;
  const { row, state, selection } = prepared.ready;
  const prorationDate = toWholeSecond(rt.now());
  if (sameSelection(state.selection, selection)) return billingOk(emptyPreview(row, prorationDate));
  try {
    const preview = await rt.gateway!.previewChange({
      subscriptionId: row.gatewaySubscriptionId,
      selection,
      prorationDate,
    });
    return billingOk(preview);
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

export async function applyPlanChange(
  rt: BillingRuntime,
  input: {
    orgId: string;
    selection: PlanSelection;
    prorationDate: Date;
    expectedDueTodayCents: number;
    actor: BillingActor;
  },
): Promise<BillingResult<PlanState>> {
  const prepared = await prepare(rt, input);
  if (!prepared.ok) return prepared.error;
  const { row, state, selection } = prepared.ready;
  const gateway = rt.gateway!;
  if (sameSelection(state.selection, selection)) return billingOk(state);

  const now = rt.now();
  const prorationDate = toWholeSecond(input.prorationDate);
  // A preview that is old, or dated in the future, is not a promise any more. Ask again.
  if (
    !Number.isFinite(prorationDate.getTime()) ||
    prorationDate.getTime() > now.getTime() + 60_000 ||
    prorationDate.getTime() < now.getTime() - HOUR_MS
  ) {
    return billingError('price_changed');
  }

  const allowed = await enforceRateLimit(rt.db, { key: `plan-change:${input.orgId}`, windowSeconds: 3600, max: 20 });
  if (!allowed) return billingError('rate_limited');

  try {
    const fresh = await gateway.previewChange({ subscriptionId: row.gatewaySubscriptionId, selection, prorationDate });
    const tolerance = Math.max(1, fresh.lines.length);
    if (Math.abs(fresh.dueTodayCents - Math.round(input.expectedDueTodayCents)) > tolerance) {
      return billingError('price_changed');
    }

    const subscription = await gateway.applyChange({ subscriptionId: row.gatewaySubscriptionId, selection, prorationDate });
    const latestInvoice = subscription.latestInvoiceId ? await gateway.getInvoice(subscription.latestInvoiceId) : null;
    await rt.db.transaction(async (tx) => {
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
        summary: describePlanChange(input.actor.label, state.selection, selection),
        data: {
          before: state.selection,
          after: selection,
          dueTodayCents: fresh.dueTodayCents,
          creditCents: fresh.creditCents,
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
