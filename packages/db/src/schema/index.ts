/**
 * @kitstak/db schema barrel — core/crm/wms pgSchema handles and the shared platform
 * tables (BLUEPRINT.md §2.3), plus the Better Auth tables (core.user, core.organization,
 * ...) relocated into `core` in Phase 3 — `./core/auth.ts` is the shared home both apps
 * import (CRM re-exports it; WMS feeds it to the Better Auth drizzle adapter).
 */
export { coreSchema, crmSchema, wmsSchema } from './_shared';
export * from './core/auth';
export * from './core/auth-policy';
export * from './core/rate-limit';
export * from './core/customers';
export * from './core/items';
export * from './core/billing';
export * from './core/links';
export * from './core/wms-profiles';
