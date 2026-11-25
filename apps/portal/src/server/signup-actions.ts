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
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { APIError } from 'better-auth/api';
import { normalizeSelection } from '@kitstak/billing/catalog';
import { parseHandoff } from '@kitstak/billing/handoff';
import {
  completeSignupIntent,
  enforceRateLimit,
  getOpenSignupIntent,
  INVITE_NEEDS_PROVEN_MAILBOX_CODE,
  INVITE_NEEDS_PROVEN_MAILBOX_MESSAGE,
  recordAudit,
  upsertSignupIntent,
} from '@kitstak/billing/server';
import { account, billingAccounts, member, user, verification } from '@kitstak/db/schema';
import { cleanCode, companyIssue, emailIssue, nameIssue } from '@/features/signup/fields';
import { passwordIssue } from '@/features/signup/password-rules';
import { safeNextPath, safeReturnUrl } from '@/lib/routes';
import { slugWithSuffix, slugify } from '@/lib/slug';
import { auth, clearSignInLockout, emailCodeApi, hasPassword, maySignInWithCode, withSignInCode, withoutSignupCode } from '@/server/auth';
import { db } from '@/server/db';
import { env, trustedOrigins } from '@/server/env';
import { listUserOrgs, resolveActiveOrg } from '@/server/orgs';
import { getSession } from '@/server/session';
import { getInviteView, getSignupResumeHref, inviteProofValid } from '@/server/signup';

export interface SignupActionResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly next?: string;
  /** Which field the error belongs to, when it belongs to one. */
  readonly field?: 'name' | 'password' | 'email';
  /** A short machine word for the cases a form treats in a special way. */
  readonly code?: 'account_exists' | 'no_seat' | 'password_removed' | 'needs_invite_link';
}

const SIGN_IN_AGAIN = 'Please sign in again.';
/** Said when an invite is opened without the link from the invite email (review round 4). */
const NEEDS_INVITE_LINK = INVITE_NEEDS_PROVEN_MAILBOX_MESSAGE;
// Every limit that answers with this sentence has a 10 minute window, so the wait it names is true.
const TOO_MANY_TRIES = 'Too many tries. Wait 10 minutes and try again.';
const NO_NETWORK = 'We could not reach KitStak. Check your connection and try again.';
const WORKSPACE_FAILED = 'Your account is ready, but we could not set up your organization. Try again.';
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

const selectionSchema = z.object({ selection: z.unknown() });

/**
 * Keeps the apps, seats and pay period a person is picking at signup, as they pick them, in their
 * open signup intent (docs/billing/SPEC.md 5.6). A refresh or a closed tab then shows the picker
 * exactly as they left it. Only the cleaned selection is stored. No price ever comes from the browser.
 */
