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
 *    fails closed: access comes from a free trial, a paid plan (docs/billing) or a manual
 *    grant (`pnpm --filter @kitstak/entitlements grant`).
 *
 * Three levels of access (docs/billing/SPEC.md P14): `full`, `read_only` (view only: trial
 * over, payment late, paused, plan ended) and `locked` (WMS is not in the plan). View only is
 * never a wall: pages open and read, exports work, and every change is refused here.
 */
import {
  getModuleAccess,
  hasModule,
  isDevAllowAll,
  type EntitlementsDb,
  type ModuleAccess,
} from '@kitstak/entitlements';
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

/** Whether an organization has FULL access to the WMS module (allow-all short-circuits to true). */
export async function wmsModuleEntitledForOrg(db: AppDb, orgId: string): Promise<boolean> {
  if (entitlementsAllowAll()) return true;
  return hasModule(db as unknown as EntitlementsDb, orgId, 'wms');
}

/**
 * The org's access level to the WMS. Allow-all answers `full`. A cached answer that is not
 * `full` is read again, so a payment or a new trial shows on the next request.
 */
export async function wmsAccessForOrg(db: AppDb, orgId: string): Promise<ModuleAccess> {
  if (entitlementsAllowAll()) return 'full';
  return getModuleAccess(db as unknown as EntitlementsDb, orgId, 'wms');
}

/** The one sentence every refused write shows in view only (SPEC 9.4). */
export const PLAN_READ_ONLY_MESSAGE = 'Your plan is view only right now. Pick a plan in the Portal to make changes.';
/** The sentence for an API call when WMS is not in the plan. */
export const PLAN_LOCKED_MESSAGE = 'WMS is not in your plan yet. Add it in the Portal to use it.';

/** 402 envelope error (`{ success: false, error, code: 'ENTITLEMENT_MISSING' }`). */
export function entitlementMissingError(): AppError {
  return new AppError('ENTITLEMENT_MISSING', PLAN_LOCKED_MESSAGE, {
    details: { module: 'wms' },
  });
}

/** 402 envelope error (`{ success: false, error, code: 'PLAN_READ_ONLY' }`). */
export function planReadOnlyError(): AppError {
  return new AppError('PLAN_READ_ONLY', PLAN_READ_ONLY_MESSAGE, {
    details: { module: 'wms' },
  });
}

/** Methods that never change data. Everything else is a write. */
function isSafeMethod(method: string): boolean {
  const upper = method.toUpperCase();
  return upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS';
}

/**
 * Requests that are not GET but change no warehouse data, so they keep working in view only:
 * signing out and password help, switching warehouse or client, grid and personal preferences,
 * "seen" markers, exports, and previews (a preview computes an answer and saves nothing).
 */
const VIEW_ONLY_PREFIXES: readonly string[] = ['/api/auth/', '/api/tenancy/switch', '/api/grid-prefs/'];
const VIEW_ONLY_PATHS: ReadonlySet<string> = new Set([
  '/api/me',
  '/api/notifications/read',
  '/api/exports',
  '/api/reports/exports',
]);

/** True when a non GET request may run while the plan is view only. Pure; unit tested. */
export function allowedInViewOnly(pathname: string): boolean {
  if (VIEW_ONLY_PATHS.has(pathname)) return true;
  if (VIEW_ONLY_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  // `/api/printouts/preview`, `/api/orders/ship-preview`, `/api/lp-numbers/removal-preview`.
  return /[/-]preview$/.test(pathname);
}

/**
 * defineRoute() gate. WMS not in the plan: every request is refused (402 ENTITLEMENT_MISSING).
 * View only: reads pass and every change is refused (402 PLAN_READ_ONLY), except the short
 * list in `allowedInViewOnly`. Exempt paths (health, cron tick, bootstrap) always pass;
 * `auth: 'public'` routes are exempted by the caller. `method` defaults to a read so callers
 * that only ask "may this org open the WMS" keep working.
 */
export async function requireWmsEntitlement(
  db: AppDb,
  orgId: string,
  pathname: string,
  method: string = 'GET',
): Promise<void> {
  if (EXEMPT_PATHS.has(pathname)) return;
  const access = await wmsAccessForOrg(db, orgId);
  if (access === 'locked') throw entitlementMissingError();
  if (access === 'read_only' && !isSafeMethod(method) && !allowedInViewOnly(pathname)) throw planReadOnlyError();
}
