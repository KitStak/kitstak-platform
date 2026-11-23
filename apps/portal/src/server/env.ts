/**
 * Zod-validated server environment (portal flavor of apps/crm/src/server/env.ts).
 * Validation is lazy (first property access) so tooling that only imports the module
 * graph does not crash; real use fails fast listing every invalid variable.
 */
import { z } from 'zod';

const commaList = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

/** An optional string where an empty value (a blank line in an env file) means "not set". */
const optionalText = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim() ?? '';
    return trimmed === '' ? undefined : trimmed;
  });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine((value) => /^postgres(ql)?:\/\//.test(value), 'DATABASE_URL must be a postgres:// URL'),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.url('BETTER_AUTH_URL must be an absolute URL'),
  NEXT_PUBLIC_APP_URL: z.url().optional(),
  TRUSTED_ORIGINS: commaList,
  /** Launcher tile targets (BLUEPRINT.md §6). Absolute origins of the sibling apps. */
  NEXT_PUBLIC_CRM_URL: z.url().default('http://localhost:3100'),
  NEXT_PUBLIC_WMS_URL: z.url().default('http://localhost:3000'),
  NEXT_PUBLIC_PROJECTS_URL: z.url().default('http://localhost:3400'),
  NEXT_PUBLIC_PULSE_URL: z.url().default('http://localhost:3500'),
  /**
   * Cookie domain for cross-subdomain SSO (`.kitstak.io` in prod). Leave unset in dev:
   * localhost ports already share host-only `kitstak.*` cookies (BLUEPRINT.md §1.2).
   */
  AUTH_COOKIE_DOMAIN: z
    .string()
    .regex(
      /^\.?[a-z0-9-]+(\.[a-z0-9-]+)+$/i,
      'AUTH_COOKIE_DOMAIN must be a bare cookie domain like .kitstak.io (no scheme, no port)',
    )
    .optional(),
  /** Client-IP trust for Better Auth's shared DB rate limiter (same contract as CRM/WMS). */
  TRUST_PROXY: z.string().optional(),
  /**
   * Slug of the org that owns the (single-tenant) WMS install. The launcher's setup
   * guide shows WMS steps only for this org: WMS tables are not org-scoped, so reading
   * them for any other org would leak the install's state (docs/integration/ONBOARDING.md).
   */
  WMS_PLATFORM_ORG_SLUG: z.string().min(1).default('kitstak'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(5),

  // Signup and billing (docs/billing/CONTRACTS.md section 16.1). All optional. Secrets are read
  // here and from nowhere else; none of them ever belongs in the repo.
  /**
   * Stripe secret key. Absent outside production: the built in test gateway runs and screens say
   * "Test mode". Absent in production: billing is off and says so. Never a fake charge.
   */
  STRIPE_SECRET_KEY: optionalText,
  /** Signing secret (whsec_...) of the portal webhook endpoint. Required together with the key. */
  STRIPE_WEBHOOK_SECRET: optionalText,
  /** Billing Portal configuration id (bpc_...) from `pnpm -F @kitstak/billing stripe:setup apply`. */
  STRIPE_PORTAL_CONFIGURATION_ID: optionalText,
  /** `1` turns Stripe Tax on. Off by default: Stripe Tax needs registrations set in the account. */
  STRIPE_AUTOMATIC_TAX: optionalText,
  /** Optional fixed signing secret for the test gateway. Default: derived from BETTER_AUTH_SECRET. */
  BILLING_TEST_WEBHOOK_SECRET: optionalText,
  /** Bearer secret for the billing jobs tick route. Required in production. */
  CRON_SECRET: optionalText,
  /** `resend` or `outbox`. Default: Resend when its key is set, else the dev outbox outside production. */
  EMAIL_PROVIDER: z.enum(['resend', 'outbox']).optional(),
  RESEND_API_KEY: optionalText,
  /** For example `KitStak <billing@your-domain>`. Required for Resend. Set at go live. */
  EMAIL_FROM: optionalText,
  EMAIL_REPLY_TO: optionalText,
  /** Google sign in. The button shows only when both are set. */
  GOOGLE_CLIENT_ID: optionalText,
  GOOGLE_CLIENT_SECRET: optionalText,
  /** Microsoft sign in. The button shows only when id and secret are set. Tenant defaults to `common`. */
  MICROSOFT_CLIENT_ID: optionalText,
  MICROSOFT_CLIENT_SECRET: optionalText,
  MICROSOFT_TENANT_ID: optionalText,
  /** Marketing site origin, for "Talk to us" and pricing links. */
  NEXT_PUBLIC_SITE_URL: z.url().default('https://kitstak.com'),
  /** Legal links on the signup and sign in screens. Default: the pages the CRM serves today. */
  NEXT_PUBLIC_TERMS_URL: z.url().optional(),
  NEXT_PUBLIC_PRIVACY_URL: z.url().optional(),
});

export type ServerEnv = z.infer<typeof envSchema>;

let cached: ServerEnv | undefined;

/** Parse and validate `process.env`. Throws a single readable error on failure. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid server environment configuration:\n${issues}`);
  }
  return result.data;
}

function getEnv(): ServerEnv {
  cached ??= loadEnv();
  return cached;
}

/** Lazily validated, read-only view of the server environment. */
export const env: Readonly<ServerEnv> = new Proxy({} as ServerEnv, {
  get(_target, property: string | symbol) {
    return getEnv()[property as keyof ServerEnv];
  },
  has(_target, property: string | symbol) {
    return property in getEnv();
  },
  set() {
    throw new Error('env is read-only');
  },
});

export const isProduction = (): boolean => getEnv().NODE_ENV === 'production';

/**
 * Terms and Privacy links. Default: the pages on the marketing site, which carry the billing rules
 * (renewal, canceling, refunds, tax) and the site's own header, not an app's navigation.
 */
export function legalUrls(): { terms: string; privacy: string } {
  const current = getEnv();
  const site = current.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '');
  return {
    terms: current.NEXT_PUBLIC_TERMS_URL ?? `${site}/terms`,
    privacy: current.NEXT_PUBLIC_PRIVACY_URL ?? `${site}/privacy`,
  };
}

/** All origins allowed to perform mutating requests (own URL + sibling apps + extras). */
export function trustedOrigins(): string[] {
  const current = getEnv();
  const origins = new Set<string>([new URL(current.BETTER_AUTH_URL).origin]);
  if (current.NEXT_PUBLIC_APP_URL) origins.add(new URL(current.NEXT_PUBLIC_APP_URL).origin);
  for (const origin of current.TRUSTED_ORIGINS) {
    try {
      origins.add(new URL(origin).origin);
    } catch {
      throw new Error(`TRUSTED_ORIGINS contains an invalid URL: ${origin}`);
    }
  }
  return [...origins];
}
