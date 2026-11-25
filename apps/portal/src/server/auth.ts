/**
 * Runtime Better Auth instance for the portal — thin wrapper over the shared
 * `@kitstak/auth` factory (BLUEPRINT.md §1.1/§6). Cookie names, session TTLs,
 * rate-limit rules and the organization plugin are package behaviour shared with
 * CRM and WMS, so the session cookie minted here works on every origin.
 *
 * Portal keeps sign-up enabled (it is the front door); WMS sets disableSignUp.
 * Server-only. Route handler: `src/app/api/auth/[...all]/route.ts`.
 *
 * Signup and billing additions (docs/billing/CONTRACTS.md section 15.3):
 *  - the billing organization hooks (seat checks, the invite email, the delete guard),
 *  - 6 digit email codes for verification and password reset (the emailOTP plugin),
 *  - Google and Microsoft sign in, only for the providers whose keys are set.
 */
import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { after } from 'next/server';
import { and, eq, isNotNull } from 'drizzle-orm';
import { createAuth, ipAddressFromTrustProxy, isSignInBlocked, type KitstakAuth } from '@kitstak/auth';
import { DEFAULT_PASSWORD_POLICY, validatePassword } from '@kitstak/auth/password-policy';
import { sendEmailNow } from '@kitstak/billing/emails';
import {
  billingOrganizationOptions,
  CODE_SENT_RECENTLY,
  CODE_TRIES_USED_UP,
  codeSentRecentlyMessage,
  countCodeTry,
  reserveCodeSend,
  type CodeKind,
} from '@kitstak/billing/server';
import * as schema from '@kitstak/db/schema';
import { isDevAllowAll } from '@kitstak/entitlements';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { emailOTP } from 'better-auth/plugins';
import { socialProviderConfig } from '@/features/signup/social';
import { knownDevicePlugin, knownDeviceUserIds } from '@/server/known-device';
import { portalUrl } from '@/server/billing/runtime';
import { db } from '@/server/db';
import { env, isProduction, trustedOrigins } from '@/server/env';

const KITSTAK_METADATA_KEY = 'kitstak';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when a metadata write would touch the private `kitstak` section (CRM admin-owned). */
function metadataTouchesKitstak(metadata: unknown): boolean {
  if (typeof metadata === 'string') {
    try {
      const parsed: unknown = JSON.parse(metadata);
      return isObject(parsed) && KITSTAK_METADATA_KEY in parsed;
    } catch {
      return false;
    }
  }
  return isObject(metadata) && KITSTAK_METADATA_KEY in metadata;
}

