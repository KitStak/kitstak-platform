/**
 * The free trial (docs/billing/CONTRACTS.md section 11.4, SPEC P4): 14 days, no card, no gateway
 * object. The trial is entitlement rows with a real end date, so access ends by itself when the date
 * passes. One trial per organization and one per person who starts it.
 */
import { and, eq, isNull, ne } from 'drizzle-orm';
import { billingAccounts, billingSubscriptions, billingTrialUses, entitlements, organization, user } from '@kitstak/db/schema';
import { type EntitlementsDb, clearEntitlementsCache, setEntitlement } from '@kitstak/entitlements';
import { CATALOG, normalizeSelection, type PlanSelection, productListLabel, type Stack, toStack } from '../catalog';
import { type BillingResult, billingError, billingOk } from '../errors';
import type { PlanState } from '../plan-state';
import { recordAudit } from './audit';
import type { BillingActor, BillingReadDb, BillingRuntime } from './db';
import { enqueueEmail } from './outbox';
import { clearPlanCache, getPlanState } from './state';

const HOUR_MS = 60 * 60 * 1000;

export async function canStartTrial(
  db: BillingReadDb,
  input: { orgId: string; userId: string },
): Promise<{ ok: true } | { ok: false; reason: 'org_had_trial' | 'user_had_trial' | 'has_plan' }> {
  const [subscription] = await db
    .select({ status: billingSubscriptions.status })
    .from(billingSubscriptions)
    .where(eq(billingSubscriptions.orgId, input.orgId));
  if (subscription) return { ok: false, reason: 'has_plan' };

  const [account] = await db
    .select({ trialStartedAt: billingAccounts.trialStartedAt })
    .from(billingAccounts)
    .where(eq(billingAccounts.orgId, input.orgId));
  if (account?.trialStartedAt) return { ok: false, reason: 'org_had_trial' };
  const [trialRow] = await db
    .select({ module: entitlements.module })
    .from(entitlements)
    .where(and(eq(entitlements.orgId, input.orgId), eq(entitlements.source, 'trial')))
    .limit(1);
  if (trialRow) return { ok: false, reason: 'org_had_trial' };

  // One free trial per person. `billing_trial_uses` outlives a deleted organization.
  const uses = await db
    .select({ orgId: billingTrialUses.orgId })
    .from(billingTrialUses)
    .where(and(eq(billingTrialUses.userId, input.userId), ne(billingTrialUses.orgId, input.orgId)));
  const started = await db
    .select({ orgId: billingAccounts.orgId })
    .from(billingAccounts)
    .where(and(eq(billingAccounts.trialStartedBy, input.userId), ne(billingAccounts.orgId, input.orgId)));
  const otherOrgs = new Set([...uses.map((row) => row.orgId), ...started.map((row) => row.orgId)]);
  if (otherOrgs.size >= CATALOG.trialsPerUser) return { ok: false, reason: 'user_had_trial' };
  return { ok: true };
}

function seatsFor(product: Stack[number], selection: PlanSelection): number | null {
  const pricing = CATALOG.products[product];
  if (pricing.quantityFrom === 'seats') return selection.seats;
  return pricing.includedSeats;
}

/**
 * Starts the free trial in one transaction: the account row with the dates, one `trialing` row per
 * app (manual grants are skipped), the audit row and the welcome email. Works in every mode,
 * including `unavailable`: a trial needs no gateway.
 */
