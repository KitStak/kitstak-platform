/**
 * Runtime Better Auth instance (email + password, organizations, DB sessions).
 * Server-only. Route handler: `src/app/api/auth/[...all]/route.ts`.
 */
import 'server-only';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { metadataTouchesKitstak, redactOrgMetadata } from '@/server/services/admin-policy';
import { db } from '@/server/db';
import * as schema from '@/server/db/schema';
import { env, isProduction, trustedOrigins } from '@/server/env';
import { sharedAuthOptions } from './options';

function createAuth() {
  return betterAuth({
    ...sharedAuthOptions,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    trustedOrigins: trustedOrigins(),
    database: drizzleAdapter(db, { provider: 'pg', schema, transaction: true }),
    rateLimit: {
      enabled: true,
      storage: 'memory',
      window: 60,
      max: 120,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60 * 10, max: 5 },
        '/forget-password': { window: 60 * 10, max: 5 },
        '/request-password-reset': { window: 60 * 10, max: 5 },
        '/reset-password': { window: 60 * 10, max: 10 },
        '/change-password': { window: 60, max: 5 },
      },
    },
    advanced: {
      ...sharedAuthOptions.advanced,
      useSecureCookies: isProduction(),
      defaultCookieAttributes: {
        ...sharedAuthOptions.advanced.defaultCookieAttributes,
        secure: isProduction(),
      },
    },
    telemetry: { enabled: false },
    // Organization metadata holds KitStak's private org settings + member preferences (admin
    // module). Never expose it through Better Auth's organization endpoints, and never let them
    // overwrite it: KitStak settings are only written through validated, audited /api/v1/admin routes.
    hooks: {
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
    },
    // nextCookies must be the last plugin so Set-Cookie works from Server Actions.
    plugins: [...sharedAuthOptions.plugins, nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

function getAuth(): Auth {
  instance ??= createAuth();
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
