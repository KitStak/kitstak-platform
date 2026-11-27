'use server';
/**
 * Guided-setup writes (server actions): the welcome wizard's answers and step skips.
 * Everything acts on the session's ACTIVE org (never a client-supplied
 * org id), requires an owner/admin membership, and upserts org-level rows
 * (user_id IS NULL) against the partial unique index from 0002_core_onboarding.
 */
import { revalidatePath } from 'next/cache';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { completeSignupIntent } from '@kitstak/billing/server';
import { onboardingProgress } from '@kitstak/db/schema';
import {
  BUSINESS_TYPES,
  SETUP_FOCUSES,
  SETUP_PRODUCTS,
  START_MODES,
  TEAM_SIZES,
  focusFromProducts,
  isSetupStepKey,
  toSetupProducts,
} from '@/lib/setup-model';
import { db } from '@/server/db';
import { getSession } from '@/server/session';
import { listUserOrgs, resolveActiveOrg } from '@/server/orgs';

/** The setup guide lives in Organization settings. */
const SETUP_GUIDE_PATH = '/settings/organization';

const MANAGER_ROLES = new Set(['owner', 'admin']);

export interface ActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

interface ActiveOrgContext {
  readonly orgId: string;
  readonly userId: string;
}

/** Session + active-org membership with a managing role, or null. */
async function requireManager(): Promise<ActiveOrgContext | null> {
  const session = await getSession();
  if (!session) return null;
  const orgs = await listUserOrgs(session.user.id);
  const activeOrg = await resolveActiveOrg(session, orgs);
  if (!activeOrg || !MANAGER_ROLES.has(activeOrg.role)) return null;
  return { orgId: activeOrg.id, userId: session.user.id };
}

const NOT_ALLOWED: ActionResult = {
  ok: false,
  error: 'You need an owner or admin role to change setup for this organization.',
};

const profileSchema = z.object({
  focus: z.enum(SETUP_FOCUSES as [string, ...string[]]),
  businessType: z.enum(BUSINESS_TYPES as [string, ...string[]]),
  teamSize: z.enum(TEAM_SIZES as [string, ...string[]]),
  startMode: z.enum(START_MODES as [string, ...string[]]),
  /** The apps picked at signup. Optional so older callers keep working. */
  products: z.array(z.enum(SETUP_PRODUCTS as [string, ...string[]])).max(SETUP_PRODUCTS.length).optional(),
});

async function upsertOrgStep(
  context: ActiveOrgContext,
  scope: 'portal' | 'crm' | 'wms',
  stepKey: string,
  status: 'completed' | 'skipped' | 'dismissed',
  payload: Record<string, unknown> = {},
): Promise<void> {
  await db
    .insert(onboardingProgress)
    .values({
      orgId: context.orgId,
      userId: null,
      scope,
      stepKey,
      status,
      payload,
      completedBy: context.userId,
    })
    .onConflictDoUpdate({
      target: [onboardingProgress.orgId, onboardingProgress.scope, onboardingProgress.stepKey],
      targetWhere: sql`user_id IS NULL`,
      set: { status, payload, completedBy: context.userId, updatedAt: new Date() },
    });
}

async function deleteOrgStep(orgId: string, stepKey: string): Promise<void> {
  await db
    .delete(onboardingProgress)
    .where(
      and(
        eq(onboardingProgress.orgId, orgId),
        eq(onboardingProgress.stepKey, stepKey),
        isNull(onboardingProgress.userId),
      ),
    );
}

/** Closes the person's open signup. A failure here never undoes the step that was just saved. */
async function closeSignup(userId: string): Promise<void> {
  try {
    await completeSignupIntent(db, userId);
  } catch (error: unknown) {
    console.error('[portal] could not close the signup intent', error);
  }
}

/**
 * Saves the welcome wizard's answers; completes the 'profile' step and closes the signup intent.
 * With `products`, `focus` is derived from them, so the CRM and WMS guides (which read `focus`)
 * keep working.
 */
export async function saveSetupProfile(input: unknown): Promise<ActionResult> {
  const context = await requireManager();
  if (!context) return NOT_ALLOWED;
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Those answers did not look right. Try again.' };
  const { products: rawProducts, ...answers } = parsed.data;
  const payload: Record<string, unknown> =
    rawProducts === undefined
      ? answers
      : { ...answers, focus: focusFromProducts(toSetupProducts(rawProducts)), products: toSetupProducts(rawProducts) };
  await upsertOrgStep(context, 'portal', 'profile', 'completed', payload);
  await closeSignup(context.userId);
  // The answers shape the setup guide (Organization settings) and the billing only redirect on home.
  revalidatePath(SETUP_GUIDE_PATH);
  revalidatePath('/');
  revalidatePath('/welcome');
  return { ok: true };
}

/**
 * "Skip for now" on the welcome wizard. Nothing is saved as answered: the "Tell us about your
 * business" step stays open in the setup guide. Only the signup is closed, so the person is not
 * sent back to the wizard the next time they sign in.
 */
export async function skipWelcome(): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'Please sign in again.' };
  await closeSignup(session.user.id);
  revalidatePath('/');
  return { ok: true };
}

/** Marks a step skipped ("I'll do this later") without pretending it happened. */
export async function skipSetupStep(stepKey: string): Promise<ActionResult> {
  const context = await requireManager();
  if (!context) return NOT_ALLOWED;
  if (!isSetupStepKey(stepKey) || stepKey === 'profile') {
    return { ok: false, error: 'Unknown setup step.' };
  }
  const scope = stepKey.startsWith('crm_') ? 'crm' : stepKey.startsWith('wms_') ? 'wms' : 'portal';
  await upsertOrgStep(context, scope, stepKey, 'skipped');
  revalidatePath(SETUP_GUIDE_PATH);
  return { ok: true };
}

/** Returns a skipped step to the plan. */
export async function unskipSetupStep(stepKey: string): Promise<ActionResult> {
  const context = await requireManager();
  if (!context) return NOT_ALLOWED;
  if (!isSetupStepKey(stepKey) || stepKey === 'profile') {
    return { ok: false, error: 'Unknown setup step.' };
  }
  await deleteOrgStep(context.orgId, stepKey);
  revalidatePath(SETUP_GUIDE_PATH);
  return { ok: true };
}