/** Strips every `metadata` key from organization endpoint responses (depth-limited). */
function redactOrgMetadata<T>(payload: T, depth = 0): T {
  if (depth > 6 || payload === null || typeof payload !== 'object') return payload;
  if (payload instanceof Date) return payload;
  if (Array.isArray(payload)) return payload.map((entry) => redactOrgMetadata(entry, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    out[key] = key === 'metadata' ? null : redactOrgMetadata(value, depth + 1);
  }
  return out as T;
}

/** How long an email code works. The emails and the screens say the same number. */
export const EMAIL_CODE_MINUTES = 10;
const EMAIL_CODE_LENGTH = 6;
/** Wrong guesses allowed per code. After that the code is used up and a new one is needed. */
const EMAIL_CODE_ATTEMPTS = 5;

/** Every path that sends a code to an address. Each one is limited per address, at every door. */
const CODE_SEND_PATHS = new Set([
  '/email-otp/send-verification-otp',
  '/email-otp/request-password-reset',
  '/forget-password/email-otp',
]);
const OTP_RESET_PATH = '/email-otp/reset-password';
const OTP_VERIFY_PATH = '/email-otp/verify-email';
const SIGN_IN_CODE_PATH = '/sign-in/email-otp';
/** Says whether a code is right without using it up. A try like any other. */
const OTP_CHECK_PATH = '/email-otp/check-verification-otp';

function checkedKind(type: string | null): CodeKind | null {
  return type === 'sign-in' || type === 'email-verification' || type === 'forget-password' ? type : null;
}

function bodyText(body: unknown, key: string): string | null {
  if (!isObject(body)) return null;
  const value = body[key];
  return typeof value === 'string' ? value : null;
}

/** The context of a global hook, as far as the code rules need it. */
type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/**
 * True when the caller is known for this address: this browser signed in to that very account
 * before (the signed cookie from `known-device.ts`), or is signed in to it right now. A known
 * caller has counters of its own, so a stranger can never use them up (review round 5).
 */
async function isKnownCaller(ctx: HookContext, email: string): Promise<boolean> {
  try {
    const session = ctx.headers ? await getSessionFromCtx(ctx).catch(() => null) : null;
    if (session?.user.email.trim().toLowerCase() === email) return true;
  } catch {
    // No session to read: the cookie below decides.
  }
  return knownFromHeaders(ctx.headers, email);
}

/** The cookie half of `isKnownCaller`, for code that has request headers only (server actions). */
async function knownFromHeaders(requestHeaders: Headers | null | undefined, email: string): Promise<boolean> {
  try {
    const ids = knownDeviceUserIds(requestHeaders?.get('cookie'), env.BETTER_AUTH_SECRET);
    if (ids.length === 0) return false;
    const [row] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email)).limit(1);
    return row !== undefined && ids.includes(row.id);
  } catch (error: unknown) {
    console.error('[portal] could not tell whether this browser is known', error);
    return false;
  }
}

/**
 * Set while the server signs in a person whose mailbox is already proven in this very request: the
 * proof in the invite link checked out, or the emailed code was just checked (and counted). The
 * code used inside this scope is one the server made a moment ago, so it is not a try at a code.
 */
const mailboxProvenDoor = new AsyncLocalStorage<true>();

/** Set by an action that already asked `reserveEmailCode`, so the send it starts is not counted twice. */
const codeSendReserved = new AsyncLocalStorage<true>();

/** Runs `run` with the per address send limit already taken (see `reserveEmailCode`). */
export function withCodeSendReserved<T>(run: () => Promise<T>): Promise<T> {
  return codeSendReserved.run(true, run);
}

/**
 * Asks the send limit for one code of this kind to this address, as the caller of `requestHeaders`.
 * The actions for signed out people call it BEFORE they answer, so the screen can say the truth:
 * a code is on its way, or the last one is still good and a new one can be asked for in N seconds.
 * The answer is the same whether or not the address has an account.
 */
export async function reserveEmailCode(
  kind: CodeKind,
  email: string,
  requestHeaders: Headers,
): Promise<{ allowed: boolean; retryAfterSeconds: number; message: string }> {
  const address = email.trim().toLowerCase();
  const slot = await reserveCodeSend(db, { email: address, kind, known: await knownFromHeaders(requestHeaders, address) });
  return { ...slot, message: slot.allowed ? '' : codeSentRecentlyMessage(slot.retryAfterSeconds) };
}

function tooMany(code: string, message: string, retryAfterSeconds?: number): APIError {
  return new APIError('TOO_MANY_REQUESTS', { code, message, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) });
}

/** The kind of code a send path mails. null when the path sends none. */
function sendKind(path: string, body: unknown): CodeKind | null {
  if (path === '/email-otp/request-password-reset' || path === '/forget-password/email-otp') return 'forget-password';
  if (path !== '/email-otp/send-verification-otp') return null;
  const type = bodyText(body, 'type');
  return type === 'sign-in' || type === 'email-verification' || type === 'forget-password' ? type : null;
}

/**
 * Rules for the email code endpoints. They sit in the global hooks so they hold for the HTTP
 * routes and for `auth.api` calls from server actions alike. The numbers and the reasons are in
 * `@kitstak/billing/server` code-limits.ts.
 */