export async function startTrial(
  rt: BillingRuntime,
  input: { orgId: string; selection: PlanSelection; actor: BillingActor },
): Promise<BillingResult<PlanState>> {
  const selection = normalizeSelection(input.selection);
  if (selection.products.length === 0) return billingError('invalid_selection');
  if (!input.actor.userId) return billingError('forbidden');
  const userId = input.actor.userId;

  const allowed = await canStartTrial(rt.db, { orgId: input.orgId, userId });
  if (!allowed.ok) {
    return allowed.reason === 'has_plan' ? billingError('already_subscribed') : billingError('trial_used');
  }

  const now = rt.now();
  const endsAt = new Date(now.getTime() + CATALOG.trialDays * 24 * HOUR_MS);
  const cart = { ...selection, products: [...selection.products] } as Record<string, unknown>;

  const started = await rt.db.transaction(async (tx) => {
    // The guard is in the write itself, so two clicks at once start one trial.
    const claimed = await tx
      .insert(billingAccounts)
      .values({ orgId: input.orgId, cart, trialStartedAt: now, trialEndsAt: endsAt, trialStartedBy: userId })
      .onConflictDoUpdate({
        target: billingAccounts.orgId,
        set: { cart, trialStartedAt: now, trialEndsAt: endsAt, trialStartedBy: userId, updatedAt: now },
        setWhere: isNull(billingAccounts.trialStartedAt),
      })
      .returning({ orgId: billingAccounts.orgId });
    if (claimed.length === 0) return false;

    await tx.insert(billingTrialUses).values({ userId, orgId: input.orgId, startedAt: now }).onConflictDoNothing();

    for (const product of selection.products) {
      await setEntitlement(tx as unknown as EntitlementsDb, {
        orgId: input.orgId,
        module: product,
        status: 'trialing',
        source: 'trial',
        periodEnd: endsAt,
        seats: seatsFor(product, selection),
        stripeSubscriptionId: null,
        stripePriceId: null,
      });
    }

    await recordAudit(tx, {
      orgId: input.orgId,
      actor: input.actor,
      action: 'trial.started',
      summary: `${input.actor.label} started a free trial for ${productListLabel(selection.products)}.`,
      data: { selection, trialEndsAt: endsAt.toISOString() },
    });

    const [person] = await tx.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, userId));
    const [org] = await tx.select({ name: organization.name }).from(organization).where(eq(organization.id, input.orgId));
    if (person?.email) {
      await enqueueEmail(tx, {
        orgId: input.orgId,
        to: person.email,
        template: 'welcome',
        payload: {
          orgName: org?.name ?? 'your organization',
          portalUrl: rt.portalUrl,
          firstName: person.name.trim().split(/\s+/)[0] ?? person.name,
          products: selection.products,
          trialEndsAt: endsAt.toISOString(),
        },
        dedupeKey: `welcome:${input.orgId}`,
      });
    }
    return true;
  });

  clearEntitlementsCache(input.orgId);
  clearPlanCache(input.orgId);
  if (!started) return billingError('trial_used');
  return billingOk(await getPlanState(rt, input.orgId));
}

/**
 * During a trial: add or remove apps. Added apps share the same end date. A removed app becomes view
 * only, so anything made in it can still be read, and it can be added back at any time.
 */
export async function changeTrialProducts(
  rt: BillingRuntime,
  input: { orgId: string; products: Stack; actor: BillingActor },
): Promise<BillingResult<PlanState>> {
  const products = toStack(input.products);
  if (products.length === 0) return billingError('invalid_selection');

  const before = await getPlanState(rt, input.orgId);
  if (before.phase !== 'trial' || !before.trial) {
    return billingError('invalid_input', 'Your free trial is not running. Pick a plan to change your apps.');
  }
  const endsAt = before.trial.endsAt;
  const now = rt.now();
  const selection: PlanSelection = { ...before.selection, products };
  const cart = { ...selection, products: [...products] } as Record<string, unknown>;
  const current = Object.values(before.modules)
    .filter((plan) => plan.inPlan)
    .map((plan) => plan.product);
  const removed = current.filter((product) => !products.includes(product));

  await rt.db.transaction(async (tx) => {
    const writer = tx as unknown as EntitlementsDb;
    for (const product of products) {
      await setEntitlement(writer, {
        orgId: input.orgId,
        module: product,
        status: 'trialing',
        source: 'trial',
        periodEnd: endsAt,
        seats: seatsFor(product, selection),
        stripeSubscriptionId: null,
        stripePriceId: null,
      });
    }
    for (const product of removed) {
      await setEntitlement(writer, {
        orgId: input.orgId,
        module: product,
        status: 'canceled',
        source: 'trial',
        periodEnd: now,
        seats: null,
        stripeSubscriptionId: null,
        stripePriceId: null,
      });
    }
    await tx
      .update(billingAccounts)
      .set({ cart, updatedAt: now })
      .where(eq(billingAccounts.orgId, input.orgId));
    await recordAudit(tx, {
      orgId: input.orgId,
      actor: input.actor,
      action: 'trial.products_changed',
      summary: `${input.actor.label} changed the trial apps to ${productListLabel(products)}.`,
      data: { products, removed },
    });
  });

  clearEntitlementsCache(input.orgId);
  clearPlanCache(input.orgId);
  return billingOk(await getPlanState(rt, input.orgId));
}
