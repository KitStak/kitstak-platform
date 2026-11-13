'use server';
/**
 * Guided-setup writes (server actions): the welcome wizard's answers, step skips and
 * guide dismissal. Everything acts on the session's ACTIVE org (never a client-supplied
 * org id), requires an owner/admin membership, and upserts org-level rows
 * (user_id IS NULL) against the partial unique index from 0002_core_onboarding.
 */
import { revalidatePath } from 'next/cache';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { onboardingProgress } from '@kitstak/db/schema';
import {
  BUSINESS_TYPES,
  SETUP_FOCUSES,
  START_MODES,
  TEAM_SIZES,
  isSetupStepKey,
} from '@/lib/setup-model';
import { db } from '@/server/db';
import { getSession } from '@/server/session';
import { listUserOrgs, resolveActiveOrg } from '@/server/orgs';
import { GUIDE_STEP_KEY } from '@/server/onboarding';

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

/** Saves the welcome wizard's answers; completes the 'profile' step. */
export async function saveSetupProfile(input: unknown): Promise<ActionResult> {
  const context = await requireManager();
  if (!context) return NOT_ALLOWED;
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Those answers didn’t look right. Try again.' };
  await upsertOrgStep(context, 'portal', 'profile', 'completed', parsed.data);
  revalidatePath('/');
  revalidatePath('/welcome');
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
  revalidatePath('/');
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
  revalidatePath('/');
  return { ok: true };
}

/** Hides the setup guide for the whole org (restorable from the command palette). */
export async function dismissSetupGuide(): Promise<ActionResult> {
  const context = await requireManager();
  if (!context) return NOT_ALLOWED;
  await upsertOrgStep(context, 'portal', GUIDE_STEP_KEY, 'dismissed');
  revalidatePath('/');
  return { ok: true };
}

/** Brings a dismissed guide back; the row flips to 'completed' so the seen marker survives. */
export async function restoreSetupGuide(): Promise<ActionResult> {
  const context = await requireManager();
  if (!context) return NOT_ALLOWED;
  await upsertOrgStep(context, 'portal', GUIDE_STEP_KEY, 'completed');
  revalidatePath('/');
  return { ok: true };
}