async function guardEmailCodes(ctx: HookContext): Promise<void> {
  const path = ctx.path;
  const body: unknown = ctx.body;
  // Signing in with an emailed code ("Email me a code instead", review round 3) has one door: the
  // two server actions in `signup-actions.ts`, which run inside `withSignInCode`. They check that
  // the account may sign in at all, count every try, and never say whether an address has an
  // account. The raw endpoints stay closed, so none of that can be skipped by calling them directly.
  const viaAction = signInCodeDoor.getStore() === true;
  if (path === SIGN_IN_CODE_PATH && !viaAction) throw new APIError('NOT_FOUND', { message: 'Not found' });
  if (path === '/email-otp/send-verification-otp' && bodyText(body, 'type') === 'sign-in' && !viaAction) {
    throw new APIError('BAD_REQUEST', { message: 'Sign in with your password.' });
  }

  // Every try at a code is counted for its address: 5 tries per code, and on top of that a count
  // per 10 minutes and per day. A caller this account knows has counts of its own.
  const tryKind: CodeKind | null =
    path === SIGN_IN_CODE_PATH
      ? 'sign-in'
      : path === OTP_RESET_PATH
        ? 'forget-password'
        : path === OTP_VERIFY_PATH
          ? 'email-verification'
          : path === OTP_CHECK_PATH
            ? checkedKind(bodyText(body, 'type'))
            : null;
  if (tryKind !== null && mailboxProvenDoor.getStore() !== true) {
    const email = bodyText(body, 'email')?.trim().toLowerCase();
    if (email) {
      const tries = await countCodeTry(db, { email, kind: tryKind, known: await isKnownCaller(ctx, email) });
      if (!tries.allowed) throw tooMany(CODE_TRIES_USED_UP, tries.message);
    }
  }

  // Every send of a code is spaced per address and per kind of code. It slows down and never
  // becomes a wall for a day (review round 5). Counted whether or not the address has an account,
  // so the answer gives nothing away.
  if (CODE_SEND_PATHS.has(path) && codeSendReserved.getStore() !== true) {
    const email = bodyText(body, 'email')?.trim().toLowerCase();
    const kind = sendKind(path, body);
    if (email && kind) {
      const slot = await reserveCodeSend(db, { email, kind, known: await isKnownCaller(ctx, email) });
      if (!slot.allowed) throw tooMany(CODE_SENT_RECENTLY, codeSentRecentlyMessage(slot.retryAfterSeconds), slot.retryAfterSeconds);
    }
  }

  // The shared password policy plugin guards /sign-up, /change-password and /reset-password. The
  // reset by code path carries the new password in `password`, so it is checked here with the
  // same rules. Without this a reset could set a password that signup would refuse.
  if (path === OTP_RESET_PATH) {
    const password = bodyText(body, 'password');
    if (password === null) return;
    const email = bodyText(body, 'email')?.trim().toLowerCase();
    const issues = validatePassword(password, DEFAULT_PASSWORD_POLICY, email ? { email } : {});
    if (issues.length > 0) {
      throw new APIError('BAD_REQUEST', { code: 'PASSWORD_POLICY', message: issues.join(' ') });
    }
  }
}

/**
 * A person who proved they own the mailbox and set a new password is let back in at once. The
 * lockout from earlier wrong guesses would otherwise refuse the brand new password for 15 minutes.
 */
async function clearLockoutAfterReset(body: unknown): Promise<void> {
  const email = bodyText(body, 'email')?.trim().toLowerCase();
  if (!email) return;
  try {
    await db
      .update(schema.password_policy_state)
      .set({ failedLoginCount: 0, lockedUntil: null })
      .where(eq(schema.password_policy_state.email, email));
  } catch (error: unknown) {
    console.error('[portal] could not clear the sign in lockout after a password reset', error);
  }
}

/**
 * A person who makes their account from the link in an invite email has already shown they own that
 * mailbox (the link carries a proof only that mailbox has). Their signup runs inside this scope, and
 * the signup code for that one address is not mailed. Nothing else is switched off.
 */
