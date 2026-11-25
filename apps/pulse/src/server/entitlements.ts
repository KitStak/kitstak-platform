/**
 * Pulse module entitlement gate (CRM pattern). `ENTITLEMENTS_DEV_ALLOW_ALL` set → that value
 * wins; unset → allow-all everywhere except production. Production fails closed: access comes from
 * a free trial, a paid plan (docs/billing) or a manual grant:
 *   pnpm --filter @kitstak/entitlements grant grant <org-slug> pulse
 * Also exposes sibling-module flags for the app switcher and integration feature detection.
 */
import 'server-only';
import {
  getEntitlements,
  getModuleAccess,
  hasModule,
  isDevAllowAll,
  isEntitled,
  type EntitlementsDb,
  type Module,
  type ModuleAccess,
} from '@kitstak/entitlements';
import { db } from '@/server/db';
import { asSystem } from '@/server/db/scope';

export function entitlementsAllowAll(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = env.ENTITLEMENTS_DEV_ALLOW_ALL?.trim();
  if (explicit) return isDevAllowAll(env);
  return env.NODE_ENV !== 'production';
}

const entitlementsDb = (): EntitlementsDb => db as unknown as EntitlementsDb;

/** Whether the org may use KitStak Pulse. */
export async function orgHasPulseModule(orgId: string): Promise<boolean> {
  if (entitlementsAllowAll()) return true;
  return asSystem('entitlement check (core.entitlements)', () => hasModule(entitlementsDb(), orgId, 'pulse'));
}

/**
 * The org's access level to Pulse (docs/billing/SPEC.md P14): `full`, `read_only` (view only:
 * trial over, payment late, paused, plan ended) or `locked` (not in the plan). Allow-all answers
 * `full`. A cached answer that is not `full` is read again, so a payment shows on the next request.
 */
export async function orgPulseAccess(orgId: string): Promise<ModuleAccess> {
  if (entitlementsAllowAll()) return 'full';
  return asSystem('entitlement check (core.entitlements)', () => getModuleAccess(entitlementsDb(), orgId, 'pulse'));
}

export type ModuleFlags = Readonly<Record<Module, boolean>>;

/** Every module's entitlement for the org (app switcher + integration UI gating). */
export async function orgModuleFlags(orgId: string): Promise<ModuleFlags> {
  if (entitlementsAllowAll()) return { crm: true, wms: true, projects: true, pulse: true };
  const snapshot = await asSystem('entitlement check (core.entitlements)', () => getEntitlements(entitlementsDb(), orgId));
  return {
    crm: isEntitled(snapshot.crm),
    wms: isEntitled(snapshot.wms),
    projects: isEntitled(snapshot.projects),
    pulse: isEntitled(snapshot.pulse),
  };
}
