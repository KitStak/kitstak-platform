/**
 * Server-side entitlement reads for the launcher and billing pages. Wraps
 * `@kitstak/entitlements` with the portal's db handle and resolves each module to a
 * UI-ready state. Stripe is deferred: state comes from manual grants + the dev switch.
 */
import 'server-only';
import {
  MODULES,
  getEntitlements,
  isDevAllowAll,
  isEntitled,
  type Module,
  type ModuleEntitlement,
} from '@kitstak/entitlements';
import { db } from '@/server/db';

export type ModuleAccess = 'active' | 'trial' | 'grace' | 'locked' | 'dev';

export interface ModuleState {
  readonly module: Module;
  /** Raw row (null when no core.entitlements row exists). */
  readonly entitlement: ModuleEntitlement | null;
  /** Whether the Open tile should be live. */
  readonly entitled: boolean;
  /** UI-facing access state (dev = allow-all switch, grace = past_due inside GRACE_DAYS). */
  readonly access: ModuleAccess;
}

function accessFor(
  entitlement: ModuleEntitlement | null,
  entitled: boolean,
  devAllowAll: boolean,
): ModuleAccess {
  if (entitlement?.status === 'active') return 'active';
  if (entitlement?.status === 'trialing') return 'trial';
  if (entitlement?.status === 'past_due' && entitled) return 'grace';
  if (devAllowAll) return 'dev';
  return 'locked';
}

export interface OrgModuleStates {
  readonly devAllowAll: boolean;
  readonly modules: readonly ModuleState[];
}

/** Per-module entitlement state for an org (dev allow-all never hides the real rows). */
export async function getOrgModuleStates(orgId: string): Promise<OrgModuleStates> {
  const devAllowAll = isDevAllowAll();
  const snapshot = await getEntitlements(db, orgId);
  const modules = MODULES.map((module) => {
    const entitlement = snapshot[module];
    const entitled = devAllowAll || isEntitled(entitlement);
    return {
      module,
      entitlement,
      entitled,
      access: accessFor(entitlement, isEntitled(entitlement), devAllowAll),
    };
  });
  return { devAllowAll, modules };
}
