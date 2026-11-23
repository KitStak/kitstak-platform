'use server';
/**
 * Every billing mutation in the portal (docs/billing/CONTRACTS.md section 16.4). Each action:
 *   1. reads the session's own active organization (never an id from the browser),
 *   2. checks the role rule on the server,
 *   3. parses input with zod and clamps selections with `normalizeSelection`,
 *   4. calls the package function, which prices everything from the catalog and the gateway,
 *   5. revalidates the billing pages and the launcher, and returns a `BillingResult`.
 * No action takes a price or an amount it will charge. `expectedDueTodayCents` is only compared
 * with a fresh preview, so a stale screen can never confirm an amount the person did not see.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { normalizeSelection, toStack, type PlanSelection } from '@kitstak/billing/catalog';
import { billingError, billingOk, type BillingResult } from '@kitstak/billing/errors';
import type { PlanState } from '@kitstak/billing/plan-state';
import {
  applyTestPromo,
  completeTestCardUpdate,
  completeTestCheckout,
  cancelTestCheckout,
  getTestCardUpdate,
  getTestCheckout,
  testFailNextPayment,
  testRunDue,
  testShiftTime,
} from '@kitstak/billing/gateway/test';
import {
  addBillingManager,
  applyPlanChange,
  changeTrialProducts,
  createCheckout,
  createPaymentUpdateSession,
  getOpenSignupIntent,
  getPlanState,
  pausePlan,
  previewPlanChange,
  removeBillingManager,
  retryPayment,
  saveCart,
  scheduleCancel,
  startTrial,
  undoCancel,
  undoPause,
  updateBillingProfile,
  upsertSignupIntent,
  writeCart,
  type BillingProfile,
  type CancelReason,
  type ChangePreview,
} from '@kitstak/billing/server';
import { getBillingContext, type BillingContext } from '@/server/billing/context';
import { billingRuntime } from '@/server/billing/runtime';
import { isActiveOrgMember } from '@/server/orgs';
import { getSession } from '@/server/session';

type Need = 'view' | 'manage' | 'trial' | 'assign';
type Failure = ReturnType<typeof billingError>;

async function contextFor(need: Need): Promise<{ ok: true; ctx: BillingContext } | { ok: false; error: Failure }> {
  const ctx = await getBillingContext();
  if (!ctx) {
    const session = await getSession();
    return { ok: false, error: billingError(session ? 'no_org' : 'not_signed_in') };
  }
  const allowed =
    need === 'view'
      ? ctx.access.canView
      : need === 'manage'
        ? ctx.access.canManage
        : need === 'trial'
          ? ctx.access.canStartTrial
          : ctx.access.canAssignManagers;
  if (!allowed) {
    const message =
      need === 'assign'
        ? 'Only an owner can add or remove a billing manager.'
        : need === 'trial'
          ? 'Only an owner, an admin or a billing manager can do this.'
          : undefined;
    return { ok: false, error: billingError('forbidden', message) };
  }
  return { ok: true, ctx };
}

function revalidateBilling(): void {
  revalidatePath('/billing', 'layout');
  revalidatePath('/');
}

/** Runs a package call and turns a thrown error into a plain, honest answer. Nothing is half done silently. */
async function guarded<T>(label: string, run: () => Promise<BillingResult<T>>): Promise<BillingResult<T>> {
  try {
    const result = await run();
    if (result.ok) revalidateBilling();
    return result;
  } catch (error) {
    console.error(`[billing] ${label} failed`, error instanceof Error ? error.message : error);
    return billingError('gateway_error');
  }
}

const selectionInput = z.object({ selection: z.unknown() });
const productsInput = z.object({ products: z.array(z.string().max(32)).max(16) });

function readSelection(input: unknown): PlanSelection | null {
  const parsed = selectionInput.safeParse(input);
  if (!parsed.success) return null;
  const selection = normalizeSelection(parsed.data.selection);
  return selection.products.length === 0 ? null : selection;
}

/* ===== trial and cart ===== */

