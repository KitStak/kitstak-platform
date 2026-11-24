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
import { createAuth, ipAddressFromTrustProxy, type KitstakAuth } from '@kitstak/auth';
import { DEFAULT_PASSWORD_POLICY, validatePassword } from '@kitstak/auth/password-policy';
import { sendEmailNow } from '@kitstak/billing/emails';
import { billingOrganizationOptions, enforceRateLimit } from '@kitstak/billing/server';
import * as schema from '@kitstak/db/schema';
import { isDevAllowAll } from '@kitstak/entitlements';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { emailOTP } from 'better-auth/plugins';
import { socialProviderConfig } from '@/features/signup/social';
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
const SIGN_IN_CODE_PATH = '/sign-in/email-otp';
// The short limit has a 10 minute window, so the wait it names is true.
const TOO_MANY_TRIES = 'Too many tries. Wait 10 minutes and try again.';
const TOO_MANY_TODAY = 'We sent many codes to this address today. Try again tomorrow.';

function bodyText(body: unknown, key: string): string | null {
  if (!isObject(body)) return null;
  const value = body[key];
  return typeof value === 'string' ? value : null;
}

/**
 * Rules for the email code endpoints. They sit in the global hooks so they hold for the HTTP
 * routes and for `auth.api` calls from server actions alike.
 */
async function guardEmailCodes(path: string, body: unknown): Promise<void> {
  // Signing in with an emailed code ("Email me a code instead", review round 3) has one door: the
  // two server actions in `signup-actions.ts`, which run inside `withSignInCode`. They check that
  // the account may sign in at all, count every try, and never say whether an address has an
  // account. The raw endpoints stay closed, so none of that can be skipped by calling them directly.
  const viaAction = signInCodeDoor.getStore() === true;
  if (path === SIGN_IN_CODE_PATH) {
    if (!viaAction) throw new APIError('NOT_FOUND', { message: 'Not found' });
    const email = bodyText(body, 'email')?.trim().toLowerCase();
    if (email) {
      // A 6 digit code has a million values. Each code allows 5 guesses; on top of that, one address
      // gets 10 tries per 10 minutes and 30 per day, right or wrong. A guesser gets nowhere, and the
      // owner of the mailbox sees the code emails arrive.
      const short = await enforceRateLimit(db, { key: `billing:code-signin:${email}`, windowSeconds: 600, max: 10 });
      const day = await enforceRateLimit(db, { key: `billing:code-signin-day:${email}`, windowSeconds: 86_400, max: 30 });
      if (!short || !day) throw new APIError('TOO_MANY_REQUESTS', { code: 'RATE_LIMITED', message: TOO_MANY_TRIES });
    }
  }
  if (path === '/email-otp/send-verification-otp' && bodyText(body, 'type') === 'sign-in' && !viaAction) {
    throw new APIError('BAD_REQUEST', { message: 'Sign in with your password.' });
  }

  if (CODE_SEND_PATHS.has(path)) {
    const email = bodyText(body, 'email')?.trim().toLowerCase();
    if (!email) return;
    // SPEC 12 item 6: 5 code sends per 10 minutes for one address. A day cap on top keeps a patient
    // guesser from getting thousands of tries at a 6 digit code. Both count whether or not the
    // address has an account, so the answer gives nothing away.
    const short = await enforceRateLimit(db, { key: `billing:code:${email}`, windowSeconds: 600, max: 5 });
    const day = await enforceRateLimit(db, { key: `billing:code-day:${email}`, windowSeconds: 86_400, max: 20 });
    if (!short || !day) throw new APIError('TOO_MANY_REQUESTS', { code: 'RATE_LIMITED', message: day ? TOO_MANY_TRIES : TOO_MANY_TODAY });
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
 * True when this address may sign in with an emailed code: the account exists and still holds a
 * credential. Deactivating a person removes that credential row on purpose (auth review
 * 2026-11-11, H3), so a deactivated person gets no code and cannot sign in with one.
 */
export async function maySignInWithCode(email: string): Promise<boolean> {
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
          env: {
            NODE_ENV: env.NODE_ENV,
            EMAIL_PROVIDER: env.EMAIL_PROVIDER,
            RESEND_API_KEY: env.RESEND_API_KEY,
            EMAIL_FROM: env.EMAIL_FROM,
            EMAIL_REPLY_TO: env.EMAIL_REPLY_TO,
          } as NodeJS.ProcessEnv,
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
    await guardEmailCodes(ctx.path, ctx.body);
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
    }),
    extraPlugins: [emailCodePlugin()],
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
  'sendVerificationOTP' | 'verifyEmailOTP' | 'requestPasswordResetEmailOTP' | 'resetPasswordEmailOTP' | 'signInEmailOTP'
>;

export function emailCodeApi(): EmailCodeApi {
  return getAuth().api as unknown as EmailCodeApi;
}
