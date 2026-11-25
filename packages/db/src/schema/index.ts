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
// Better Auth's drizzle adapter resolves plugin models by their snake_case model name;
// every consumer passing this barrel as the adapter schema needs these aliases.
export { passwordPolicyState as password_policy_state } from './core/auth-policy';
export { rateLimit as rate_limit } from './core/rate-limit';
export * from './core/customers';
export * from './core/items';
export * from './core/billing';
export * from './core/onboarding';
export * from './core/password-change';
export * from './core/links';
export * from './core/wms-profiles';
export * from './core/wms-tenants';
export * from './core/record-links';