const signupCodeOff = new AsyncLocalStorage<{ readonly email: string }>();

/** Runs `run` with the signup verification email for `email` switched off. */
export function withoutSignupCode<T>(email: string, run: () => Promise<T>): Promise<T> {
  return signupCodeOff.run({ email: email.trim().toLowerCase() }, run);
}

/**
 * The one door for signing in with an emailed code. Only code that runs inside this scope may ask
 * for a sign in code or sign in with one (see `guardEmailCodes`).
 */
const signInCodeDoor = new AsyncLocalStorage<true>();

/** Runs `run` with the sign in code endpoints open. Used by the two server actions only. */
export function withSignInCode<T>(run: () => Promise<T>): Promise<T> {
  return signInCodeDoor.run(true, run);
}

/**
 * True when this address may sign in with an emailed code: the account exists and is not switched
 * off.
 *
 * It used to ask for a password row (review round 3), because "no password row" was how a person
 * was switched off. That broke the second code sign in: the first one removes the password of an
 * account whose email was never proven (Better Auth does this on purpose, so nobody keeps a
 * password they set on someone else's address), and from then on no code was ever mailed, while the
 * screen said one was on its way (review round 4). Being switched off is now a fact of its own
 * (`core.sign_in_blocks`, read by the shared sign in layer at every door), so a person with no
 * password row can sign in with a code as often as they like.
 */
export async function maySignInWithCode(email: string): Promise<boolean> {
  const address = email.trim().toLowerCase();
  const [row] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, address)).limit(1);
  if (!row) return false;
  return !(await isSignInBlocked(db, row.id));
}

/** True when the account with this address has a password of its own (a `core.account` password row). */
export async function hasPassword(email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.account.id })
    .from(schema.account)
    .innerJoin(schema.user, eq(schema.account.userId, schema.user.id))
    .where(and(eq(schema.user.email, email.trim().toLowerCase()), eq(schema.account.providerId, 'credential'), isNotNull(schema.account.password)))
    .limit(1);
  return row !== undefined;
}

/** After a person proved they own the mailbox: wrong password guesses from before no longer lock them out. */
export async function clearSignInLockout(email: string): Promise<void> {
  await clearLockoutAfterReset({ email });
}

/** The mail settings from the checked env, so a blank line in an env file never counts as a key. */
function mailEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: env.NODE_ENV,
    EMAIL_PROVIDER: env.EMAIL_PROVIDER,
    RESEND_API_KEY: env.RESEND_API_KEY,
    EMAIL_FROM: env.EMAIL_FROM,
    EMAIL_REPLY_TO: env.EMAIL_REPLY_TO,
  } as NodeJS.ProcessEnv;
}

/**
 * Sends the 6 digit code. Three kinds of code are mailed: verify an address, reset a password, and
 * sign in (only through `withSignInCode`). The send runs after the response when it can, so the answer takes the same time
 * whether or not the address has an account.
 */
async function sendVerificationOTP(data: { email: string; otp: string; type: string }): Promise<void> {
  // A sign in code is the same 6 digit code email, with one sentence that says what it is for.
  const signIn = data.type === 'sign-in';
  const template =
    data.type === 'email-verification' || signIn ? 'verify_email' : data.type === 'forget-password' ? 'reset_password' : null;
  if (template === null) return;
  if (template === 'verify_email' && signupCodeOff.getStore()?.email === data.email.trim().toLowerCase()) return;
  const send = async (): Promise<void> => {
    try {
      // A code a person is waiting for goes out at once (CONTRACTS 13.2), not with the one minute
      // job. If the mail provider is down the row stays queued and the job sends it a little later.
      const sent = await sendEmailNow(
        db,
        {
          orgId: null,
          to: data.email,
          template,
          payload: { code: data.otp, minutes: EMAIL_CODE_MINUTES, ...(signIn ? { purpose: 'sign_in' as const } : {}) },
          // Every code is its own email. The key never holds the code itself.
          dedupeKey: `code:${template}:${data.email.toLowerCase()}:${Date.now()}`,
        },
        {
          // The validated env, so a blank line in an env file never counts as a key.
          env: mailEnv(),
        },
      );
      if (!sent.ok) console.error(`[portal] the ${template} email is not out yet: ${sent.error ?? 'no detail'}`);
    } catch (error: unknown) {
      console.error(`[portal] could not send the ${template} email`, error);
    }
  };
  try {
    after(send);
  } catch {
    // Not inside a request (a script or a test): send right now.
    await send();
  }
}

