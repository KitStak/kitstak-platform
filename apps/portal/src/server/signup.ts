/**
 * Signup reads (docs/billing/CONTRACTS.md section 16.4, SPEC section 5.6): where a person should be
 * right now, what the invite page shows, and which sign in buttons exist. Server only. The rule for
 * the step itself is pure and lives in `@/features/signup/resume`.
 */
import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { getOpenSignupIntent, getPlanState, type SignupIntent } from '@kitstak/billing/server';
import { canStartTrial } from '@kitstak/billing/server';
import type { PlanState } from '@kitstak/billing/plan-state';
import { invitation, onboardingProgress, organization, user } from '@kitstak/db/schema';
import { enabledSocialProviders, type SocialProviderId } from '@/features/signup/social';
import { resolveSignupStep, stepHref, type SignupStep } from '@/features/signup/resume';
import { getBillingContext } from '@/server/billing/context';
import { billingRuntime } from '@/server/billing/runtime';
import { db } from '@/server/db';
import { env, isProduction } from '@/server/env';
import type { Session } from '@/server/session';

export type { SignupStep };
export { stepHref };

export interface SignupResume {
  readonly step: SignupStep;
  readonly intent: SignupIntent | null;
}

const MANAGER_ROLES = new Set(['owner', 'admin']);

async function profileSaved(orgId: string): Promise<boolean> {
  const rows = await db
    .select({ status: onboardingProgress.status })
    .from(onboardingProgress)
    .where(
      and(
        eq(onboardingProgress.orgId, orgId),
        isNull(onboardingProgress.userId),
        eq(onboardingProgress.stepKey, 'profile'),
        eq(onboardingProgress.status, 'completed'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** No free trial was ever started and there is no plan. */
export function isPlanUntouched(state: PlanState): boolean {
  return state.phase === 'none' && state.trial === null && !state.hasSubscription;
}

/** Where this person should be right now. Used by every signup page to resume or skip ahead. */
export async function getSignupResume(session: Session | null): Promise<SignupResume> {
  if (!session) return { step: '/signup', intent: null };
  const [intent, context] = await Promise.all([getOpenSignupIntent(db, session.user.id), getBillingContext()]);
  if (!context) return { step: resolveSignupStep(baseFacts(false)), intent };

  // Only an open signup needs the plan and the setup answers. Everyone else is simply home.
  if (!intent) return { step: '/', intent: null };
  const [state, saved] = await Promise.all([getPlanState(context.rt, context.org.id), profileSaved(context.org.id)]);
  const step = resolveSignupStep({
    signedIn: true,
    hasOrg: true,
    canStartTrial: context.access.canStartTrial,
    isManager: MANAGER_ROLES.has(context.org.role),
    planUntouched: isPlanUntouched(state),
    hasOpenIntent: true,
    emailVerified: context.emailVerified,
    verifySkipped: intent.verifySkippedAt !== null,
    profileSaved: saved,
  });
  return { step, intent };
}

function baseFacts(hasOrg: boolean) {
  return {
    signedIn: true,
    hasOrg,
    canStartTrial: false,
    isManager: false,
    planUntouched: true,
    hasOpenIntent: false,
    emailVerified: false,
    verifySkipped: false,
    profileSaved: false,
  };
}

/** `resume.step` as a link (verification carries where to go next). */
export async function getSignupResumeHref(session: Session | null): Promise<string> {
  return stepHref((await getSignupResume(session)).step);
}

/** The "Continue with ..." buttons to render. Empty when no provider keys are set. */
export function socialProviders(): readonly SocialProviderId[] {
  return enabledSocialProviders(env);
}

/**
 * True when emails land in the dev outbox page instead of an inbox (CONTRACTS 13.2): outside
 * production, with no Resend key. The screens then point at `/dev/outbox` for the code.
 */
export function devOutboxOn(): boolean {
  return !isProduction() && !env.RESEND_API_KEY && env.EMAIL_PROVIDER !== 'resend';
}

/** True when this person may still start a free trial for this organization. */
export async function trialOpenTo(orgId: string, userId: string): Promise<
  { ok: true } | { ok: false; reason: 'org_had_trial' | 'user_had_trial' | 'has_plan' }
> {
  return canStartTrial(billingRuntime().db, { orgId, userId });
}

export type InviteStatus = 'pending' | 'expired' | 'used' | 'missing';

export interface InviteView {
  readonly id: string;
  readonly status: InviteStatus;
  readonly orgName: string;
  readonly orgId: string;
  /** The invited address, lower case. */
  readonly email: string;
  /** "Admin", "Member", ... for the screen. */
  readonly roleLabel: string;
  readonly inviterName: string;
  readonly expiresAt: Date;
  /** An account with the invited address already exists. */
  readonly accountExists: boolean;
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ROLE_LABELS: Readonly<Record<string, string>> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
  guest: 'Guest',
};

/** "admin,member" to "Admin". The first role is the one a person would name. */
export function roleLabel(role: string | null): string {
  const first = (role ?? 'member').split(',')[0]?.trim().toLowerCase() || 'member';
  return ROLE_LABELS[first] ?? first.charAt(0).toUpperCase() + first.slice(1);
}

/**
 * What the invite page shows. The id is a long random value that only the invited person was
 * mailed, so the page may show the team name and the invited address to whoever holds the link.
 * null when the id is not an invite at all.
 */
export async function getInviteView(invitationId: string, now: Date = new Date()): Promise<InviteView | null> {
  if (!UUID_SHAPE.test(invitationId)) return null;
  const [row] = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      orgId: organization.id,
      orgName: organization.name,
      inviterName: user.name,
    })
    .from(invitation)
    .innerJoin(organization, eq(invitation.organizationId, organization.id))
    .innerJoin(user, eq(invitation.inviterId, user.id))
    .where(eq(invitation.id, invitationId));
  if (!row) return null;

  const email = row.email.trim().toLowerCase();
  const [account] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  const status: InviteStatus =
    row.status !== 'pending' ? 'used' : row.expiresAt.getTime() <= now.getTime() ? 'expired' : 'pending';
  return {
    id: row.id,
    status,
    orgName: row.orgName,
    orgId: row.orgId,
    email,
    roleLabel: roleLabel(row.role),
    inviterName: row.inviterName.trim() || 'the person who invited you',
    expiresAt: row.expiresAt,
    accountExists: account !== undefined,
  };
}
