/**
 * @kitstak/db schema barrel — core/crm/wms pgSchema handles and the shared platform
 * tables (BLUEPRINT.md §2.3). Better Auth tables (core.user, core.organization, ...)
 * relocate into core in Phase 3; until then the FK targets here are plain uuid columns.
 */
export { coreSchema, crmSchema, wmsSchema } from './_shared';
export * from './core/customers';
export * from './core/items';
export * from './core/billing';
export * from './core/links';
export * from './core/wms-profiles';
