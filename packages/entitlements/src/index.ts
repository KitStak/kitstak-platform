/**
 * @kitstak/entitlements: per-module entitlements for KitStak orgs (BLUEPRINT.md §3,
 * docs/billing/CONTRACTS.md section 8): cached reads of core.entitlements, the one access rule
 * (`moduleAccess`), manual grants, the full-row writer the billing sync uses, and the dev allow-all
 * switch. No gateway code lives here; `@kitstak/billing` owns checkout, webhooks and sync.
 */
export { MODULES, isModule, type Module } from './modules';
export { isDevAllowAll } from './dev';
export type { EntitlementsDb } from './db';
export {
  GRACE_DAYS,
  clearEntitlementsCache,
  getEntitlements,
  getEntitlementsFresh,
  getModuleAccess,
  hasModule,
  isEntitled,
  moduleAccess,
  readBillingStamp,
  resetBillingStampProbe,
  type EntitlementSnapshot,
  type ModuleAccess,
  type ModuleEntitlement,
} from './read';
export { grantModule, revokeModule } from './grant';
export { setEntitlement, type EntitlementWrite } from './write';
export { PREVIEW_APPS, isPreviewApp, previewAccess, previewOrgSlugs, type PreviewApp } from './preview';