export async function startTrialAction(input: { selection: PlanSelection }): Promise<BillingResult<{ redirectTo: string }>> {
  const found = await contextFor('trial');
  if (!found.ok) return found.error;
  const { ctx } = found;
  const selection = readSelection(input);
  if (!selection) return billingError('invalid_selection');
  return guarded('start trial', async () => {
    const started = await startTrial(ctx.rt, { orgId: ctx.org.id, selection, actor: ctx.actor });
    if (!started.ok) return started;
    // A person in the middle of signup goes on to the next signup step. Anyone else lands on Billing.
    const intent = await getOpenSignupIntent(ctx.rt.db, ctx.session.user.id);
    if (!intent) return billingOk({ redirectTo: '/billing?notice=trial_started' });
    const step = ctx.emailVerified || intent.verifySkippedAt ? 'welcome' : 'verify';
    await upsertSignupIntent(ctx.rt.db, { userId: ctx.session.user.id, orgId: ctx.org.id, step });
    return billingOk({ redirectTo: step === 'verify' ? '/verify-email?next=/welcome' : '/welcome' });
  });
}

export async function changeTrialProductsAction(input: { products: readonly string[] }): Promise<BillingResult<PlanState>> {
  const found = await contextFor('trial');
  if (!found.ok) return found.error;
  const { ctx } = found;
  const parsed = productsInput.safeParse(input);
  if (!parsed.success) return billingError('invalid_selection');
  const products = toStack(parsed.data.products);
  if (products.length === 0) return billingError('invalid_selection');
  return guarded('change trial apps', () => changeTrialProducts(ctx.rt, { orgId: ctx.org.id, products, actor: ctx.actor }));
}

export async function saveCartAction(input: { selection: PlanSelection }): Promise<BillingResult<PlanSelection>> {
  const found = await contextFor('manage');
  if (!found.ok) return found.error;
  const { ctx } = found;
  const selection = readSelection(input);
  if (!selection) return billingError('invalid_selection');
  return guarded('save cart', () => saveCart(ctx.rt, { orgId: ctx.org.id, selection, actor: ctx.actor }));
}

/**
 * Keeps the plan a person is picking while they pick it, so a refresh or a closed tab loses nothing
 * (docs/billing/SPEC.md 5.6). It writes the same cart `saveCartAction` writes, but quietly: no
 * activity entry for every key press and no page reload under the person's hands. Only for a plan
 * that is not paid yet. A paid plan changes through preview and confirm, never through here.
 */
export async function saveCartDraftAction(input: { selection: PlanSelection }): Promise<BillingResult<null>> {
  const found = await contextFor('manage');
  if (!found.ok) return found.error;
  const { ctx } = found;
  const selection = readSelection(input);
  if (!selection) return billingError('invalid_selection');
  try {
    const state = await getPlanState(ctx.rt, ctx.org.id);
    if (state.hasSubscription) return billingOk(null);
    await writeCart(ctx.rt.db, ctx.org.id, selection);
    return billingOk(null);
  } catch (error) {
    console.error('[billing] save cart draft failed', error instanceof Error ? error.message : error);
    return billingError('gateway_error');
  }
}

/* ===== checkout and plan changes ===== */

export async function startCheckoutAction(input: { selection: PlanSelection }): Promise<BillingResult<{ url: string }>> {
  const found = await contextFor('manage');
  if (!found.ok) return found.error;
  const { ctx } = found;
  if (!ctx.emailVerified) return billingError('email_unverified');
  const selection = readSelection(input);
  if (!selection) return billingError('invalid_selection');
  return guarded('start checkout', async () => {
    const created = await createCheckout(ctx.rt, {
      orgId: ctx.org.id,
      orgName: ctx.org.name,
      selection,
      actor: ctx.actor,
      actorEmail: ctx.session.user.email,
    });
    return created.ok ? billingOk({ url: created.data.url }) : created;
  });
}

export async function previewPlanChangeAction(input: { selection: PlanSelection }): Promise<BillingResult<ChangePreview>> {
  const found = await contextFor('manage');
  if (!found.ok) return found.error;
  const { ctx } = found;
  const selection = readSelection(input);
  if (!selection) return billingError('invalid_selection');
  try {
    // A preview changes nothing, so nothing is revalidated.
    return await previewPlanChange(ctx.rt, { orgId: ctx.org.id, selection });
  } catch (error) {
    console.error('[billing] preview plan change failed', error instanceof Error ? error.message : error);
    return billingError('gateway_error');
  }
}

