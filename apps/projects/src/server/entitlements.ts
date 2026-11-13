/**
 * Projects module entitlement gate (CRM pattern). `ENTITLEMENTS_DEV_ALLOW_ALL` set → that value
 * wins; unset → allow-all everywhere except production. Production fails closed and needs a grant:
 *   pnpm --filter @kitstak/entitlements grant grant <org-slug> projects
 * Also exposes sibling-module flags for the app switcher and integration feature detection.
 */
import 'server-only';
import { getEntitlements, hasModule, isDevAllowAll, isEntitled, type EntitlementsDb, type Module } from '@kitstak/entitlements';
import { db } from '@/server/db';

export function entitlementsAllowAll(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = env.ENTITLEMENTS_DEV_ALLOW_ALL?.trim();
  if (explicit) return isDevAllowAll(env);
  return env.NODE_ENV !== 'production';
}

const entitlementsDb = (): EntitlementsDb => db as unknown as EntitlementsDb;

/** Whether the org may use KitStak Projects. */
export async function orgHasProjectsModule(orgId: string): Promise<boolean> {
  if (entitlementsAllowAll()) return true;
  return hasModule(entitlementsDb(), orgId, 'projects');
}

export type ModuleFlags = Readonly<Record<Module, boolean>>;

/** Every module's entitlement for the org (app switcher + integration UI gating). */
export async function orgModuleFlags(orgId: string): Promise<ModuleFlags> {
  if (entitlementsAllowAll()) return { crm: true, wms: true, projects: true };
  const snapshot = await getEntitlements(entitlementsDb(), orgId);
  return {
    crm: isEntitled(snapshot.crm),
    wms: isEntitled(snapshot.wms),
    projects: isEntitled(snapshot.projects),
  };
}
