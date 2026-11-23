'use server';
/**
 * Signup writes (docs/billing/CONTRACTS.md section 16.4, SPEC section 5): the workspace step, email
 * codes, password reset and invite acceptance. Every action works on the signed in person (or, for
 * password reset, on the address typed) and never takes an organization id from the browser.
 * Errors come back as one plain sentence that names the problem and the fix.
 */
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { after } from 'next/server';
import { z } from 'zod';
import { APIError } from 'better-auth/api';
import { parseHandoff } from '@kitstak/billing/handoff';
import {
  completeSignupIntent,
  enforceRateLimit,
  getOpenSignupIntent,
  recordAudit,
  upsertSignupIntent,
} from '@kitstak/billing/server';
import { cleanCode, companyIssue, emailIssue } from '@/features/signup/fields';
import { passwordIssue } from '@/features/signup/password-rules';
import { safeNextPath } from '@/lib/routes';
import { slugWithSuffix, slugify } from '@/lib/slug';
import { auth, emailCodeApi } from '@/server/auth';
import { db } from '@/server/db';
import { env } from '@/server/env';
import { listUserOrgs, resolveActiveOrg } from '@/server/orgs';
import { getSession } from '@/server/session';
import { getInviteView, getSignupResumeHref } from '@/server/signup';

export interface SignupActionResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly next?: string;
}

const SIGN_IN_AGAIN = 'Please sign in again.';
const TOO_MANY_TRIES = 'Too many tries. Wait a few minutes and try again.';
const NO_NETWORK = 'We could not reach KitStak. Check your connection and try again.';
const WORKSPACE_FAILED = 'Your account is ready, but we could not set up your workspace. Try again.';
const CODE_WRONG = 'That code is not right. Check it and try again.';
const CODE_OLD = 'That code is too old. Send a new one.';
const CODE_USED_UP = 'Too many tries with that code. Send a new one.';

function fail(error: string): SignupActionResult {
  return { ok: false, error };
}

function errorCode(error: unknown): string | null {
  if (error instanceof APIError) {
    const body = error.body as { code?: unknown } | undefined;
    return typeof body?.code === 'string' ? body.code : null;
  }
  return null;
}

function errorStatus(error: unknown): number | null {
  return error instanceof APIError && typeof error.statusCode === 'number' ? error.statusCode : null;
}

function errorMessage(error: unknown): string | null {
  if (error instanceof APIError) {
    const body = error.body as { message?: unknown } | undefined;
    return typeof body?.message === 'string' && body.message.trim() !== '' ? body.message : null;
  }
  return null;
}

/**
 * The caller's address, for limits on actions a signed out person can call. It mirrors the trust
 * rule of the shared auth layer: a forwarded address is believed only when it is a single value
 * (what the platform sets) or when TRUST_PROXY says the proxy in front overwrites the header.
 * null means "unknown", and those calls share one roomier bucket.
 */
function callerAddress(requestHeaders: Headers): string | null {
  const forwarded = requestHeaders.get('x-forwarded-for')?.trim() ?? '';
  const trust = (env.TRUST_PROXY ?? '').trim().toLowerCase();
  const trusted = trust !== '' && trust !== '0' && trust !== 'false';
  if (forwarded !== '') {
    const hops = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean);
    if (hops.length === 1 && hops[0]) return hops[0];
    if (trusted && hops[0]) return hops[0];
  }
  const real = requestHeaders.get('x-real-ip')?.trim();
  return trusted && real ? real : null;
}

/** True when the call may go on. Counted per address, with one shared bucket for unknown callers. */
async function allowAnonymous(action: string, requestHeaders: Headers, max: number): Promise<boolean> {
  const address = callerAddress(requestHeaders);
  return enforceRateLimit(db, {
    key: `billing:signup:${action}:${address ?? 'shared'}`,
    windowSeconds: 600,
    max: address ? max : max * 20,
  });
}

const workspaceSchema = z.object({
  company: z.string().max(200),
  handoff: z.record(z.string().max(40), z.string().max(200)).default({}),
});

