/**
 * Runtime Better Auth instance (email + password, organizations, DB sessions).
 * Thin wrapper over the shared `@kitstak/auth` factory (blueprint §1.3): CRM supplies its
 * Drizzle db/schema, env-derived secrets/origins and the org-metadata guard hooks; cookie
 * names, session TTLs, rate-limit rules and the organization plugin are package behaviour
 * shared with every KitStak app (`nextCookies()` stays the last plugin inside the factory).
 * Server-only. Route handler: `src/app/api/auth/[...all]/route.ts`.
 */
import 'server-only';
import { createAuth, ipAddressFromTrustProxy, type KitstakAuth } from '@kitstak/auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { metadataTouchesKitstak, redactOrgMetadata } from '@/server/services/admin-policy';
import { db } from '@/server/db';
import * as schema from '@/server/db/schema';
import { env, isProduction, trustedOrigins } from '@/server/env';

/**
 * Organization metadata holds KitStak's private org settings + member preferences (admin
 * module). Never expose it through Better Auth's organization endpoints, and never let them
 * overwrite it: KitStak settings are only written through validated, audited /api/v1/admin routes.
 * CRM-specific policy, so it is passed into the shared factory rather than baked into it.
 */
const kitstakOrgMetadataHooks = {
  before: createAuthMiddleware(async (ctx) => {
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

function buildAuth(): KitstakAuth {
  // NEW-3: Better Auth's rate-limit/session IP resolution follows TRUST_PROXY (same
  // contract as WMS clientIp). On Vercel the defaults are safe; behind nginx/CF set
  // trusted proxies or the shared core.rate_limit bucket 429s everyone.
  const ipAddress = ipAddressFromTrustProxy(env.TRUST_PROXY);
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
