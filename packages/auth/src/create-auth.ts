/**
 * Shared Better Auth factory (blueprint §1.1 `create-auth.ts`; extracted from
 * `apps/crm/src/server/auth/auth.ts`). Each app passes its own Drizzle db + schema,
 * secrets, origins, and app-specific hooks/plugins; everything else (cookies, session
 * TTLs, organization plugin, rate-limit rules) is shared so SSO behaves identically
 * on every origin.
 *
 * Security invariants that must hold for the SHARED `core` tables are baked in here,
 * never left to individual instances (auth review 2026-11-11 — the C1/H1/M1 theme:
 * every app mounting the shared tables is an equally valid door):
 *
 *  - `passwordPolicyPlugin` is ALWAYS mounted (H1): lockout + password policy are
 *    enforced on every instance. The policy loader and audit sink stay injectable
 *    (WMS passes its company-settings loader; CRM passes nothing and gets defaults).
 *  - `createPasswordCompat` is ALWAYS the password hasher (M1): migrated WMS bcrypt
 *    hashes verify on every instance, and a successful bcrypt sign-in is rehashed to
 *    the Better Auth default (scrypt) by the built-in rehash hook below.
 *  - Rate limiting uses Better Auth's DATABASE storage (M4): counters live in
 *    `core.rate_limit` and survive cold starts / are shared across serverless
 *    instances. Note Better Auth still keys buckets by its header-derived client IP
 *    (spoofable without a trusted proxy) — the per-ACCOUNT lockout in the policy
 *    plugin is the durable, spoof-indifferent control.
 *  - There is deliberately NO shared "banned" sign-in gate: Better Auth's base `user`
 *    table has no banned/active column (that field belongs to its admin plugin, which
 *    we do not mount), so cross-instance deactivation is enforced by deleting the
 *    credential `core.account` row instead (H3 — see WMS `setUsersActive`).
 *
 * Client-IP resolution (round-2 NEW-3): Better Auth keys its database rate-limit
 * buckets (and session `ip_address`) on `advanced.ipAddress`. The factory exposes an
 * `ipAddress` passthrough so each app can mirror its own TRUST_PROXY decision (see
 * `ipAddressFromTrustProxy`). On Vercel the defaults are safe: the platform overwrites
 * `x-forwarded-for` with a single trusted value, which Better Auth accepts. Behind
 * nginx / Cloudflare (multi-hop `x-forwarded-for`) you MUST set `trustedProxies` (or
 * trusted `ipAddressHeaders`), otherwise no client IP resolves and every request lands
 * in ONE shared per-path bucket in `core.rate_limit` — the limiter then 429s everyone.
 *
 * Invariant: `nextCookies()` must stay the LAST plugin so Set-Cookie works from
 * Server Actions (CRM invariant, preserved here).
 */
import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { organizationPlugin, sharedAuthOptions, type OrganizationPluginExtras } from './options';
import { createPasswordCompat, isBcryptHash, type PasswordCompatOptions } from './password-compat';
import {
  passwordPolicyPlugin,
  type PasswordPolicyPluginOptions,
  type RawSqlExecutor,
} from './password-policy-plugin';
import { signOutCookieSweepPlugin } from './sign-out-cookie-sweep';

type DrizzleDb = Parameters<typeof drizzleAdapter>[0];
type DrizzleSchema = Parameters<typeof drizzleAdapter>[1]['schema'];

const CREDENTIAL_PROVIDER = 'credential';

/** Better Auth's own `advanced.ipAddress` shape (better-auth 1.7.21), passed through verbatim. */
export type AuthIpAddressOptions = NonNullable<
  NonNullable<BetterAuthOptions['advanced']>['ipAddress']
>;

/**
 * Derives the `ipAddress` passthrough from an app's TRUST_PROXY env, mirroring the trust
 * decision of WMS `clientIp` (apps/wms/src/server/auth/rate-limit.ts):
 *
 *  - unset / '0' / 'false' → `undefined`: Better Auth defaults (single-value
 *    `x-forwarded-for` only — safe on Vercel, where the platform sets that header).
 *  - '1' / 'true' → the proxy in front overwrites the forwarded headers, so
 *    `x-forwarded-for` then `x-real-ip` are trusted sources.
 *  - anything else → a comma list of trusted proxy IPs / CIDR ranges
 *    (e.g. `TRUST_PROXY=10.0.0.0/8,173.245.48.0/20`): Better Auth walks the forwarded
 *    chain right-to-left past those hops to the real client (nginx / Cloudflare setups).
 */