/**
 * Makes the organization for a new account (one retry on a taken slug), makes it active, and stores
 * the signup intent with the cart and answers from the link. Safe to send twice: a person who
 * already has an organization keeps it and simply moves on.
 */
export async function createWorkspaceAction(input: unknown): Promise<SignupActionResult> {
  const session = await getSession();
  if (!session) return fail(SIGN_IN_AGAIN);
  const parsed = workspaceSchema.safeParse(input);
  if (!parsed.success) return fail('Enter your company or team name.');
  const company = parsed.data.company.trim();
  const issue = companyIssue(company);
  if (issue) return fail(issue);
  const handoff = parseHandoff(parsed.data.handoff);
  const requestHeaders = await headers();

  try {
    const existing = await listUserOrgs(session.user.id);
    let orgId = (await resolveActiveOrg(session, existing))?.id ?? null;

    if (orgId === null) {
      if (!(await enforceRateLimit(db, { key: `billing:signup:org:${session.user.id}`, windowSeconds: 600, max: 5 }))) {
        return fail(TOO_MANY_TRIES);
      }
      const base = slugify(company);
      let created: { id: string } | null = null;
      for (const slug of [base, slugWithSuffix(base), slugWithSuffix(base)]) {
        try {
          created = await auth.api.createOrganization({ body: { name: company, slug }, headers: requestHeaders });
          if (created) break;
        } catch (error: unknown) {
          // A taken slug is the one failure worth a second try. Anything else is tried again too,
          // with a new slug, and reported if it keeps failing.
          console.error('[portal] createOrganization failed', errorCode(error) ?? error);
        }
      }
      if (!created) return fail(WORKSPACE_FAILED);
      orgId = created.id;
    } else if (session.session.activeOrganizationId !== orgId) {
      await auth.api.setActiveOrganization({ body: { organizationId: orgId }, headers: requestHeaders });
    }

    const intent = await upsertSignupIntent(db, { userId: session.user.id, orgId, handoff, step: 'plan' });
    if (intent.profile.guided === true && handoff.profile.guided === true) {
      const name = session.user.name?.trim() || session.user.email;
      await recordAudit(db, {
        orgId,
        actor: { userId: session.user.id, label: name },
        action: 'signup.guided_requested',
        summary: `${name} asked for help with setup.`,
        data: { source: intent.source },
      });
    }
  } catch (error: unknown) {
    console.error('[portal] createWorkspaceAction failed', error);
    return fail(WORKSPACE_FAILED);
  }

  revalidatePath('/', 'layout');
  return { ok: true, next: '/signup/plan' };
}

/** Sends a new 6 digit code to the signed in person's address. */
export async function resendVerificationAction(): Promise<SignupActionResult> {
  const session = await getSession();
  if (!session) return fail(SIGN_IN_AGAIN);
  if (session.user.emailVerified) return { ok: true };
  // One send every 30 seconds per person. The 5 per 10 minutes rule sits in the auth hooks.
  if (!(await enforceRateLimit(db, { key: `billing:signup:resend:${session.user.id}`, windowSeconds: 30, max: 1 }))) {
    return fail('We just sent a code. Wait 30 seconds, then send a new one.');
  }
  try {
    await emailCodeApi().sendVerificationOTP({
      body: { email: session.user.email, type: 'email-verification' },
      headers: await headers(),
    });
    return { ok: true };
  } catch (error: unknown) {
    if (errorStatus(error) === 429) return fail(TOO_MANY_TRIES);
    console.error('[portal] resendVerificationAction failed', error);
    return fail('We could not send the code. Try again.');
  }
}

function codeError(error: unknown): string {
  const code = errorCode(error);
  if (code === 'OTP_EXPIRED') return CODE_OLD;
  if (code === 'TOO_MANY_ATTEMPTS') return CODE_USED_UP;
  if (errorStatus(error) === 429) return TOO_MANY_TRIES;
  return CODE_WRONG;
}

const codeSchema = z.object({ code: z.string().max(40) });

