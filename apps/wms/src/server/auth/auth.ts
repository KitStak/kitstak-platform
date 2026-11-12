/**
 * WMS runtime Better Auth instance (blueprint §1.4) — the shared `@kitstak/auth`
 * factory bound to the WMS database. Cookie names (`kitstak.*`), session TTLs, the
 * organization plugin and rate-limit rules are package behaviour shared with CRM, so
 * SSO behaves identically on every origin. WMS adds:
 *
 *  - `passwordCompat`: legacy bcrypt hashes migrated verbatim into `core.account.password`
 *    keep verifying (new hashes are Better Auth scrypt).
 *  - `passwordPolicyPlugin`: company-configurable policy (wms.company_settings
 *    .password_policy) + lockout, with audit rows written to wms.audit_log.
 *  - SSO enforce / break-glass: while Apps › Single sign-on is active and enforced,
 *    password sign-in is refused for non-admins (blueprint §1.4; OIDC provider
 *    registration via genericOAuth is deferred — see /api/auth/sso/start).
 *
 * The database handle is async (postgres-js in production, PGlite locally), so the
 * instance is built lazily per database: `await getWmsAuth()`. Unit tests that mock
 * `@/server/api/db` therefore get an instance bound to their test database.
 * `nextCookies()` stays the LAST plugin (inside the shared factory).
 */
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createAuth, passwordPolicyPlugin, type KitstakAuth } from '@kitstak/auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import {
  account,
  invitation,
  member,
  organization,
  passwordPolicyState,
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

export const SSO_REQUIRED_MESSAGE =
  'Your company signs in with single sign-on. Password sign-in is for administrators only.';

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
};

/** BETTER_AUTH_SECRET (min 32 chars). Fatal in production when missing/short. */
export function betterAuthSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.BETTER_AUTH_SECRET;
  if (secret && secret.length >= MIN_SECRET_LENGTH) return secret;
  if (env.NODE_ENV === 'production') {
    throw new Error('BETTER_AUTH_SECRET is not configured (min 32 chars). Set it in the environment.');
  }
  if (!warnedMissingSecret) {
    warnedMissingSecret = true;
    log.warn('BETTER_AUTH_SECRET missing — using an insecure dev-only derived secret', {
      component: 'auth',
    });
  }
  return createHash('sha256').update('kitstak-dev-fallback-better-auth-secret').digest('hex');
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
 * before /sign-in/email (WMS-local policy, kept out of the shared package):
 *  - inactive WMS users cannot sign in (answered like a wrong password);
 *  - SSO enforce: non-admin password sign-in is refused while SSO is active + enforced
 *    (admin break-glass stays open).
 */
function wmsSignInGate(db: AppDb) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path !== '/sign-in/email') return;
    const email = normalizeEmail((ctx.body as { email?: unknown } | undefined)?.email);
    if (!email) return;
    const [legacy] = await db
      .select({ id: users.id, isActive: users.isActive })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!legacy) return;
    if (!legacy.isActive) {
      throw new APIError('UNAUTHORIZED', { message: 'Invalid email or password' });
    }
    // Lazy import: apps-sso pulls the integrations crypto module; only load it on sign-in.
    const { passwordLoginBlockedBySso } = await import('@/server/repositories/apps-sso');
    if (await passwordLoginBlockedBySso(db, legacy.id)) {
      throw new APIError('FORBIDDEN', { message: SSO_REQUIRED_MESSAGE, code: 'SSO_REQUIRED' });
    }
  });
}

function buildAuth(db: AppDb): KitstakAuth {
  return createAuth({
    db,
    schema: wmsAuthSchema,
    secret: betterAuthSecret(),
    baseURL: baseURL(),
    trustedOrigins: trustedOrigins(),
    useSecureCookies: process.env.NODE_ENV === 'production',
    ...(process.env.AUTH_COOKIE_DOMAIN ? { cookieDomain: process.env.AUTH_COOKIE_DOMAIN } : {}),
    passwordCompat: true,
    hooks: { before: wmsSignInGate(db) },
    extraPlugins: [
      passwordPolicyPlugin({
        loadPolicy: async () => await getPasswordPolicy(db),
        onAuditEvent: async (event) => {
          await writeAudit(db, {
            action: event.action,
            entity: 'user',
            entityId: event.userId ?? event.email,
            userId: event.userId,
            outcome: event.outcome,
            detail: { email: event.email, ...(event.reason ? { reason: event.reason } : {}) },
            ip: event.ip,
            userAgent: event.userAgent,
          });
          if (event.action === 'auth.login' && event.outcome === 'success' && event.userId) {
            const now = new Date();
            await db
              .update(userProfiles)
              .set({ lastLoginAt: now })
              .where(eq(userProfiles.userId, event.userId));
            await db
              .update(users)
              .set({ lastLoginAt: now.toISOString() })
              .where(eq(users.id, event.userId));
          }
        },
      }),
    ],
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
