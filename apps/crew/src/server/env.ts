/**
 * Zod-validated server environment (portal pattern, docs/crew/SPEC.md section 1). Validation is
 * lazy (first property access) so tooling that only imports the module graph does not crash; real
 * use fails fast listing every invalid variable.
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

const postgresUrl = (name: string) =>
  z.string().refine((value) => /^postgres(ql)?:\/\//.test(value), `${name} must be a postgres:// URL`);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine((value) => /^postgres(ql)?:\/\//.test(value), 'DATABASE_URL must be a postgres:// URL'),
  /** Direct (non pooled) URL for migrations. Read by scripts/db-migrate.ts; listed here so it is documented. */
  DIRECT_URL: postgresUrl('DIRECT_URL').optional(),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.url('BETTER_AUTH_URL must be an absolute URL'),
  NEXT_PUBLIC_APP_URL: z.url().optional(),
  TRUSTED_ORIGINS: commaList,
  NEXT_PUBLIC_PORTAL_URL: z.url().default('http://localhost:3300'),
  NEXT_PUBLIC_CRM_URL: z.url().default('http://localhost:3100'),
  NEXT_PUBLIC_WMS_URL: z.url().default('http://localhost:3000'),
  NEXT_PUBLIC_PROJECTS_URL: z.url().default('http://localhost:3400'),
  NEXT_PUBLIC_PULSE_URL: z.url().default('http://localhost:3500'),
  /** Optional until Ledger exists. */
  NEXT_PUBLIC_LEDGER_URL: z.url().optional(),
  AUTH_COOKIE_DOMAIN: z
    .string()
    .regex(
      /^\.?[a-z0-9-]+(\.[a-z0-9-]+)+$/i,
      'AUTH_COOKIE_DOMAIN must be a bare cookie domain like .kitstak.app (no scheme, no port)',
    )
    .optional(),
  TRUST_PROXY: z.string().optional(),
  /** Org slugs let in to the preview before launch (SPEC 3.4). Read by `@kitstak/entitlements` previewAccess. */
  KITSTAK_PREVIEW_ORGS: z.string().optional(),
  /** Bearer token for scheduled routes (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`). */
  CRON_SECRET: z.string().min(16).optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(5),
  /**
   * `1` turns the database guard on: every query runs as the plain role `crew_app` with the
   * workspace set, so row level security applies to the app (the PULSE_DB_GUARD rule). Off when
   * unset. Read straight from `process.env` in `src/server/db/scope.ts`; listed here so it is documented.
   */
  CREW_DB_GUARD: z.string().optional(),
  /** Optional, the two login setup (same as PULSE_OWNER_DATABASE_URL): the owner login for asSystem and better auth. */
  CREW_OWNER_DATABASE_URL: postgresUrl('CREW_OWNER_DATABASE_URL').optional(),
  /** Optional token that unlocks the detailed `GET /api/health` answer (header `x-health-token`). */
  HEALTH_TOKEN: z.string().min(24, 'HEALTH_TOKEN must be at least 24 characters').optional(),
  /** RSA private key for queued kiosk PINs (SPEC 6.2). Used from Phase 3. */
  CREW_KIOSK_PRIVATE_KEY: z.string().optional(),
  /** Optional: card copies and punch photos in Vercel Blob. Without it the bytes go into crew.attachments.data. */
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  /** Optional: schedule notices through @kitstak/mail (Phase 2). */
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
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
  /** Null until Ledger is deployed for this host. */
  readonly ledger: string | null;
  readonly crew: string;
}

const trim = (url: string): string => url.replace(/\/+$/, '');

/** Absolute URLs of every KitStak app (app switcher, deep links). */
export function appUrls(): AppUrls {
  const current = getEnv();
  return {
    portal: trim(current.NEXT_PUBLIC_PORTAL_URL),
    crm: trim(current.NEXT_PUBLIC_CRM_URL),
    wms: trim(current.NEXT_PUBLIC_WMS_URL),
    projects: trim(current.NEXT_PUBLIC_PROJECTS_URL),
    pulse: trim(current.NEXT_PUBLIC_PULSE_URL),
    ledger: current.NEXT_PUBLIC_LEDGER_URL ? trim(current.NEXT_PUBLIC_LEDGER_URL) : null,
    crew: appUrl(),
  };
}

/** Personal dev servers run on 3800 (the main one) to 3820. */
export const DEV_PORT_FIRST = 3800;
export const DEV_PORT_LAST = 3820;

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
    current.NEXT_PUBLIC_LEDGER_URL,
  ]) {
    if (sibling) origins.add(new URL(sibling).origin);
  }
  for (const origin of current.TRUSTED_ORIGINS) {
    try {
      origins.add(new URL(origin).origin);
    } catch {
      throw new Error(`TRUSTED_ORIGINS contains an invalid URL: ${origin}`);
    }
  }
  if (current.NODE_ENV !== 'production') {
    for (let port = DEV_PORT_FIRST; port <= DEV_PORT_LAST; port += 1) {
      origins.add(`http://localhost:${port}`);
      origins.add(`http://127.0.0.1:${port}`);
    }
  }
  return [...origins];
}
