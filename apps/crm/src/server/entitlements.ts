/**
 * CRM-side module entitlement gate (BLUEPRINT.md §3.3), backed by @kitstak/entitlements.
 *
 * `orgHasCrmModule` is the one question both choke points ask: `withApi()` (402 envelope)
 * and `getPageOrgMembership()` (redirect to /[orgSlug]/locked). `hasModule` caches
 * `core.entitlements` reads for 60 seconds per process.
 *
 * Environment posture (this app's env-layer default; documented in .env.example):
 *  - `ENTITLEMENTS_DEV_ALLOW_ALL` set (non-empty)  → that explicit value wins
 *    (`1`/`true` → allow-all, anything else → gate enforced).
 *  - unset → allow-all everywhere EXCEPT production (`NODE_ENV === 'production'`).
 *    Dev, test and e2e flows therefore never touch `core.entitlements`; production
 *    fails closed: access comes from a free trial, a paid plan (docs/billing) or a manual
 *    grant (`pnpm --filter @kitstak/entitlements grant`).
 *
 * Read per call (not cached at import) so tests can toggle the switch.
 */
import 'server-only';
import { getModuleAccess, hasModule, isDevAllowAll, type EntitlementsDb, type ModuleAccess } from '@kitstak/entitlements';
import { db } from '@/server/db';

/** True when the gate is bypassed: explicit env value, else on outside production. */
export function entitlementsAllowAll(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = env.ENTITLEMENTS_DEV_ALLOW_ALL?.trim();
  if (explicit) return isDevAllowAll(env);
  return env.NODE_ENV !== 'production';
}

/** Whether the org may use the CRM module (allow-all short-circuits to true). */
export async function orgHasCrmModule(orgId: string): Promise<boolean> {
  if (entitlementsAllowAll()) return true;
  return hasModule(db as unknown as EntitlementsDb, orgId, 'crm');
}

/**
 * The org's access level to the CRM (docs/billing/SPEC.md P14): `full`, `read_only` (view only:
 * trial over, payment late, paused, plan ended) or `locked` (not in the plan). Allow-all answers
 * `full`. A cached answer that is not `full` is read again, so a payment shows on the next request.
 */
export async function orgCrmAccess(orgId: string): Promise<ModuleAccess> {
  if (entitlementsAllowAll()) return 'full';
  return getModuleAccess(db as unknown as EntitlementsDb, orgId, 'crm');
}

export interface OrgModuleFlags {
  readonly crm: boolean;
  readonly wms: boolean;
  readonly projects: boolean;
  readonly pulse: boolean;
}

/**
 * Every KitStak module's unlock state for the org (app switcher, sibling-app panels). Fails
 * closed per module on read errors so a billing hiccup only hides integrations.
 */
export async function orgModuleFlags(orgId: string): Promise<OrgModuleFlags> {
  if (entitlementsAllowAll()) return { crm: true, wms: true, projects: true, pulse: true };
  const read = (module: 'crm' | 'wms' | 'projects' | 'pulse') =>
    hasModule(db as unknown as EntitlementsDb, orgId, module).catch(() => false);
  const [crm, wms, projects, pulse] = await Promise.all([read('crm'), read('wms'), read('projects'), read('pulse')]);
  return { crm, wms, projects, pulse };
}
