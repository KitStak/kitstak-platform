/**
 * @kitstak/entitlements — per-module entitlements for KitStak orgs (BLUEPRINT.md §3).
 * Stripe sync (`src/sync.ts` / `src/stripe.ts` in the blueprint) is deferred by owner
 * decision: entitlements run on manual grants plus the dev allow-all switch.
 */
export { MODULES, isModule, type Module } from './modules';
export { isDevAllowAll } from './dev';
export type { EntitlementsDb } from './db';
export {
  GRACE_DAYS,
  clearEntitlementsCache,
  getEntitlements,
  hasModule,
  isEntitled,
  type EntitlementSnapshot,
  type ModuleEntitlement,
} from './read';
export { grantModule, revokeModule } from './grant';
