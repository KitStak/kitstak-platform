/**
 * Cancel and pause (docs/billing/CONTRACTS.md section 11.7, SPEC P11 and P12). Cancel runs to the end
 * of the paid period and can be undone with one click. Pause is for monthly plans: it starts at the
 * end of the paid period and the plan starts again by itself.
 */
import { eq } from 'drizzle-orm';
import {
  billingCancelFeedback,
  billingSubscriptions,
  BILLING_CANCEL_REASONS,
  organization,
  type BillingSubscription,
} from '@kitstak/db/schema';
import { CATALOG, formatDay } from '../catalog';
import { addMonths } from '../dates';
import { type BillingResult, billingError, billingOk } from '../errors';
import type { BillingGateway, GatewaySubscription } from '../gateway/types';
import { isLiveSubscriptionStatus, type PlanState } from '../plan-state';
import { recordAudit } from './audit';
import { type BillingActor, type BillingRuntime, errorText, logBilling } from './db';
import { enqueueForBillingRecipients } from './outbox';
import { getPlanState } from './state';
import { applySubscriptionSnapshot, clearBillingCaches } from './sync';

export type CancelReason = 'too_expensive' | 'missing_feature' | 'switching_tool' | 'not_using' | 'seasonal' | 'other';

const HOUR_MS = 60 * 60 * 1000;

function cleanReason(reason: unknown): CancelReason | null {
  return typeof reason === 'string' && (BILLING_CANCEL_REASONS as readonly string[]).includes(reason)
    ? (reason as CancelReason)
    : null;
}

function cleanDetail(detail: unknown): string | null {
  if (typeof detail !== 'string') return null;
  const trimmed = detail.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, 1000);
  return trimmed === '' ? null : trimmed;
}

async function liveRow(
  rt: BillingRuntime,
  orgId: string,
): Promise<{ ok: true; row: BillingSubscription; gateway: BillingGateway } | { ok: false; error: ReturnType<typeof billingError> }> {
  if (!rt.gateway) return { ok: false, error: billingError('billing_unavailable') };
  const [row] = await rt.db.select().from(billingSubscriptions).where(eq(billingSubscriptions.orgId, orgId));
  if (!row || !isLiveSubscriptionStatus(row.status) || row.gateway !== rt.gateway.kind) {
    return { ok: false, error: billingError('no_subscription') };
  }
  return { ok: true, row, gateway: rt.gateway };
}

async function orgName(rt: BillingRuntime, orgId: string): Promise<string> {
  const [org] = await rt.db.select({ name: organization.name }).from(organization).where(eq(organization.id, orgId));
  return org?.name ?? 'your organization';
}

async function apply(rt: BillingRuntime, orgId: string, subscription: GatewaySubscription, actor: BillingActor): Promise<void> {
  const gateway = rt.gateway;
  if (!gateway) return;
  const latestInvoice = subscription.latestInvoiceId ? await gateway.getInvoice(subscription.latestInvoiceId) : null;
  await rt.db.transaction(async (tx) =>
    applySubscriptionSnapshot(tx, {
      orgId,
      gateway: gateway.kind,
      subscription,
      latestInvoice,
      now: rt.now(),
      portalUrl: rt.portalUrl,
      actor,
    }),
  );
}

export async function scheduleCancel(
  rt: BillingRuntime,
  input: { orgId: string; reason: CancelReason | null; detail: string | null; actor: BillingActor },
): Promise<BillingResult<PlanState>> {
  const found = await liveRow(rt, input.orgId);
  if (!found.ok) return found.error;
  const { row, gateway } = found;
  try {
    const subscription = await gateway.setCancelAtPeriodEnd(row.gatewaySubscriptionId, true);
    await apply(rt, input.orgId, subscription, input.actor);
    const endsAt = subscription.cancelAt ?? subscription.currentPeriodEnd;
    await rt.db.insert(billingCancelFeedback).values({
      orgId: input.orgId,
      userId: input.actor.userId,
      reason: cleanReason(input.reason),
      detail: cleanDetail(input.detail),
      outcome: 'canceled',
    });
    await recordAudit(rt.db, {
      orgId: input.orgId,
      actor: input.actor,
      action: 'cancel.scheduled',
      summary: `${input.actor.label} canceled the plan. It ends on ${formatDay(endsAt)}.`,
      data: { endsAt: endsAt.toISOString(), reason: cleanReason(input.reason) },
    });
    await enqueueForBillingRecipients(rt.db, {
      orgId: input.orgId,
      template: 'cancel_scheduled',
      payload: { orgName: await orgName(rt, input.orgId), portalUrl: rt.portalUrl, endsAt: endsAt.toISOString() },
      dedupeKey: `cancel_scheduled:${subscription.id}:${endsAt.toISOString()}`,
    });
  } catch (error) {
    logBilling('error', 'schedule cancel failed', { orgId: input.orgId, error: errorText(error) });
    return billingError('gateway_error');
  } finally {
    clearBillingCaches(input.orgId);
  }
  return billingOk(await getPlanState(rt, input.orgId));
}