/**
 * Organization metadata holds KitStak's private org settings (managed by CRM's audited
 * admin routes). The portal mounts the same Better Auth organization endpoints, so the
 * same policy applies here: never let them write it, never expose it (CRM auth.ts parity).
 * The same hooks carry the rules for email codes (see `guardEmailCodes`).
 */
const kitstakOrgMetadataHooks = {
  before: createAuthMiddleware(async (ctx) => {
    await guardEmailCodes(ctx);
    if (!ctx.path.startsWith('/organization/')) return;
    const body = (ctx.body ?? {}) as { data?: { metadata?: unknown }; metadata?: unknown };
    if (ctx.path === '/organization/update' && body.data?.metadata !== undefined) {
      throw new APIError('FORBIDDEN', {
        message: 'Organization metadata is managed by KitStak admin settings',
      });
    }
    if (ctx.path === '/organization/create' && metadataTouchesKitstak(body.metadata)) {
      throw new APIError('FORBIDDEN', { message: 'The kitstak metadata key is reserved' });
    }
  }),
  after: createAuthMiddleware(async (ctx) => {
    if (ctx.path === OTP_RESET_PATH && !(ctx.context.returned instanceof Error)) {
      await clearLockoutAfterReset(ctx.body);
      return;
    }
    if (!ctx.path.startsWith('/organization')) return;
    const returned = ctx.context.returned;
    if (
      !returned ||
      typeof returned !== 'object' ||
      returned instanceof Response ||
      returned instanceof Error
    )
      return;
    return ctx.json(redactOrgMetadata(returned));
  }),
};

/**
 * The email code plugin. `overrideDefaultEmailVerification` is left off on purpose: with it on, the
 * code on signup is only sent when the base `emailVerification.sendOnSignUp` option is set, and the
 * shared factory does not set it. Left off, the plugin sends the code itself right after signup.
 */
function emailCodePlugin() {
  return emailOTP({
    otpLength: EMAIL_CODE_LENGTH,
    expiresIn: EMAIL_CODE_MINUTES * 60,
    allowedAttempts: EMAIL_CODE_ATTEMPTS,
    sendVerificationOnSignUp: true,
    disableSignUp: true,
    sendVerificationOTP,
  });
}

function buildAuth(): KitstakAuth {
  const ipAddress = ipAddressFromTrustProxy(env.TRUST_PROXY);
  // Google and Microsoft sign in exist only for the providers whose id and secret are both set.
  const socialProviders = socialProviderConfig(env);
  return createAuth({
    db,
    schema,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: trustedOrigins(),
    useSecureCookies: isProduction(),
    ...(env.AUTH_COOKIE_DOMAIN ? { cookieDomain: env.AUTH_COOKIE_DOMAIN } : {}),
    ...(ipAddress ? { ipAddress } : {}),
    hooks: kitstakOrgMetadataHooks,
    // Seat checks, the invite email and the delete guard, the same as in every other app.
    organization: billingOrganizationOptions({
      db,
      portalUrl: portalUrl(),
      allowAll: isDevAllowAll,
      // Lets the invite link prove the mailbox, so an invited person is not asked for a code.
      inviteSecret: env.BETTER_AUTH_SECRET,
      // The invite email goes out at once, with the checked mail settings.
      emailEnv: mailEnv(),
    }),
    // The known device cookie is written at every new session (see `known-device.ts`).
    extraPlugins: [emailCodePlugin(), knownDevicePlugin({ secret: env.BETTER_AUTH_SECRET, secure: isProduction() })],
    ...(socialProviders ? { socialProviders } : {}),
  });
}