const confirmInput = z.object({
  selection: z.unknown(),
  // What the preview was based on. The server compares it with the plan as it is now.
  basis: z.string().min(8).max(128),
  expectedDueTodayCents: z.number().int().min(0).max(100_000_000),
});

/**
 * Confirms the change a person just looked at. `basis` and `expectedDueTodayCents` come from that
 * preview and are only compared, never used: the server picks the proration date itself and prices
 * the change again. A date from the browser is not accepted at all.
 */
export async function confirmPlanChangeAction(input: {
  selection: PlanSelection;
  basis: string;
  expectedDueTodayCents: number;
}): Promise<BillingResult<PlanState>> {
  const found = await contextFor('manage');
  if (!found.ok) return found.error;
  const { ctx } = found;
  if (!ctx.emailVerified) return billingError('email_unverified');
  const selection = readSelection(input);
  if (!selection) return billingError('invalid_selection');
  const parsed = confirmInput.safeParse(input);
  // A confirm with no basis (a tab left open across a release) is treated like a stale panel: look
  // again, then confirm. Nothing is charged.
  if (!parsed.success) return billingError('price_changed');
  return guarded('confirm plan change', () =>
    applyPlanChange(ctx.rt, {
      orgId: ctx.org.id,
      selection,
      basis: parsed.data.basis,
      expectedDueTodayCents: parsed.data.expectedDueTodayCents,
      actor: ctx.actor,
    }),
  );
}

/* ===== payment ===== */

export async function openCardUpdateAction(): Promise<BillingResult<{ url: string }>> {
  const found = await contextFor('manage');
  if (!found.ok) return found.error;
  const { ctx } = found;
  return guarded('open card update', () => createPaymentUpdateSession(ctx.rt, { orgId: ctx.org.id, actor: ctx.actor }));
}

export async function retryPaymentAction(): Promise<BillingResult<PlanState>> {
  const found = await contextFor('manage');
  if (!found.ok) return found.error;
  const { ctx } = found;
  return guarded('retry payment', () => retryPayment(ctx.rt, { orgId: ctx.org.id, actor: ctx.actor }));
}

/* ===== cancel and pause ===== */

const CANCEL_REASONS = ['too_expensive', 'missing_feature', 'switching_tool', 'not_using', 'seasonal', 'other'] as const;
const cancelInput = z.object({
  reason: z.enum(CANCEL_REASONS).nullable().optional(),
  detail: z.string().max(1000).nullable().optional(),
});
const pauseInput = z.object({
  months: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  reason: z.enum(CANCEL_REASONS).nullable().optional(),
});

export async function cancelPlanAction(input: { reason: CancelReason | null; detail: string | null }): Promise<BillingResult<PlanState>> {
  const found = await contextFor('manage');
  if (!found.ok) return found.error;
  const { ctx } = found;
  const parsed = cancelInput.safeParse(input);
  if (!parsed.success) return billingError('invalid_input');
  return guarded('cancel plan', () =>
    scheduleCancel(ctx.rt, {
      orgId: ctx.org.id,
      reason: parsed.data.reason ?? null,
      detail: parsed.data.detail?.trim() ? parsed.data.detail.trim() : null,
      actor: ctx.actor,
    }),
  );
}

export async function keepPlanAction(): Promise<BillingResult<PlanState>> {
  const found = await contextFor('manage');
  if (!found.ok) return found.error;
  const { ctx } = found;
  return guarded('keep plan', () => undoCancel(ctx.rt, { orgId: ctx.org.id, actor: ctx.actor }));
}

export async function pausePlanAction(input: { months: 1 | 2 | 3; reason: CancelReason | null }): Promise<BillingResult<PlanState>> {
  const found = await contextFor('manage');
  if (!found.ok) return found.error;
  const { ctx } = found;
  const parsed = pauseInput.safeParse(input);
  if (!parsed.success) return billingError('invalid_input', 'Pick 1, 2 or 3 months.');
  return guarded('pause plan', () =>
    pausePlan(ctx.rt, { orgId: ctx.org.id, months: parsed.data.months, reason: parsed.data.reason ?? null, actor: ctx.actor }),
  );
}

