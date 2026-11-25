/**
 * Plan reads for the launcher and the shell. One source of truth: `getPlanState` from
 * `@kitstak/billing/server` (docs/billing/CONTRACTS.md section 11.2). The badge on a tile, the row in
 * the app switcher and the billing pages all come from the same `PlanState`.
 *
 * `getOrgModuleStates` stays as a thin wrapper with its old shape, because the setup guide reads it.
 */
import 'server-only';
import { cache } from 'react';
import { MODULES, getEntitlements, isDevAllowAll, type Module, type ModuleEntitlement } from '@kitstak/entitlements';
import { planBadgeFor, type ModulePlan, type PlanBadge, type PlanState } from '@kitstak/billing/plan-state';
import { getPlanState } from '@kitstak/billing/server';
import { billingRuntime } from '@/server/billing/runtime';
import { db } from '@/server/db';

/**
 * @deprecated The five state word from before billing. New code reads `badge` (a `PlanBadge`) and
 * `plan` (a `ModulePlan`). Kept so the setup guide keeps compiling.
 */
export type ModuleAccess = 'active' | 'trial' | 'grace' | 'locked' | 'dev';

export interface ModuleState {
  readonly module: Module;
  /** Raw row (null when no core.entitlements row exists). */
  readonly entitlement: ModuleEntitlement | null;
  /** Whether the tile opens the app: full access, view only, or the dev switch. */
  readonly entitled: boolean;
  /** @deprecated See `ModuleAccess`. */
  readonly access: ModuleAccess;
  /** The badge every screen shows for this app. */
  readonly badge: PlanBadge;
  readonly plan: ModulePlan;
}

export interface OrgPlan {
  readonly devAllowAll: boolean;
  readonly state: PlanState;
  readonly modules: readonly ModuleState[];
}

export interface OrgModuleStates {
  readonly devAllowAll: boolean;
  readonly modules: readonly ModuleState[];
}

function legacyAccess(entitlement: ModuleEntitlement | null, plan: ModulePlan, devAllowAll: boolean): ModuleAccess {
  if (plan.access === 'full' && entitlement?.status === 'active') return 'active';
  if (plan.access === 'full' && entitlement?.status === 'trialing') return 'trial';
  if (plan.access === 'full' && entitlement?.status === 'past_due') return 'grace';
  // A view only app still has a real row behind it, so it counts as a real app for the setup guide.
  if (plan.access === 'read_only') return 'active';
  if (devAllowAll) return 'dev';
  return plan.access === 'locked' ? 'locked' : 'active';
}

/**
 * Under the dev switch every app opens, so "Not in your plan" and "View only" would be wrong on a
 * tile. Those two read "Included" there, the same rule the product apps use.
 */
function shownBadge(state: PlanState, module: Module, devAllowAll: boolean): PlanBadge {
  const badge = planBadgeFor(state, module);
  return devAllowAll && (badge === 'not_in_plan' || badge === 'view_only') ? 'included' : badge;
}

/** The plan of an org with one UI ready row per app. Read once per request. */
export const getOrgPlan = cache(async (orgId: string): Promise<OrgPlan> => {
  const devAllowAll = isDevAllowAll();
  const [state, snapshot] = await Promise.all([getPlanState(billingRuntime(), orgId), getEntitlements(db, orgId)]);
  const modules = MODULES.map((module): ModuleState => {
    const plan = state.modules[module];
    const entitlement = snapshot[module];
    return {
      module,
      entitlement,
      entitled: devAllowAll || plan.access !== 'locked',
      access: legacyAccess(entitlement, plan, devAllowAll),
      badge: shownBadge(state, module, devAllowAll),
      plan,
    };
  });
  return { devAllowAll, state, modules };
});

/** Per app state for the shell and the setup guide (dev allow all never hides the real rows). */
export async function getOrgModuleStates(orgId: string): Promise<OrgModuleStates> {
  const { devAllowAll, modules } = await getOrgPlan(orgId);
  return { devAllowAll, modules };
}
