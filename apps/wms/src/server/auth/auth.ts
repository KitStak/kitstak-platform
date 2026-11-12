/**
 * WMS runtime Better Auth instance (blueprint §1.4) — the shared `@kitstak/auth`
 * factory bound to the WMS database. Cookie names (`kitstak.*`), session TTLs, the
 * organization plugin, rate-limit rules, the bcrypt password-compat hasher and the
 * password-policy/lockout plugin are package behaviour shared with CRM (auth review
 * 2026-11-11 H1/M1: those invariants live in the factory, not per instance), so SSO
 * behaves identically on every origin. WMS adds:
 *
 *  - `disableSignUp` (auth review C1): WMS has no self-registration — users are
 *    provisioned by admins; `POST /api/auth/sign-up/email` answers 4xx here.
 *  - the policy loader (wms.company_settings.password_policy) and the audit sink
 *    writing wms.audit_log rows, injected into the factory's policy plugin.
 *  - `wmsSignInGate`: inactive-user refusal, SSO enforce / break-glass, and a block on
 *    Better Auth's own /change-password + /update-user (auth review M3) — password
 *    changes must go through the guarded /api/account/password route (Postgres rate
 *    limit, audit, wms mirrors, lockout clear).
 *
 * The database handle is async (postgres-js in production, PGlite locally), so the
 * instance is built lazily per database: `await getWmsAuth()`. Unit tests that mock
 * `@/server/api/db` therefore get an instance bound to their test database.
 * `nextCookies()` stays the LAST plugin (inside the shared factory).
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { burnDummyPasswordVerify, createAuth, ipAddressFromTrustProxy, type KitstakAuth } from '@kitstak/auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import {
  account,
  invitation,
  member,
  organization,
  passwordPolicyState,
  rateLimit,
  session,
  team,
  teamMember,
  user,
  userProfiles,
  verification,
} from '@kitstak/db/schema';
import { getAppDb, type AppDb } from '@/server/api/db';
import { users } from '@/server/db/schema';
import { log } from '@/server/log';
import { writeAudit } from './audit';
import { getPasswordPolicy } from './password-policy';

const MIN_SECRET_LENGTH = 32;
let warnedMissingSecret = false;

/** Drizzle schema objects the Better Auth adapter needs (shared `core` tables). */
export const wmsAuthSchema = {
  user,
  session,
  account,
  verification,
  organization,
  member,
  team,
  teamMember,
  invitation,
  passwordPolicyState,
  // The drizzle adapter resolves plugin models by their mapped model name.
  password_policy_state: passwordPolicyState,
  // Better Auth database rate-limit storage (auth review M4) — model `rateLimit`.
  rateLimit,
};

let devSecret: string | null = null;

/**
 * Dev-only fallback secret (auth review 2026-11-11, M2): a per-install RANDOM secret
 * persisted to the gitignored `.data/` directory, never a repo-constant digest that is
 * identical across installs (and would let anyone forge the signed cookie-cache payload
 * on previews/LAN-exposed dev servers). If `.data` is unwritable, the secret is held in
 * memory for this process only.
 */
function devFallbackSecret(): string {
  if (devSecret) return devSecret;
  const dir = path.join(process.cwd(), '.data');
  const file = path.join(dir, 'better-auth-dev-secret');
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (existing.length >= MIN_SECRET_LENGTH) {
      devSecret = existing;
      return devSecret;
    }
  } catch {
    // first run (or unreadable) — generate below
  }
  const generated = randomBytes(48).toString('base64url');
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, generated, { mode: 0o600 });
  } catch {
    // unwritable filesystem: per-process secret only (sessions reset on restart)
  }
  devSecret = generated;
  return devSecret;
}

/** BETTER_AUTH_SECRET (min 32 chars). Refuses to start in production when missing/short. */
export function betterAuthSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.BETTER_AUTH_SECRET;
  if (secret && secret.length >= MIN_SECRET_LENGTH) return secret;
  if (env.NODE_ENV === 'production') {
    throw new Error('BETTER_AUTH_SECRET is not configured (min 32 chars). Set it in the environment.');
  }
  if (!warnedMissingSecret) {
    warnedMissingSecret = true;
    log.warn('BETTER_AUTH_SECRET missing — using a per-install random dev secret (.data)', {
      component: 'auth',
    });
  }
  return devFallbackSecret();
}

function baseURL(): string {
  return process.env.BETTER_AUTH_URL?.trim() || 'http://localhost:3000';
}

/** TRUSTED_ORIGINS (comma list of portal + CRM + WMS origins) plus this app's own origin. */
export function trustedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const fromEnv = (env.TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return [...new Set([baseURL().replace(/\/+$/, ''), ...fromEnv])];
}

function normalizeEmail(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value.trim().toLowerCase() : null;
}

/**
 * Better Auth endpoints the WMS instance refuses (auth review M3): the catch-all would
 * otherwise serve /change-password with only in-memory limiting, no lockout coverage and
 * none of the WMS mirrors/audit. /update-user is blocked alongside (email-adjacent
 * fields are managed by the admin module).
 */
const BLOCKED_BETTER_AUTH_PATHS = new Set(['/change-password', '/update-user']);

export const USE_ACCOUNT_ENDPOINT_MESSAGE =
  'This endpoint is disabled. Change your password at /api/account/password.';

