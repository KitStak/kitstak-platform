/**
 * Shared Better Auth factory (blueprint §1.1 `create-auth.ts`; extracted from
 * `apps/crm/src/server/auth/auth.ts`). Each app passes its own Drizzle db + schema,
 * secrets, origins, and app-specific hooks/plugins; everything else (cookies, session
 * TTLs, organization plugin, rate-limit rules) is shared so SSO behaves identically
 * on every origin.
 *
 * Invariant: `nextCookies()` must stay the LAST plugin so Set-Cookie works from
 * Server Actions (CRM invariant, preserved here).
 */
import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { sharedAuthOptions } from './options';
import { createPasswordCompat, type PasswordCompatOptions } from './password-compat';

type DrizzleDb = Parameters<typeof drizzleAdapter>[0];
type DrizzleSchema = Parameters<typeof drizzleAdapter>[1]['schema'];

export interface CreateAuthOptions {
  /** The app's Drizzle database instance (pg or postgres-js driver). */
  readonly db: DrizzleDb;
  /** Drizzle schema objects containing the Better Auth tables. */
  readonly schema: DrizzleSchema;
  readonly secret: string;
  /** The app's own origin (`BETTER_AUTH_URL`). */
  readonly baseURL: string;
  /** All sibling origins (portal + CRM + WMS). */
  readonly trustedOrigins: string[];
  /** Prod only (`.kitstak.io`) → enables `crossSubDomainCookies`. Unset in dev. */
  readonly cookieDomain?: string;
  /** Defaults to `baseURL` starting with `https://` (matches CRM's isProduction gate). */
  readonly useSecureCookies?: boolean;
  /** App-specific plugins, inserted between the organization plugin and `nextCookies()`. */
  readonly extraPlugins?: BetterAuthPlugin[];
  /** App-specific global hooks (e.g. CRM's org-metadata guards — not baked in here). */
  readonly hooks?: BetterAuthOptions['hooks'];
  /** Enables the bcrypt legacy-hash verifier (WMS migration). Off by default. */
  readonly passwordCompat?: boolean | PasswordCompatOptions;
}

export function createAuth(options: CreateAuthOptions) {
  const secure = options.useSecureCookies ?? options.baseURL.startsWith('https://');
  const passwordCompat =
    options.passwordCompat === undefined || options.passwordCompat === false
      ? undefined
      : createPasswordCompat(options.passwordCompat === true ? {} : options.passwordCompat);
  return betterAuth({
    ...sharedAuthOptions,
    ...(passwordCompat
      ? { emailAndPassword: { ...sharedAuthOptions.emailAndPassword, password: passwordCompat } }
      : {}),
    secret: options.secret,
    baseURL: options.baseURL,
    basePath: '/api/auth',
    trustedOrigins: options.trustedOrigins,
    database: drizzleAdapter(options.db, { provider: 'pg', schema: options.schema, transaction: true }),
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
      useSecureCookies: secure,
      defaultCookieAttributes: {
        ...sharedAuthOptions.advanced.defaultCookieAttributes,
        secure,
      },
      ...(options.cookieDomain
        ? { crossSubDomainCookies: { enabled: true, domain: options.cookieDomain } }
        : {}),
    },
    telemetry: { enabled: false },
    ...(options.hooks ? { hooks: options.hooks } : {}),
    // nextCookies must be the last plugin so Set-Cookie works from Server Actions.
    plugins: [...sharedAuthOptions.plugins, ...(options.extraPlugins ?? []), nextCookies()],
  });
}

export type KitstakAuth = ReturnType<typeof createAuth>;
