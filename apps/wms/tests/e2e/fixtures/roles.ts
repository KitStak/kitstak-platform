/**
 * Seeded test identities used by E2E suites, one per system role.
 * Emails come from src/server/db/seed-data.ts (USER_SEEDS); passwords are the
 * seed password (local test value), overridable via E2E_PASSWORD / SEED_PASSWORD.
 */
import path from 'node:path';

export const ROLES = ['admin', 'manager', 'operator', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_EMAILS: Readonly<Record<Role, string>> = {
  admin: 'admin@kitstak.io',
  manager: 'ops.manager@kitstak.io',
  operator: 'j.okafor@kitstak.io',
  viewer: 'finance@kitstak.io',
};

const DEFAULT_SEED_PASSWORD = 'KitStak!demo2026';

export function e2ePassword(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env.E2E_PASSWORD || env.SEED_PASSWORD || DEFAULT_SEED_PASSWORD;
}

export const DEFAULT_BASE_URL = 'http://localhost:3000';

export function e2eBaseUrl(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env.E2E_BASE_URL || DEFAULT_BASE_URL;
}

/** Saved browser state per role (gitignored under .data/). */
export const AUTH_STATE_DIR = path.join(process.cwd(), '.data', 'e2e-auth');

export function storageStatePath(role: Role): string {
  return path.join(AUTH_STATE_DIR, `${role}.json`);
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
