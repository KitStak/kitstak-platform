/**
 * Zod-validated server environment (portal pattern). Validation is lazy (first property access)
 * so tooling that only imports the module graph does not crash; real use fails fast listing
 * every invalid variable.
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
  NEXT_PUBLIC_PORTAL_URL: z.url().default('http://localhost:3300'),
  NEXT_PUBLIC_CRM_URL: z.url().default('http://localhost:3100'),
  NEXT_PUBLIC_WMS_URL: z.url().default('http://localhost:3000'),
  NEXT_PUBLIC_PROJECTS_URL: z.url().default('http://localhost:3400'),
  AUTH_COOKIE_DOMAIN: z
    .string()
    .regex(
      /^\.?[a-z0-9-]+(\.[a-z0-9-]+)+$/i,
      'AUTH_COOKIE_DOMAIN must be a bare cookie domain like .kitstak.app (no scheme, no port)',
    )
    .optional(),
  TRUST_PROXY: z.string().optional(),
  /** Bearer token for scheduled routes (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`). */
  CRON_SECRET: z.string().min(16).optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(5),
});

export type ServerEnv = z.infer<typeof envSchema>;

let cached: ServerEnv | undefined;

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

/** This app's public origin. */
export function appUrl(): string {
  const current = getEnv();
  return (current.NEXT_PUBLIC_APP_URL ?? current.BETTER_AUTH_URL).replace(/\/+$/, '');
}

/** Absolute URLs of every KitStak app (app switcher, deep links). */
export function appUrls(): { portal: string; crm: string; wms: string; projects: string; pulse: string } {
  const current = getEnv();
  return {
    portal: current.NEXT_PUBLIC_PORTAL_URL.replace(/\/+$/, ''),
    crm: current.NEXT_PUBLIC_CRM_URL.replace(/\/+$/, ''),
    wms: current.NEXT_PUBLIC_WMS_URL.replace(/\/+$/, ''),
    projects: current.NEXT_PUBLIC_PROJECTS_URL.replace(/\/+$/, ''),
    pulse: appUrl(),
  };
}

/** All origins allowed to perform mutating requests (own URL + sibling apps + extras). */
export function trustedOrigins(): string[] {
  const current = getEnv();
  const origins = new Set<string>([new URL(current.BETTER_AUTH_URL).origin]);
  if (current.NEXT_PUBLIC_APP_URL) origins.add(new URL(current.NEXT_PUBLIC_APP_URL).origin);
  for (const sibling of [
    current.NEXT_PUBLIC_PORTAL_URL,
    current.NEXT_PUBLIC_CRM_URL,
    current.NEXT_PUBLIC_WMS_URL,
    current.NEXT_PUBLIC_PROJECTS_URL,
  ]) {
    origins.add(new URL(sibling).origin);
  }
  for (const origin of current.TRUSTED_ORIGINS) {
    try {
      origins.add(new URL(origin).origin);
    } catch {
      throw new Error(`TRUSTED_ORIGINS contains an invalid URL: ${origin}`);
    }
  }
  // Local development: teammates run extra dev servers on 3500-3520 (NEXT_DIST_DIR=.next/<name>).
  if (current.NODE_ENV !== 'production') {
    for (let port = 3500; port <= 3520; port += 1) {
      origins.add(`http://localhost:${port}`);
      origins.add(`http://127.0.0.1:${port}`);
    }
  }
  return [...origins];
}
