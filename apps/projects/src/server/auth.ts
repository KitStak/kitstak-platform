/**
 * Runtime Better Auth instance for KitStak Projects — thin wrapper over the shared
 * `@kitstak/auth` factory (BLUEPRINT.md §1.1/§6). Cookie names, session TTLs,
 * rate-limit rules and the organization plugin are package behaviour shared with
 * CRM and WMS, so the session cookie minted here works on every origin.
 *
 * Sign-up stays on the portal (the front door): this app sets disableSignUp.
 * Server-only. Route handler: `src/app/api/auth/[...all]/route.ts`.
 */
import 'server-only';
import { createAuth, ipAddressFromTrustProxy, type KitstakAuth } from '@kitstak/auth';
import * as schema from '@kitstak/db/schema';
import { APIError, createAuthMiddleware } from 'better-auth/api';
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

/**
 * Organization metadata holds KitStak's private org settings (managed by CRM's audited
 * admin routes). This app mounts the same Better Auth organization endpoints, so the
 * same policy applies here: never let them write it, never expose it (CRM auth.ts parity).
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
    // Accounts are created on the portal; Projects only signs people in.
    disableSignUp: true,
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