export function ipAddressFromTrustProxy(trustProxy: string | undefined): AuthIpAddressOptions | undefined {
  const value = trustProxy?.trim() ?? '';
  if (value === '' || value === '0' || value.toLowerCase() === 'false') return undefined;
  if (value === '1' || value.toLowerCase() === 'true') {
    return { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'] };
  }
  return {
    trustedProxies: value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  };
}

export interface CreateAuthOptions {
  /** The app's Drizzle database instance (pg or postgres-js driver). */
  readonly db: DrizzleDb;
  /** Drizzle schema objects containing the Better Auth tables (incl. `rateLimit`). */
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
  /**
   * Closes `POST /sign-up/email` on this instance (auth review C1). WMS sets true —
   * its users are provisioned by admins; CRM keeps sign-up for invite/onboarding.
   */
  readonly disableSignUp?: boolean;
  /**
   * Injected policy loader / audit sink for the ALWAYS-mounted password-policy +
   * lockout plugin (H1). Omitted → defaults, no audit sink.
   */
  readonly passwordPolicy?: Pick<PasswordPolicyPluginOptions, 'loadPolicy' | 'onAuditEvent'>;
  /**
   * Better Auth `advanced.ipAddress` passthrough (round-2 NEW-3) — how the client IP
   * behind the shared DB rate limiter is resolved. Derive it from the app's TRUST_PROXY
   * env via `ipAddressFromTrustProxy`. Omitted → Better Auth defaults (Vercel-safe; see
   * the header comment for the nginx / Cloudflare caveat).
   */
  readonly ipAddress?: AuthIpAddressOptions;
  /** Extra callback when a legacy bcrypt hash verifies (the factory already rehashes). */
  readonly onLegacyVerified?: PasswordCompatOptions['onLegacyVerified'];
  /** App-specific plugins, inserted between the shared plugins and `nextCookies()`. */
  readonly extraPlugins?: BetterAuthPlugin[];
  /** App-specific global hooks (e.g. CRM's org-metadata guards — not baked in here). */
  readonly hooks?: BetterAuthOptions['hooks'];
  /**
   * Merged into the shared organization plugin: the invite email sender and the organization
   * hooks. Every app passes `billingOrganizationOptions(...)` from `@kitstak/billing/server`
   * here, so seat limits, invite emails and the delete guard hold at every door.
   */
  readonly organization?: OrganizationPluginExtras;
  /** Social sign in providers, passed through when set (the portal builds them from env). */
  readonly socialProviders?: BetterAuthOptions['socialProviders'];
}

interface CredentialAccountRow {
  readonly id: string;
  readonly password: string | null;
}

/**
 * M1: rehash-on-login. After a successful `/sign-in/email`, if the stored credential
 * hash is still a legacy WMS bcrypt hash, re-hash the (just verified) plaintext with
 * the instance's configured hasher — the Better Auth scrypt default — and update
 * `core.account.password` through the adapter. The old password keeps working: it is
 * the same password, now stored as scrypt. Runs on EVERY instance, so a migrated user
 * who first signs in at CRM is upgraded there too.
 */
function legacyRehashPlugin(): BetterAuthPlugin {
  return {
    id: 'kitstak-legacy-rehash',
    hooks: {
      after: [
        {
          matcher: (ctx) => ctx.path === '/sign-in/email',
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.returned;
            if (!returned || returned instanceof Error) return;
            const body = (ctx.body ?? {}) as { password?: unknown };
            const password = typeof body.password === 'string' ? body.password : null;
            const userId =
              typeof returned === 'object' && 'user' in returned
                ? ((returned as { user?: { id?: string } }).user?.id ?? null)
                : null;
            if (!password || !userId) return;
            const adapter = ctx.context.adapter;
            const credential = await adapter.findOne<CredentialAccountRow>({
              model: 'account',
              where: [
                { field: 'userId', value: userId },
                { field: 'providerId', value: CREDENTIAL_PROVIDER },
              ],
            });
            if (!credential?.password || !isBcryptHash(credential.password)) return;
            try {
              const rehashed = await ctx.context.password.hash(password);
              await adapter.update({
                model: 'account',
                where: [{ field: 'id', value: credential.id }],
                update: { password: rehashed, updatedAt: new Date() },
              });
            } catch (error) {
              // A failed rehash must never fail a successful sign-in; the bcrypt hash
              // stays valid and the next login retries the upgrade.
              ctx.context.logger?.error?.('legacy bcrypt rehash failed', error);
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}

export function createAuth(options: CreateAuthOptions) {
  const secure = options.useSecureCookies ?? options.baseURL.startsWith('https://');
  // M1/L3: the bcrypt-compat hasher is unconditional — every instance must verify
  // migrated hashes identically (a CRM sign-in with a bcrypt credential previously 500'd).
  const passwordCompat = createPasswordCompat({ onLegacyVerified: options.onLegacyVerified });
  // L1: the plugin gets a raw-SQL seam for the atomic lockout upsert when the db has one.
  const rawDb =
    typeof (options.db as { execute?: unknown }).execute === 'function'
      ? (options.db as unknown as RawSqlExecutor)
      : undefined;
  return betterAuth({
    ...sharedAuthOptions,
    emailAndPassword: {
      ...sharedAuthOptions.emailAndPassword,
      ...(options.disableSignUp ? { disableSignUp: true } : {}),
      password: passwordCompat,
    },
    secret: options.secret,
    baseURL: options.baseURL,
    basePath: '/api/auth',
    trustedOrigins: options.trustedOrigins,
    database: drizzleAdapter(options.db, { provider: 'pg', schema: options.schema, transaction: true }),
    rateLimit: {
      enabled: true,
      // M4: durable, cross-instance counters in core.rate_limit (adapter model
      // `rateLimit`) instead of per-process memory that reset on every cold start.
      storage: 'database',
      modelName: 'rateLimit',
      window: 60,
      max: 120,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60 * 10, max: 5 },
        '/forget-password': { window: 60 * 10, max: 5 },
        '/request-password-reset': { window: 60 * 10, max: 5 },
        '/reset-password': { window: 60 * 10, max: 10 },
        '/change-password': { window: 60, max: 5 },
        // Email codes (the emailOTP plugin the portal mounts) and invites.
        '/email-otp/send-verification-otp': { window: 60 * 10, max: 5 },
        '/email-otp/verify-email': { window: 60 * 10, max: 10 },
        '/email-otp/request-password-reset': { window: 60 * 10, max: 5 },
        '/forget-password/email-otp': { window: 60 * 10, max: 5 },
        '/email-otp/reset-password': { window: 60 * 10, max: 10 },
        '/organization/invite-member': { window: 60 * 10, max: 30 },
      },
    },
    advanced: {
      ...sharedAuthOptions.advanced,
      ...(options.ipAddress ? { ipAddress: options.ipAddress } : {}),
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
    ...(options.socialProviders
      ? {
          socialProviders: options.socialProviders,
          // A person who signs in with Google or Microsoft joins the account that has the same
          // verified email, instead of getting a second one.
          account: { accountLinking: { enabled: true, trustedProviders: ['google', 'microsoft'] } },
        }
      : {}),
    ...(options.hooks ? { hooks: options.hooks } : {}),
    // nextCookies must be the last plugin so Set-Cookie works from Server Actions.
    plugins: [
      // The shared organization plugin, with this app's invite email and hooks merged in.
      // `sharedAuthOptions.plugins` stays the plain one for the schema generator.
      organizationPlugin(options.organization),
      // H1: lockout + policy are factory behaviour, never instance opt-in.
      passwordPolicyPlugin({ ...(options.passwordPolicy ?? {}), rawDb }),
      legacyRehashPlugin(),
      // Sign-out must clear cookies across every plausible Domain scope, not only the
      // configured one (2026-11-13 logout incident — see ./sign-out-cookie-sweep.ts).
      signOutCookieSweepPlugin(),
      ...(options.extraPlugins ?? []),
      nextCookies(),
    ],
  });
}

export type KitstakAuth = ReturnType<typeof createAuth>;