/** Checks the 6 digit code and marks the signed in person's address as verified. */
export async function verifyEmailAction(input: unknown): Promise<SignupActionResult> {
  const session = await getSession();
  if (!session) return fail(SIGN_IN_AGAIN);
  if (session.user.emailVerified) return { ok: true };
  const parsed = codeSchema.safeParse(input);
  const code = parsed.success ? cleanCode(parsed.data.code) : '';
  if (code.length !== 6) return fail('Enter the 6 digit code from your email.');
  if (!(await enforceRateLimit(db, { key: `billing:signup:verify:${session.user.id}`, windowSeconds: 600, max: 10 }))) {
    return fail(TOO_MANY_TRIES);
  }
  try {
    await emailCodeApi().verifyEmailOTP({ body: { email: session.user.email, otp: code }, headers: await headers() });
  } catch (error: unknown) {
    if (!(error instanceof APIError)) {
      console.error('[portal] verifyEmailAction failed', error);
      return fail(NO_NETWORK);
    }
    return fail(codeError(error));
  }
  try {
    const intent = await getOpenSignupIntent(db, session.user.id);
    if (intent?.step === 'verify') await upsertSignupIntent(db, { userId: session.user.id, step: 'welcome' });
  } catch (error: unknown) {
    console.error('[portal] could not move the signup intent on after verification', error);
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

const skipSchema = z.object({ next: z.string().max(500).optional() }).optional();

/**
 * "I will do this later". Verification never blocks the first session. The person goes on to the
 * welcome screen or the launcher; a screen that needs a verified address (paying, inviting) is not
 * a place to skip to, so those fall back to the launcher.
 */
export async function skipVerifyAction(input?: unknown): Promise<SignupActionResult> {
  const session = await getSession();
  if (!session) return fail(SIGN_IN_AGAIN);
  const parsed = skipSchema.safeParse(input);
  const wanted = safeNextPath(parsed.success ? parsed.data?.next : null, '/welcome');
  const next = wanted === '/welcome' || wanted === '/' ? wanted : '/';
  try {
    const intent = await getOpenSignupIntent(db, session.user.id);
    if (intent) {
      const step = intent.step === 'verify' ? 'welcome' : intent.step;
      await upsertSignupIntent(db, { userId: session.user.id, verifySkipped: true, step });
    }
  } catch (error: unknown) {
    console.error('[portal] skipVerifyAction failed', error);
  }
  return { ok: true, next };
}

const emailSchema = z.object({ email: z.string().max(320) });

/**
 * Starts a password reset. It always answers the same way and takes the same time, so it never
 * says whether an address has an account. The code is sent after the response.
 */
export async function requestPasswordResetAction(input: unknown): Promise<SignupActionResult> {
  const parsed = emailSchema.safeParse(input);
  const email = parsed.success ? parsed.data.email.trim().toLowerCase() : '';
  const issue = emailIssue(email, 'Enter a valid email.');
  if (issue) return fail(issue);
  const requestHeaders = await headers();
  if (!(await allowAnonymous('reset-request', requestHeaders, 5))) return fail(TOO_MANY_TRIES);
  after(async () => {
    try {
      await emailCodeApi().requestPasswordResetEmailOTP({ body: { email } });
    } catch (error: unknown) {
      // The per address limit answers here. The person was already told the neutral sentence.
      if (errorStatus(error) !== 429) console.error('[portal] requestPasswordResetAction failed', error);
    }
  });
  return { ok: true };
}

const resetSchema = z.object({
  email: z.string().max(320),
  code: z.string().max(40),
  password: z.string().max(200),
});

/**
 * Sets a new password with the emailed code. Every old session is signed out (the shared setting),
 * then the person is signed in with the new password so they land straight in the product.
 */
export async function resetPasswordAction(input: unknown): Promise<SignupActionResult> {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) return fail('Check what you entered and try again.');
  const email = parsed.data.email.trim().toLowerCase();
  const code = cleanCode(parsed.data.code);
  const password = parsed.data.password;
  if (emailIssue(email)) return fail('Enter a valid email.');
  if (code.length !== 6) return fail('Enter the 6 digit code from your email.');
  const issue = passwordIssue(password, { email });
  if (issue) return fail(issue);
  const requestHeaders = await headers();
  if (!(await allowAnonymous('reset', requestHeaders, 10))) return fail(TOO_MANY_TRIES);
  if (!(await enforceRateLimit(db, { key: `billing:signup:reset:${email}`, windowSeconds: 600, max: 10 }))) {
    return fail(TOO_MANY_TRIES);
  }

  try {
    await emailCodeApi().resetPasswordEmailOTP({ body: { email, otp: code, password } });
  } catch (error: unknown) {
    if (!(error instanceof APIError)) {
      console.error('[portal] resetPasswordAction failed', error);
      return fail(NO_NETWORK);
    }
    if (errorCode(error) === 'PASSWORD_POLICY') return fail(errorMessage(error) ?? 'Pick a stronger password.');
    // An address with no account answers like a wrong code, so the form gives nothing away.
    return fail(codeError(error));
  }

  try {
    await auth.api.signInEmail({ body: { email, password, rememberMe: true }, headers: requestHeaders });
  } catch (error: unknown) {
    // The password is changed. If the sign in did not go through, the sign in page takes over.
    console.error('[portal] sign in after password reset failed', errorCode(error) ?? error);
    return { ok: true, next: '/login?notice=password-reset' };
  }
  return { ok: true, next: '/login' };
}

const inviteSchema = z.object({ invitationId: z.string().uuid() });

/** Accepts an invitation for the signed in person and makes that organization the active one. */
export async function acceptInviteAction(input: unknown): Promise<SignupActionResult> {
  const session = await getSession();
  if (!session) return fail(SIGN_IN_AGAIN);
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return fail('This invite is no longer active.');
  const view = await getInviteView(parsed.data.invitationId);
  if (!view) return fail('This invite is no longer active.');
  const inactive = `This invite is no longer active. Ask ${view.inviterName} to send a new one.`;
  if (view.status !== 'pending') return fail(inactive);
  if (view.email !== session.user.email.trim().toLowerCase()) {
    return fail(`This invite is for ${view.email}. Sign out and open the link again.`);
  }
  if (!(await enforceRateLimit(db, { key: `billing:signup:invite:${session.user.id}`, windowSeconds: 600, max: 20 }))) {
    return fail(TOO_MANY_TRIES);
  }

  const requestHeaders = await headers();
  try {
    await auth.api.acceptInvitation({ body: { invitationId: view.id }, headers: requestHeaders });
  } catch (error: unknown) {
    const code = errorCode(error);
    if (code === 'SEAT_LIMIT_REACHED') return fail(`The team has no free seat. Ask ${view.inviterName} to add one.`);
    if (code === 'INVITATION_NOT_FOUND') return fail(inactive);
    if (code === 'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION') {
      return fail(`This invite is for ${view.email}. Sign out and open the link again.`);
    }
    if (code === 'ORGANIZATION_MEMBERSHIP_LIMIT_REACHED') {
      return fail(`The team is full. Ask ${view.inviterName} to make room.`);
    }
    console.error('[portal] acceptInviteAction failed', code ?? error);
    return fail(error instanceof APIError ? inactive : NO_NETWORK);
  }

  try {
    await auth.api.setActiveOrganization({ body: { organizationId: view.orgId }, headers: requestHeaders });
  } catch (error: unknown) {
    console.error('[portal] could not make the joined organization active', errorCode(error) ?? error);
  }
  try {
    // An invited person never sees the picker or a price. Any signup of their own is closed.
    await completeSignupIntent(db, session.user.id);
  } catch (error: unknown) {
    console.error('[portal] could not close the signup intent after an invite', error);
  }
  revalidatePath('/', 'layout');
  return { ok: true, next: '/' };
}

/** After sign in: the step this person should be on. Lets a half done signup pick up where it stopped. */
export async function resumeAfterSignInAction(): Promise<SignupActionResult> {
  const session = await getSession();
  if (!session) return { ok: true, next: '/login' };
  try {
    return { ok: true, next: await getSignupResumeHref(session) };
  } catch (error: unknown) {
    console.error('[portal] resumeAfterSignInAction failed', error);
    return { ok: true, next: '/' };
  }
}