export async function undoPauseAction(): Promise<BillingResult<PlanState>> {
  const found = await contextFor('manage');
  if (!found.ok) return found.error;
  const { ctx } = found;
  return guarded('undo pause', () => undoPause(ctx.rt, { orgId: ctx.org.id, actor: ctx.actor }));
}

/* ===== details and team ===== */

const profileInput = z.object({
  billingEmail: z.string().max(300).nullable(),
  companyName: z.string().max(300).nullable(),
  address: z
    .object({
      line1: z.string().max(300).optional(),
      line2: z.string().max(300).optional(),
      city: z.string().max(300).optional(),
      state: z.string().max(300).optional(),
      postalCode: z.string().max(300).optional(),
      country: z.string().max(300).optional(),
    })
    .default({}),
  taxIdType: z.string().max(60).nullable(),
  taxIdValue: z.string().max(120).nullable(),
});

export async function updateBillingDetailsAction(input: BillingProfile): Promise<BillingResult<BillingProfile>> {
  const found = await contextFor('manage');
  if (!found.ok) return found.error;
  const { ctx } = found;
  const parsed = profileInput.safeParse(input);
  if (!parsed.success) return billingError('invalid_input');
  return guarded('update billing details', () =>
    updateBillingProfile(ctx.rt, { orgId: ctx.org.id, profile: parsed.data, actor: ctx.actor }),
  );
}

const userInput = z.object({ userId: z.string().min(1).max(200) });

export async function addBillingManagerAction(input: { userId: string }): Promise<BillingResult<null>> {
  const found = await contextFor('assign');
  if (!found.ok) return found.error;
  const { ctx } = found;
  const parsed = userInput.safeParse(input);
  if (!parsed.success) return billingError('invalid_input');
  return guarded('add billing manager', () =>
    addBillingManager(ctx.rt, { orgId: ctx.org.id, userId: parsed.data.userId, actor: ctx.actor }),
  );
}

export async function removeBillingManagerAction(input: { userId: string }): Promise<BillingResult<null>> {
  const found = await contextFor('assign');
  if (!found.ok) return found.error;
  const { ctx } = found;
  const parsed = userInput.safeParse(input);
  if (!parsed.success) return billingError('invalid_input');
  return guarded('remove billing manager', () =>
    removeBillingManager(ctx.rt, { orgId: ctx.org.id, userId: parsed.data.userId, actor: ctx.actor }),
  );
}

/* ===== test gateway pages (never in production: the mode check fails closed) ===== */

const NOT_TEST = 'The test gateway is off here. No real money moves on this page.';

async function testSessionUser(orgIdOf: () => Promise<string | null>): Promise<{ ok: true } | { ok: false; error: Failure }> {
  const rt = billingRuntime();
  if (rt.mode !== 'test_gateway') return { ok: false, error: billingError('billing_unavailable', NOT_TEST) };
  const session = await getSession();
  if (!session) return { ok: false, error: billingError('not_signed_in') };
  const orgId = await orgIdOf();
  // The same answer for "no such page" and "not your organization", so ids cannot be probed.
  if (!orgId || !(await isActiveOrgMember(session.user.id, orgId))) return { ok: false, error: billingError('not_found') };
  return { ok: true };
}

const sessionId = z.string().min(4).max(120).regex(/^[A-Za-z0-9_]+$/);
const cardFields = {
  sessionId,
  cardNumber: z.string().max(40),
  expMonth: z.coerce.number().int().min(0).max(99),
  expYear: z.coerce.number().int().min(0).max(9999),
  cvc: z.string().max(8),
};
const testCheckoutInput = z.object({
  ...cardFields,
  name: z.string().max(120),
  postalCode: z.string().max(20),
  promoCode: z.string().max(40).optional(),
  approve3ds: z.boolean().optional(),
});
const testCardInput = z.object(cardFields);

export async function testCompleteCheckoutAction(input: {
  sessionId: string;
  cardNumber: string;
  expMonth: number;
  expYear: number;
  cvc: string;
  name: string;
  postalCode: string;
  promoCode?: string;
  approve3ds?: boolean;
}): Promise<BillingResult<{ status: 'complete' | 'requires_action'; redirectUrl: string }>> {
  const parsed = testCheckoutInput.safeParse(input);
  if (!parsed.success) return billingError('invalid_input', 'Check the card details and try again.');
  const rt = billingRuntime();
  const allowed = await testSessionUser(async () => (await getTestCheckout(rt.db, parsed.data.sessionId))?.orgId ?? null);
  if (!allowed.ok) return allowed.error;
  return guarded('test checkout', () => completeTestCheckout(rt, parsed.data));
}

