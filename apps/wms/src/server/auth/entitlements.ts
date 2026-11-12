/**
 * WMS-side module entitlement gate (BLUEPRINT.md §3.3), backed by @kitstak/entitlements.
 *
 * WMS is single-tenant: every request belongs to the one platform organization
 * (`ensurePlatformOrg`, slug `kitstak`), so the gate resolves that org id once per
 * database handle (WeakMap cache — test fixtures with their own PGlite each get a
 * fresh resolution) and asks `hasModule(db, orgId, 'wms')`, which itself caches
 * `core.entitlements` reads for 60 seconds per process.
 *
 * Environment posture (this app's env-layer default; documented in .env.example):
 *  - `ENTITLEMENTS_DEV_ALLOW_ALL` set (non-empty)  → that explicit value wins
 *    (`1`/`true` → allow-all, anything else → gate enforced).
 *  - unset → allow-all everywhere EXCEPT production (`NODE_ENV === 'production'`).
 *    Dev, test and e2e flows therefore never touch `core.entitlements`; production
 *    fails closed and requires a manual grant
 *    (`pnpm --filter @kitstak/entitlements grant`) — Stripe sync is deferred.
 */
import { hasModule, isDevAllowAll, type EntitlementsDb } from '@kitstak/entitlements';
import type { AppDb } from '@/server/api/db';
import { AppError } from '@/server/api/errors';
import { ensurePlatformOrg } from '@/server/auth/credentials';

/**
 * Pipeline paths that must answer even for an unentitled install: health probes,
 * the scheduler tick (token-authenticated) and first-run bootstrap.
 */
const EXEMPT_PATHS: ReadonlySet<string> = new Set([
  '/api/health',
  '/api/cron/tick',
  '/api/admin/bootstrap',
]);

/** True when the gate is bypassed: explicit env value, else on outside production. */
export function entitlementsAllowAll(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = env.ENTITLEMENTS_DEV_ALLOW_ALL?.trim();
  if (explicit) return isDevAllowAll(env);
  return env.NODE_ENV !== 'production';
}

/** Platform org id per database handle; failed resolutions are not cached. */
const platformOrgIds = new WeakMap<object, Promise<string>>();

async function platformOrgId(db: AppDb): Promise<string> {
  const cached = platformOrgIds.get(db);
  if (cached) return cached;
  const pending = ensurePlatformOrg(db);
  platformOrgIds.set(db, pending);
  pending.catch(() => platformOrgIds.delete(db));
  return pending;
}

/** Whether this install may use the WMS module (allow-all short-circuits to true). */
export async function wmsModuleEntitled(db: AppDb): Promise<boolean> {
  if (entitlementsAllowAll()) return true;
  return hasModule(db as unknown as EntitlementsDb, await platformOrgId(db), 'wms');
}

/** 402 envelope error (`{ success: false, error, code: 'ENTITLEMENT_MISSING' }`). */
export function entitlementMissingError(): AppError {
  return new AppError('ENTITLEMENT_MISSING', 'WMS is not enabled for this organization', {
    details: { module: 'wms' },
  });
}

/**
 * defineRoute() gate: throws the 402 error when the platform org lacks the WMS module.
 * Exempt paths (health, cron tick, bootstrap) always pass; `auth: 'public'` routes are
 * exempted by the caller.
 */
export async function requireWmsEntitlement(db: AppDb, pathname: string): Promise<void> {
  if (EXEMPT_PATHS.has(pathname)) return;
  if (!(await wmsModuleEntitled(db))) throw entitlementMissingError();
}
