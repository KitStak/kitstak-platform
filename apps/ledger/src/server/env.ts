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
  NEXT_PUBLIC_PULSE_URL: z.url().default('http://localhost:3500'),
  NEXT_PUBLIC_CREW_URL: z.url().default('http://localhost:3800'),
  /** Comma list of org slugs let in to the preview apps in production (SPEC 3.1). Read by `previewAccess`. */
  KITSTAK_PREVIEW_ORGS: z.string().optional(),
  ENTITLEMENTS_DEV_ALLOW_ALL: z.string().optional(),
  /** 32 byte key (base64 or hex) for provider tokens, AES-256-GCM. Needed once QuickBooks is connected (Phase 8). */
  LEDGER_INTEGRATION_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  EMAIL_REPLY_TO: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
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
  /**
   * `1` turns the database guard on: every query runs as the plain role `ledger_app` with the
   * workspace set, so row level security applies to the app (CONTRACTS section 12, rule 13).
   * Off when unset. Needs migration 0000. `GET /api/health` with the health token shows
   * `guard: { on, active, ready, reason }`. If the login cannot use the role, the app keeps
   * running as the login role and logs a loud error (see `src/server/db.ts`).
   * Read straight from `process.env` in `src/server/db/scope.ts`; listed here so it is documented.
   */
  LEDGER_DB_GUARD: z.string().optional(),
  /**
   * Optional, for the two login setup (CONTRACTS section 12, rule 13): the owner login. When set,
   * `DATABASE_URL` is a login that owns nothing and may only become `ledger_app`, and the work that
   * runs as the owner (`asSystem`, better auth, the guard off) uses this URL. Unset: one login.
   */
  LEDGER_OWNER_DATABASE_URL: z
    .string()
    .refine((value) => /^postgres(ql)?:\/\//.test(value), 'LEDGER_OWNER_DATABASE_URL must be a postgres:// URL')
    .optional(),
  /** Optional token that unlocks the detailed `GET /api/health` answer (header `x-health-token`). Same rule as CRM. */
  HEALTH_TOKEN: z.string().min(24, 'HEALTH_TOKEN must be at least 24 characters').optional(),
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

export interface AppUrls {
  readonly portal: string;
  readonly crm: string;
  readonly wms: string;
  readonly projects: string;
  readonly pulse: string;
  readonly crew: string;
  readonly ledger: string;
}

/** Absolute URLs of every KitStak app (app switcher, deep links). */
export function appUrls(): AppUrls {
  const current = getEnv();
  const trim = (url: string): string => url.replace(/\/+$/, '');
  return {
    portal: trim(current.NEXT_PUBLIC_PORTAL_URL),
    crm: trim(current.NEXT_PUBLIC_CRM_URL),
    wms: trim(current.NEXT_PUBLIC_WMS_URL),
    projects: trim(current.NEXT_PUBLIC_PROJECTS_URL),
    pulse: trim(current.NEXT_PUBLIC_PULSE_URL),
    crew: trim(current.NEXT_PUBLIC_CREW_URL),
    ledger: appUrl(),
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
    current.NEXT_PUBLIC_PULSE_URL,
    current.NEXT_PUBLIC_CREW_URL,
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
  // Local development: personal dev servers run on 3700 to 3720 (NEXT_DIST_DIR=.next/<name>).
  if (current.NODE_ENV !== 'production') {
    for (let port = 3700; port <= 3720; port += 1) {
      origins.add(`http://localhost:${port}`);
      origins.add(`http://127.0.0.1:${port}`);
    }
  }
  return [...origins];
}
