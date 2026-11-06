/**
 * Zod-validated server environment.
 *
 * Import `env` from here instead of reading `process.env` directly. Validation is
 * lazy (first property access) so that tooling which merely imports a module graph
 * (type generation, lint) does not crash, but any real use fails fast with a clear
 * message listing every invalid variable.
 *
 * This module deliberately does not import `server-only` so that CLI scripts
 * (migrations, seed) can use it; it must still never be imported from client code.
 */
import { z } from 'zod';

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

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
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  /** Optional token that unlocks the detailed /api/v1/health payload in production. */
  HEALTH_TOKEN: z.string().min(24, 'HEALTH_TOKEN must be at least 24 characters').optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
  UPLOAD_DIR: z.string().default('.data/uploads'),
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(25 * 1024 * 1024),
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
  ownKeys() {
    return Reflect.ownKeys(getEnv());
  },
  getOwnPropertyDescriptor(_target, property: string | symbol) {
    const value = getEnv()[property as keyof ServerEnv];
    return value === undefined ? undefined : { value, enumerable: true, configurable: true };
  },
  set() {
    throw new Error('env is read-only');
  },
});

export const isProduction = (): boolean => getEnv().NODE_ENV === 'production';

/** All origins allowed to perform mutating requests (app URL + configured extras). */
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