/**
 * The promo code box on the test pay page. The gateway checks the code and keeps it on the checkout
 * session, so the summary shows the promo line and the real first charge before the person pays.
 * An empty code takes the promo off again. A wrong code is an answer, not a crash.
 */
export async function testApplyPromoAction(input: {
  sessionId: string;
  promoCode: string;
}): Promise<BillingResult<{ promo: { code: string; label: string; discountCents: number } | null; firstChargeCents: number }>> {
  const parsed = z.object({ sessionId, promoCode: z.string().max(40) }).safeParse(input);
  if (!parsed.success) return billingError('invalid_input', 'That promo code is not valid.');
  const rt = billingRuntime();
  const allowed = await testSessionUser(async () => (await getTestCheckout(rt.db, parsed.data.sessionId))?.orgId ?? null);
  if (!allowed.ok) return allowed.error;
  try {
    return await applyTestPromo(rt, parsed.data);
  } catch (error) {
    console.error('[billing] test promo failed', error instanceof Error ? error.message : error);
    return billingError('gateway_error');
  }
}

export async function testCancelCheckoutAction(input: { sessionId: string }): Promise<BillingResult<{ redirectUrl: string }>> {
  const parsed = z.object({ sessionId }).safeParse(input);
  if (!parsed.success) return billingError('not_found');
  const rt = billingRuntime();
  const allowed = await testSessionUser(async () => (await getTestCheckout(rt.db, parsed.data.sessionId))?.orgId ?? null);
  if (!allowed.ok) return allowed.error;
  return guarded('test checkout back', async () => billingOk(await cancelTestCheckout(rt, parsed.data.sessionId)));
}

export async function testCompleteCardUpdateAction(input: {
  sessionId: string;
  cardNumber: string;
  expMonth: number;
  expYear: number;
  cvc: string;
}): Promise<BillingResult<{ redirectUrl: string }>> {
  const parsed = testCardInput.safeParse(input);
  if (!parsed.success) return billingError('invalid_input', 'Check the card details and try again.');
  const rt = billingRuntime();
  const allowed = await testSessionUser(async () => (await getTestCardUpdate(rt.db, parsed.data.sessionId))?.orgId ?? null);
  if (!allowed.ok) return allowed.error;
  return guarded('test card update', () => completeTestCardUpdate(rt, parsed.data));
}

/* ===== test tools on billing home (test gateway only, billing managers only) ===== */

async function testToolContext(): Promise<{ ok: true; ctx: BillingContext } | { ok: false; error: Failure }> {
  const found = await contextFor('manage');
  if (!found.ok) return found;
  if (found.ctx.rt.mode !== 'test_gateway') return { ok: false, error: billingError('billing_unavailable', NOT_TEST) };
  return found;
}

export async function testShiftTimeAction(input: { days: number }): Promise<BillingResult<PlanState>> {
  const found = await testToolContext();
  if (!found.ok) return found.error;
  const { ctx } = found;
  const parsed = z.object({ days: z.number().int().min(1).max(800) }).safeParse(input);
  if (!parsed.success) return billingError('invalid_input', 'Pick a number of days from 1 to 800.');
  return guarded('test shift time', () => testShiftTime(ctx.rt, { orgId: ctx.org.id, days: parsed.data.days }));
}

export async function testFailNextPaymentAction(): Promise<BillingResult<null>> {
  const found = await testToolContext();
  if (!found.ok) return found.error;
  const { ctx } = found;
  return guarded('test fail next payment', () => testFailNextPayment(ctx.rt, { orgId: ctx.org.id }));
}

export async function testRunDueAction(): Promise<BillingResult<{ renewed: number; failed: number }>> {
  const found = await testToolContext();
  if (!found.ok) return found.error;
  const { ctx } = found;
  return guarded('test run due', async () => billingOk(await testRunDue(ctx.rt, { orgId: ctx.org.id })));
}
