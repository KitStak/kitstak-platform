/**
 * Database schema barrel. Every table lives in `./schema/<domain>.ts`
 * (BUILD_PLAN F1); this file re-exports them all for Drizzle, drizzle-kit
 * (`drizzle.config.ts`) and the app (`import { schema } from "@/server/db"`).
 */
export * from './schema/identity';
export * from './schema/org';
export * from './schema/platform';
export * from './schema/catalog';
export * from './schema/facility';
export * from './schema/inventory';
export * from './schema/outbound';
export * from './schema/shipping';
export * from './schema/inbound';
export * from './schema/returns';
export * from './schema/work';
export * from './schema/counts';
export * from './schema/kitting';
export * from './schema/automation';
export * from './schema/integrations';
export * from './schema/billing';
