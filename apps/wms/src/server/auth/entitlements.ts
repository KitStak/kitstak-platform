/**
 * WMS-side module entitlement gate (BLUEPRINT.md §3.3), backed by @kitstak/entitlements.
 *
 * One separate warehouse per organization: the gate asks
 * `hasModule(db, orgId, 'wms')` for the org a request works in (resolved with the session,
 * src/server/tenancy), which itself caches `core.entitlements` reads for 60 seconds per
 * process.
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

/** Whether an organization may use the WMS module (allow-all short-circuits to true). */
export async function wmsModuleEntitledForOrg(db: AppDb, orgId: string): Promise<boolean> {
  if (entitlementsAllowAll()) return true;
  return hasModule(db as unknown as EntitlementsDb, orgId, 'wms');
}

/** 402 envelope error (`{ success: false, error, code: 'ENTITLEMENT_MISSING' }`). */
export function entitlementMissingError(): AppError {
  return new AppError('ENTITLEMENT_MISSING', 'WMS is not enabled for this organization', {
    details: { module: 'wms' },
  });
}

/**
 * defineRoute() gate: throws the 402 error when the request's org lacks the WMS module.
 * Exempt paths (health, cron tick, bootstrap) always pass; `auth: 'public'` routes are
 * exempted by the caller.
 */
export async function requireWmsEntitlement(db: AppDb, orgId: string, pathname: string): Promise<void> {
  if (EXEMPT_PATHS.has(pathname)) return;
  if (!(await wmsModuleEntitledForOrg(db, orgId))) throw entitlementMissingError();
}