export async function saveSignupSelectionAction(input: unknown): Promise<SignupActionResult> {
  const session = await getSession();
  if (!session) return fail(SIGN_IN_AGAIN);
  const parsed = selectionSchema.safeParse(input);
  if (!parsed.success) return fail('Pick at least one app.');
  const selection = normalizeSelection(parsed.data.selection);
  if (selection.products.length === 0) return fail('Pick at least one app.');
  try {
    // Only a signup that is still open has a cart to keep. Nothing is created here.
    const intent = await getOpenSignupIntent(db, session.user.id);
    if (!intent) return { ok: true };
    await upsertSignupIntent(db, { userId: session.user.id, handoff: { selection, profile: {}, source: 'direct' } });
    return { ok: true };
  } catch (error: unknown) {
    console.error('[portal] saveSignupSelectionAction failed', error);
    return fail(NO_NETWORK);
  }
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

/* ===== sign in with an emailed code ("Email me a code instead", review round 3) ===== */

/**
 * Sends a 6 digit sign in code. It always answers the same way and takes the same time, so it never
 * says whether an address has an account. The code goes out after the response, and only to an
 * account that may sign in (`maySignInWithCode`). The same limits as every other code: 5 per 10
 * minutes and 20 per day for one address.
 */
export async function requestSignInCodeAction(input: unknown): Promise<SignupActionResult> {
  const parsed = emailSchema.safeParse(input);
  const email = parsed.success ? parsed.data.email.trim().toLowerCase() : '';
  const issue = emailIssue(email, 'Enter a valid email address.');
  if (issue) return { ...fail(issue), field: 'email' };
  const requestHeaders = await headers();
  if (!(await allowAnonymous('signin-code-request', requestHeaders, 5))) return fail(TOO_MANY_TRIES);
  after(async () => {
    try {
      if (!(await maySignInWithCode(email))) return;
      await withSignInCode(() => emailCodeApi().sendVerificationOTP({ body: { email, type: 'sign-in' } }));
    } catch (error: unknown) {
      // The per address limit answers here. The person was already told the neutral sentence.
      if (errorStatus(error) !== 429) console.error('[portal] requestSignInCodeAction failed', error);
    }
  });
  return { ok: true };
}

const signInCodeSchema = z.object({ email: z.string().max(320), code: z.string().max(40), next: z.string().max(2000).optional() });

/** Where the account page lives. It is where a person sets a password. */
const ACCOUNT_PATH = '/settings/account';

/**
 * Signs a person in with the emailed code. The code proves the mailbox, so the address is marked
 * verified in the same step: one code is both the sign in and the verification. A wrong code, an
 * old code and an address with no account all get the same answer.
 *
 * One more thing can happen here, and the person is told (review round 4). When the email of the
 * account was never proven before, the password it had is removed in this step. That is on purpose:
 * until the mailbox is proven, nobody knows who set that password. The answer then carries
 * `code: 'password_removed'` and sends the person to their account page, which says so in one
 * sentence and offers "Set a password". Signing in with a code keeps working either way.
 */
export async function signInWithCodeAction(input: unknown): Promise<SignupActionResult> {
  const parsed = signInCodeSchema.safeParse(input);
  if (!parsed.success) return fail(CODE_WRONG);
  const email = parsed.data.email.trim().toLowerCase();
  const code = cleanCode(parsed.data.code);
  if (emailIssue(email)) return { ...fail('Enter a valid email address.'), field: 'email' };
  if (code.length !== 6) return fail('Enter the 6 digit code from your email.');
  const requestHeaders = await headers();
  if (!(await allowAnonymous('signin-code', requestHeaders, 10))) return fail(TOO_MANY_TRIES);
  let hadPassword = false;
  try {
    // An address that may not sign in this way gets the answer a wrong code gets, after the same work.
    const allowed = await maySignInWithCode(email);
    hadPassword = await hasPassword(email);
    await withSignInCode(() =>
      emailCodeApi().signInEmailOTP({ body: { email: allowed ? email : `no-account+${email}`, otp: code }, headers: requestHeaders }),
    );
  } catch (error: unknown) {
    if (!(error instanceof APIError)) {
      console.error('[portal] signInWithCodeAction failed', error);
      return fail(NO_NETWORK);
    }
    return fail(codeError(error));
  }
  try {
    await clearSignInLockout(email);
  } catch (error: unknown) {
    console.error('[portal] could not clear the lockout after a sign in by code', error);
  }
  revalidatePath('/', 'layout');
  try {
    if (hadPassword && !(await hasPassword(email))) {
      // The old password is gone. Say so, on the page where a new one is set, then go on.
      const after = safeReturnUrl(parsed.data.next, trustedOrigins(), '');
      const query = new URLSearchParams({ notice: 'password-removed' });
      if (after !== '') query.set('next', after);
      return { ok: true, code: 'password_removed', next: `${ACCOUNT_PATH}?${query.toString()}` };
    }
  } catch (error: unknown) {
    console.error('[portal] could not check the password after a sign in by code', error);
  }
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

type InviteFacts = NonNullable<Awaited<ReturnType<typeof getInviteView>>>;

function noSeatMessage(inviterName: string): string {
  return `The team has no free seat right now. Ask ${inviterName} to add one, then open this link again.`;
}

/** Marks an address as verified. Only called after the invite proof checked out. */
async function markEmailVerified(userId: string): Promise<void> {
  await db.update(user).set({ emailVerified: true, updatedAt: new Date() }).where(eq(user.id, userId));
}

/**
 * The same request headers without the cached copy of the session. The session token stays, so the
 * auth layer reads the person fresh from the database and writes a fresh cached copy back.
 */
function withoutSessionCache(source: Headers): Headers {
  const out = new Headers(source);
  const cookie = source.get('cookie');
  if (cookie) {
    const kept = cookie
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part !== '' && !/^(__Secure-)?[^=]*session_data(\.\d+)?=/.test(part));
    out.set('cookie', kept.join('; '));
  }
  return out;
}

/** Accepts the invitation. Returns the failure to show, or null when the person is in. */
async function acceptInvitation(view: InviteFacts, requestHeaders: Headers): Promise<SignupActionResult | null> {
  const inactive = `This invite is no longer active. Ask ${view.inviterName} to send a new one.`;
  try {
    await auth.api.acceptInvitation({ body: { invitationId: view.id }, headers: requestHeaders });
    return null;
  } catch (error: unknown) {
    const code = errorCode(error);
    if (code === 'SEAT_LIMIT_REACHED') return { ...fail(noSeatMessage(view.inviterName)), code: 'no_seat' };
    if (code === INVITE_NEEDS_PROVEN_MAILBOX_CODE) return { ...fail(NEEDS_INVITE_LINK), code: 'needs_invite_link' };
    if (code === 'INVITATION_NOT_FOUND') return fail(inactive);
    if (code === 'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION') {
      return fail(`This invite is for ${view.email}. Sign out and open the link again.`);
    }
    if (code === 'ORGANIZATION_MEMBERSHIP_LIMIT_REACHED') {
      return fail(`The team is full. Ask ${view.inviterName} to make room.`);
    }
    console.error('[portal] accepting an invitation failed', code ?? error);
    return fail(error instanceof APIError ? inactive : NO_NETWORK);
  }
}

const joinSchema = z.object({
  invitationId: z.string().uuid(),
  name: z.string().max(200),
  password: z.string().max(200),
  timezone: z.string().max(80).optional(),
});

/** The session cookie a sign up answered with, as a `cookie` header for the calls that follow it. */
function sessionCookieFrom(responseHeaders: Headers): string | null {
  for (const line of responseHeaders.getSetCookie()) {
    const pair = line.split(';')[0]?.trim() ?? '';
    if (/^(__Secure-)?[^=]*session_token=/.test(pair)) return pair;
  }
  return null;
}

/**
 * New to KitStak and invited: makes the account and joins the team in one step, on the server.
 *
 * Order matters. The seat is checked BEFORE the account is made, so a join that would be refused
 * never leaves an account behind. If the join still fails after the account exists (the plan shrank
 * in that very second), the account that was just made is removed again.
 *
 * A person who came from the link in the invite email owns that mailbox, so their email is marked
 * verified and no code email is sent.
 */
export async function joinInviteAction(input: unknown): Promise<SignupActionResult> {
  const parsed = joinSchema.safeParse(input);
  if (!parsed.success) return fail('Check what you entered and try again.');
  const view = await getInviteView(parsed.data.invitationId);
  if (!view) return fail('This invite is no longer active.');
  if (view.status !== 'pending') return fail(`This invite is no longer active. Ask ${view.inviterName} to send a new one.`);
  if (view.accountExists) {
    return { ...fail('An account with this email already exists. Sign in to accept the invite.'), code: 'account_exists' };
  }
  if (await getSession()) return fail('You are signed in with another account. Sign out and open the link again.');

  const name = parsed.data.name.trim();
  const nameProblem = nameIssue(name);
  if (nameProblem) return { ...fail(nameProblem), field: 'name' };
  // The same check the invite form runs: not built on the invited address, nor on the team's name.
  const passwordProblem = passwordIssue(parsed.data.password, { email: view.email, company: view.orgName });
  if (passwordProblem) return { ...fail(passwordProblem), field: 'password' };

  const requestHeaders = await headers();
  if (!(await allowAnonymous('invite-join', requestHeaders, 5))) return fail(TOO_MANY_TRIES);
  if (!(await enforceRateLimit(db, { key: `billing:signup:invite-join:${view.id}`, windowSeconds: 600, max: 10 }))) {
    return fail(TOO_MANY_TRIES);
  }

  // Before any account exists: is there room on the team?
  if (!view.seatAvailable) return { ...fail(noSeatMessage(view.inviterName)), code: 'no_seat' };

  // Before any account exists: did this person come from the link in the invite email? Only that
  // mailbox has the link's proof. Without it nothing is made (review round 4): the invitation id by
  // itself is not a secret, because the people who manage the team can read it, and one of them
  // could otherwise make the account for the invited address and take the invite.
  const proven = await inviteProofValid(view.id, view.email);
  if (!proven) return { ...fail(NEEDS_INVITE_LINK), code: 'needs_invite_link' };
  const signUp = () =>
    auth.api.signUpEmail({
      body: {
        name,
        email: view.email,
        password: parsed.data.password,
        ...(parsed.data.timezone ? { timezone: parsed.data.timezone } : {}),
      },
      headers: requestHeaders,
      returnHeaders: true,
    });
  let created: Awaited<ReturnType<typeof signUp>>;
  try {
    // With the proof, the address is already known to be theirs: no code email goes out.
    created = proven ? await withoutSignupCode(view.email, signUp) : await signUp();
  } catch (error: unknown) {
    const code = errorCode(error);
    if (code?.startsWith('PASSWORD_')) {
      return { ...fail(errorMessage(error) ?? 'Pick a stronger password.'), field: 'password' };
    }
    if (code === 'USER_ALREADY_EXISTS' || code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
      return { ...fail('An account with this email already exists. Sign in to accept the invite.'), code: 'account_exists' };
    }
    console.error('[portal] joinInviteAction could not make the account', code ?? error);
    return fail(error instanceof APIError ? 'We could not create your account. Try again.' : NO_NETWORK);
  }

  const userId = created.response.user.id;
  const sessionCookie = sessionCookieFrom(created.headers);
  if (!sessionCookie) {
    console.error('[portal] joinInviteAction got no session after sign up');
    return { ok: true, next: `/login?next=${encodeURIComponent(`/invite/${view.id}`)}` };
  }
  // The calls below act as the new person. Only the session token is passed on, so each one reads
  // the person fresh from the database and the cookie they write back is up to date.
  const asNewUser = new Headers(requestHeaders);
  asNewUser.set('cookie', sessionCookie);

  if (proven) await markEmailVerified(userId);

  const failure = await acceptInvitation(view, asNewUser);
  if (failure) {
    // The join was refused after all. Leave nothing behind: no session, no account.
    try {
      await auth.api.signOut({ headers: asNewUser });
    } catch (error: unknown) {
      console.error('[portal] could not sign out after a refused join', errorCode(error) ?? error);
    }
    try {
      const memberships = await db.select({ id: member.id }).from(member).where(eq(member.userId, userId)).limit(1);
      if (memberships.length === 0) await db.delete(user).where(eq(user.id, userId));
    } catch (error: unknown) {
      console.error('[portal] could not remove the account of a refused join', error);
    }
    return failure;
  }

  try {
    await auth.api.setActiveOrganization({ body: { organizationId: view.orgId }, headers: asNewUser });
  } catch (error: unknown) {
    console.error('[portal] could not make the joined organization active', errorCode(error) ?? error);
  }
  revalidatePath('/', 'layout');
  return { ok: true, next: '/' };
}

const changeEmailSchema = z.object({ email: z.string().max(320) });

/**
 * Fixes a typo in the email of an account that was never verified. The account, the organization
 * and the free trial stay as they are; only the address changes, and a new code goes to it. Not
 * possible once the email is verified, and held to a few tries an hour.
 */
export async function changeUnverifiedEmailAction(input: unknown): Promise<SignupActionResult> {
  const session = await getSession();
  if (!session) return fail(SIGN_IN_AGAIN);
  const parsed = changeEmailSchema.safeParse(input);
  const email = parsed.success ? parsed.data.email.trim().toLowerCase() : '';
  const issue = emailIssue(email, 'Enter a valid email.');
  if (issue) return { ...fail(issue), field: 'email' };
  const userId = session.user.id;

  // Read fresh: the cached session can be a few minutes behind.
  const [current] = await db
    .select({ email: user.email, emailVerified: user.emailVerified, name: user.name })
    .from(user)
    .where(eq(user.id, userId));
  if (!current) return fail(SIGN_IN_AGAIN);
  if (current.emailVerified) return fail('This email is already verified, so it cannot be changed here.');
  const oldEmail = current.email.trim().toLowerCase();
  if (email === oldEmail) return { ...fail('That is the address we already have. Type the right one.'), field: 'email' };

  if (!(await enforceRateLimit(db, { key: `billing:signup:change-email:${userId}`, windowSeconds: 3600, max: 3 }))) {
    return fail('You changed your email a few times already. Wait an hour and try again.');
  }
  const requestHeaders = await headers();
  if (!(await allowAnonymous('change-email', requestHeaders, 10))) return fail(TOO_MANY_TRIES);

  // An account made with Google or Microsoft takes its address from that provider.
  const logins = await db.select({ providerId: account.providerId }).from(account).where(eq(account.userId, userId));
  if (logins.some((login) => login.providerId !== 'credential')) {
    return fail('This account signs in with Google or Microsoft, so its email comes from there.');
  }
  const [taken] = await db.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${email}`).limit(1);
  if (taken) return { ...fail('That email already has a KitStak account. Sign in with it instead.'), field: 'email' };

  try {
    const changed = await db.transaction(async (tx) => {
      const updated = await tx
        .update(user)
        .set({ email, updatedAt: new Date() })
        // The guard is in the statement itself: a verified address can never be changed here.
        .where(and(eq(user.id, userId), eq(user.emailVerified, false)))
        .returning({ id: user.id });
      if (updated.length === 0) return false;
      // Codes for the old address are of no use now.
      await tx.delete(verification).where(sql`${verification.identifier} LIKE ${`%${oldEmail}`}`);
      // Receipts went to the old address by default. Move them along, only where this person set it.
      const orgs = await tx.select({ orgId: member.organizationId }).from(member).where(eq(member.userId, userId));
      if (orgs.length > 0) {
        await tx
          .update(billingAccounts)
          .set({ billingEmail: email, updatedAt: new Date() })
          .where(
            and(
              inArray(
                billingAccounts.orgId,
                orgs.map((row) => row.orgId),
              ),
              sql`lower(${billingAccounts.billingEmail}) = ${oldEmail}`,
            ),
          );
      }
      return true;
    });
    if (!changed) return fail('This email is already verified, so it cannot be changed here.');
  } catch (error: unknown) {
    // Someone took the address between the check and the write.
    if ((error as { code?: string } | null)?.code === '23505') {
      return { ...fail('That email already has a KitStak account. Sign in with it instead.'), field: 'email' };
    }
    console.error('[portal] changeUnverifiedEmailAction failed', error);
    return fail('We could not change your email. Try again.');
  }

  try {
    const org = await resolveActiveOrg(session);
    if (org) {
      const label = current.name?.trim() || email;
      await recordAudit(db, {
        orgId: org.id,
        actor: { userId, label },
        action: 'account.email_changed',
        summary: `${label} changed their sign in email before it was verified.`,
        data: { userId },
      });
    }
  } catch (error: unknown) {
    console.error('[portal] could not write the activity line for an email change', error);
  }

  // A fresh cached session (with the new address), then a new code to the new address.
  const fresh = withoutSessionCache(requestHeaders);
  try {
    await auth.api.getSession({ headers: fresh, query: { disableCookieCache: true } });
  } catch (error: unknown) {
    console.error('[portal] could not refresh the session after an email change', errorCode(error) ?? error);
  }
  try {
    await emailCodeApi().sendVerificationOTP({ body: { email, type: 'email-verification' }, headers: fresh });
  } catch (error: unknown) {
    if (errorStatus(error) === 429) {
      revalidatePath('/', 'layout');
      return { ok: true, error: 'Your email is changed. We sent many codes already, so wait 10 minutes, then press Send a new code.' };
    }
    console.error('[portal] could not send a code to the new address', error);
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

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

  if (!view.seatAvailable) return { ...fail(noSeatMessage(view.inviterName)), code: 'no_seat' };

  // The person came from the link in the invite email, which only the invited mailbox has. That
  // proves the address, so it is marked verified and no 6 digit code is ever asked for.
  let requestHeaders = await headers();
  // Read fresh: the rule in the shared sign in layer reads the database too.
  const [fresh] = await db.select({ emailVerified: user.emailVerified }).from(user).where(eq(user.id, session.user.id));
  if (fresh?.emailVerified !== true) {
    // An address nobody has proven yet, and no link from the invite email: the invite stays where
    // it is (review round 4). The link proves the mailbox, and so does the emailed code.
    if (!(await inviteProofValid(view.id, view.email))) return { ...fail(NEEDS_INVITE_LINK), code: 'needs_invite_link' };
    await markEmailVerified(session.user.id);
    // Read the person fresh from the database from here on, so the new cookie says "verified".
    requestHeaders = withoutSessionCache(requestHeaders);
  }
  const failure = await acceptInvitation(view, requestHeaders);
  if (failure) return failure;

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