export async function undoCancel(
  rt: BillingRuntime,
  input: { orgId: string; actor: BillingActor },
): Promise<BillingResult<PlanState>> {
  const found = await liveRow(rt, input.orgId);
  if (!found.ok) return found.error;
  const { row, gateway } = found;
  if (!row.cancelAtPeriodEnd && !row.cancelAt) return billingOk(await getPlanState(rt, input.orgId));
  try {
    const subscription = await gateway.setCancelAtPeriodEnd(row.gatewaySubscriptionId, false);
    await apply(rt, input.orgId, subscription, input.actor);
    await rt.db.insert(billingCancelFeedback).values({
      orgId: input.orgId,
      userId: input.actor.userId,
      reason: null,
      detail: null,
      outcome: 'kept',
    });
    await recordAudit(rt.db, {
      orgId: input.orgId,
      actor: input.actor,
      action: 'cancel.undone',
      summary: `${input.actor.label} kept the plan. It will renew as usual.`,
    });
  } catch (error) {
    logBilling('error', 'undo cancel failed', { orgId: input.orgId, error: errorText(error) });
    return billingError('gateway_error');
  } finally {
    clearBillingCaches(input.orgId);
  }
  return billingOk(await getPlanState(rt, input.orgId));
}

/**
 * Monthly plans only. The pause starts at the current period end and the plan starts again `months`
 * calendar months after that, minus one hour, so the gateway resumes just before the renewal invoice.
 */
export async function pausePlan(
  rt: BillingRuntime,
  input: { orgId: string; months: 1 | 2 | 3; reason: CancelReason | null; actor: BillingActor },
): Promise<BillingResult<PlanState>> {
  const found = await liveRow(rt, input.orgId);
  if (!found.ok) return found.error;
  const { row, gateway } = found;
  if (row.interval !== 'monthly') return billingError('yearly_no_pause');
  if (!(CATALOG.pauseMonths as readonly number[]).includes(input.months)) {
    return billingError('invalid_input', 'Pick 1, 2 or 3 months.');
  }
  if (row.status !== 'active' || !row.currentPeriodEnd) {
    return billingError(
      'invalid_input',
      row.status === 'trialing'
        ? 'You can pause after your first payment. Until then you can cancel at no cost.'
        : 'Fix your payment first. Then you can pause your plan.',
    );
  }
  if (row.pauseResumesAt) return billingOk(await getPlanState(rt, input.orgId));

  const startsAt = row.currentPeriodEnd;
  const resumesAt = new Date(addMonths(startsAt, input.months).getTime() - HOUR_MS);
  try {
    // A pause replaces a cancel that was scheduled: the plan comes back by itself.
    if (row.cancelAtPeriodEnd || row.cancelAt) await gateway.setCancelAtPeriodEnd(row.gatewaySubscriptionId, false);
    const subscription = await gateway.pause(row.gatewaySubscriptionId, resumesAt);
    await apply(rt, input.orgId, subscription, input.actor);
    await rt.db.insert(billingCancelFeedback).values({
      orgId: input.orgId,
      userId: input.actor.userId,
      reason: cleanReason(input.reason),
      detail: null,
      outcome: 'paused',
    });
    await recordAudit(rt.db, {
      orgId: input.orgId,
      actor: input.actor,
      action: 'pause.scheduled',
      summary: `${input.actor.label} paused the plan from ${formatDay(startsAt)}. It starts again on ${formatDay(resumesAt)}.`,
      data: { startsAt: startsAt.toISOString(), resumesAt: resumesAt.toISOString(), months: input.months },
    });
    await enqueueForBillingRecipients(rt.db, {
      orgId: input.orgId,
      template: 'paused',
      payload: {
        orgName: await orgName(rt, input.orgId),
        portalUrl: rt.portalUrl,
        startsAt: startsAt.toISOString(),
        resumesAt: resumesAt.toISOString(),
      },
      dedupeKey: `paused:${subscription.id}:${startsAt.toISOString()}`,
    });
  } catch (error) {
    logBilling('error', 'pause plan failed', { orgId: input.orgId, error: errorText(error) });
    return billingError('gateway_error');
  } finally {
    clearBillingCaches(input.orgId);
  }
  return billingOk(await getPlanState(rt, input.orgId));
}

/** Before the pause starts: the plan simply renews as usual. During the pause: billing starts again today. */
export async function undoPause(
  rt: BillingRuntime,
  input: { orgId: string; actor: BillingActor },
): Promise<BillingResult<PlanState>> {
  const found = await liveRow(rt, input.orgId);
  if (!found.ok) return found.error;
  const { row, gateway } = found;
  if (!row.pauseResumesAt) return billingOk(await getPlanState(rt, input.orgId));
  const began = row.pauseStartsAt !== null && row.pauseStartsAt.getTime() <= rt.now().getTime();
  try {
    const subscription = await gateway.resume(row.gatewaySubscriptionId, { billNow: began });
    await apply(rt, input.orgId, subscription, input.actor);
    await recordAudit(rt.db, {
      orgId: input.orgId,
      actor: input.actor,
      action: 'pause.undone',
      summary: began
        ? `${input.actor.label} started the plan again.`
        : `${input.actor.label} took back the pause. The plan will renew as usual.`,
    });
  } catch (error) {
    logBilling('error', 'undo pause failed', { orgId: input.orgId, error: errorText(error) });
    return billingError('gateway_error');
  } finally {
    clearBillingCaches(input.orgId);
  }
  return billingOk(await getPlanState(rt, input.orgId));
}

/** The same action under the name the paused screen uses ("Start again now"). */
export const resumePlan = undoPause;
