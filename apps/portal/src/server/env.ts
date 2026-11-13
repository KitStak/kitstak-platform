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
  /**
   * Cookie domain for cross-subdomain SSO (`.kitstak.io` in prod). Leave unset in dev —
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
   * guide shows WMS steps only for this org — WMS tables are not org-scoped, so reading
   * them for any other org would leak the install's state (docs/integration/ONBOARDING.md).
   */
  WMS_PLATFORM_ORG_SLUG: z.string().min(1).default('kitstak'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(5),
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