/**
 * before hook (WMS-local policy, kept out of the shared package):
 *  - /change-password and /update-user are 403 (see BLOCKED_BETTER_AUTH_PATHS);
 *  - inactive WMS users cannot sign in;
 *  - SSO enforce: non-admin password sign-in is refused while SSO is active + enforced
 *    (admin break-glass stays open).
 * Both sign-in refusals answer with the GENERIC invalid-credentials error (auth review
 * M5 — a distinct message/code is an account-state oracle); the specific reason goes to
 * wms.audit_log only.
 */
function wmsSignInGate(db: AppDb) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path && BLOCKED_BETTER_AUTH_PATHS.has(ctx.path)) {
      throw new APIError('FORBIDDEN', {
        message: USE_ACCOUNT_ENDPOINT_MESSAGE,
        code: 'USE_ACCOUNT_ENDPOINT',
      });
    }
    if (ctx.path !== '/sign-in/email') return;
    const email = normalizeEmail((ctx.body as { email?: unknown } | undefined)?.email);
    if (!email) return;
    const [legacy] = await db
      .select({ id: users.id, isActive: users.isActive })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!legacy) return;
    const genericRejection = (reason: string): APIError => {
      // Audit first (best effort), then the uniform refusal.
      void writeAudit(db, {
        action: 'auth.login',
        entity: 'user',
        entityId: legacy.id,
        userId: legacy.id,
        outcome: 'failure',
        detail: { email, reason },
        ip: ctx.headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        userAgent: ctx.headers?.get('user-agent') ?? null,
      }).catch(() => undefined);
      return new APIError('UNAUTHORIZED', {
        message: 'Invalid email or password',
        code: 'INVALID_EMAIL_OR_PASSWORD',
      });
    };
    const password = (ctx.body as { password?: unknown } | undefined)?.password;
    if (!legacy.isActive) {
      // NEW-5: this gate rejects before Better Auth ever hashes anything, so a fast
      // answer is a timing oracle separating "inactive account" from "wrong password"
      // (which costs a full scrypt verify). Burn one dummy KDF run before throwing.
      await burnDummyPasswordVerify(password);
      throw genericRejection('user_inactive');
    }
    // Lazy import: apps-sso pulls the integrations crypto module; only load it on sign-in.
    const { passwordLoginBlockedBySso } = await import('@/server/repositories/apps-sso');
    if (await passwordLoginBlockedBySso(db, legacy.id)) {
      // NEW-5: same timing equalizer as the inactive-user rejection above.
      await burnDummyPasswordVerify(password);
      throw genericRejection('sso_required');
    }
  });
}

function buildAuth(db: AppDb): KitstakAuth {
  const ipAddress = ipAddressFromTrustProxy(process.env.TRUST_PROXY);
  return createAuth({
    db,
    schema: wmsAuthSchema,
    secret: betterAuthSecret(),
    baseURL: baseURL(),
    trustedOrigins: trustedOrigins(),
    useSecureCookies: process.env.NODE_ENV === 'production',
    ...(process.env.AUTH_COOKIE_DOMAIN ? { cookieDomain: process.env.AUTH_COOKIE_DOMAIN } : {}),
    // Auth review C1: no self-registration on WMS — admins provision every user.
    disableSignUp: true,
    // NEW-3: Better Auth's rate-limit/session IP resolution mirrors the clientIp()
    // trust decision (TRUST_PROXY env); see ipAddressFromTrustProxy for the contract.
    ...(ipAddress ? { ipAddress } : {}),
    hooks: { before: wmsSignInGate(db) },
    passwordPolicy: {
      loadPolicy: async () => await getPasswordPolicy(db),
      onAuditEvent: async (event) => {
        // NEW-4: the subject can be a core-only identity (e.g. a CRM-provisioned user
        // with no wms.users row). audit_log.user_id FKs wms.users, so inserting that id
        // would fail and DROP the event — write userId null instead; the email stays in
        // `detail` so the row remains attributable.
        const wmsUserId = event.userId
          ? ((
              await db.select({ id: users.id }).from(users).where(eq(users.id, event.userId)).limit(1)
            )[0]?.id ?? null)
          : null;
        await writeAudit(db, {
          action: event.action,
          entity: 'user',
          entityId: wmsUserId ?? event.email,
          userId: wmsUserId,
          outcome: event.outcome,
          detail: { email: event.email, ...(event.reason ? { reason: event.reason } : {}) },
          ip: event.ip,
          userAgent: event.userAgent,
        });
        if (event.action === 'auth.login' && event.outcome === 'success' && wmsUserId) {
          const now = new Date();
          await db
            .update(userProfiles)
            .set({ lastLoginAt: now })
            .where(eq(userProfiles.userId, wmsUserId));
          await db
            .update(users)
            .set({ lastLoginAt: now.toISOString() })
            .where(eq(users.id, wmsUserId));
        }
      },
    },
  });
}

export type WmsAuth = KitstakAuth;

/** One instance per database handle (tests swap databases; production has one). */
const instances = new WeakMap<object, WmsAuth>();

export async function getWmsAuth(): Promise<WmsAuth> {
  const db = await getAppDb();
  let auth = instances.get(db as object);
  if (!auth) {
    auth = buildAuth(db);
    instances.set(db as object, auth);
  }
  return auth;
}