export type Auth = KitstakAuth;

let instance: Auth | undefined;

function getAuth(): Auth {
  instance ??= buildAuth();
  return instance;
}

/**
 * Lazily-initialised auth handle. Construction reads the server environment, so it must not
 * happen at import time: `next build` imports every route module, and a build has no secrets.
 */
export const auth: Auth = new Proxy({} as Auth, {
  get(_target, property) {
    return Reflect.get(getAuth(), property);
  },
  has(_target, property) {
    return property in getAuth();
  },
});

export type AuthSession = typeof auth.$Infer.Session;
export type AuthUser = AuthSession['user'];

/**
 * The email code endpoints, typed. The shared factory takes extra plugins as a plain list, so
 * their endpoints are on `auth.api` at run time but not in its type. This is the typed view.
 */
export type EmailCodeApi = Pick<
  ReturnType<typeof emailOTP>['endpoints'],
  | 'sendVerificationOTP'
  | 'verifyEmailOTP'
  | 'requestPasswordResetEmailOTP'
  | 'resetPasswordEmailOTP'
  | 'signInEmailOTP'
  | 'checkVerificationOTP'
  | 'createVerificationOTP'
>;

export function emailCodeApi(): EmailCodeApi {
  return getAuth().api as unknown as EmailCodeApi;
}

/* ===== joining from an invite with no password (review round 5) ===== */

/** A fresh sign in code for this address, made on the server and not mailed. Older ones are dropped. */
async function newSignInCode(email: string): Promise<string> {
  const address = email.trim().toLowerCase();
  const context = await getAuth().$context;
  await context.internalAdapter.deleteVerificationByIdentifier(`sign-in-otp-${address}`);
  return emailCodeApi().createVerificationOTP({ body: { email: address, type: 'sign-in' } });
}

/**
 * Mails a 6 digit code to an invited address that has no account yet. The normal send skips an
 * address with no account, so this makes the code itself. The caller checks the invitation and the
 * send limit first (`reserveEmailCode`).
 */
export async function mailInviteJoinCode(email: string): Promise<void> {
  const address = email.trim().toLowerCase();
  await sendVerificationOTP({ email: address, otp: await newSignInCode(address), type: 'sign-in' });
}

/**
 * Makes an account with a proven email and no password, for a person who joins from an invite.
 * They sign in with an emailed code from then on, and can set a password on their account page.
 * Only call it after the mailbox is proven (the invite link's proof, or the emailed code).
 */
export async function createCodeOnlyUser(input: { name: string; email: string; timezone?: string }): Promise<string> {
  const context = await getAuth().$context;
  const created = await context.internalAdapter.createUser(
    {
      name: input.name,
      email: input.email.trim().toLowerCase(),
      emailVerified: true,
      ...(input.timezone ? { timezone: input.timezone } : {}),
    },
    // The same source the email code plugin names when it makes an account.
    { method: 'email-otp' },
  );
  return created.id;
}

/**
 * Signs in a person whose mailbox is proven in this request, and answers with the response headers
 * (they carry the new session cookie). With `code`, the emailed code they typed is used up here.
 * Without, the server makes a code and uses it at once: nothing is mailed and nothing is guessed.
 */
export async function signInProvenMailbox(input: { email: string; code?: string; headers: Headers }): Promise<Headers> {
  const email = input.email.trim().toLowerCase();
  const otp = input.code ?? (await newSignInCode(email));
  const signedIn = await mailboxProvenDoor.run(true, () =>
    withSignInCode(() => emailCodeApi().signInEmailOTP({ body: { email, otp }, headers: input.headers, returnHeaders: true })),
  );
  return signedIn.headers;
}
