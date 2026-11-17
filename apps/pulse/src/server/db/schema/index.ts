/**
 * KitStak Pulse `pulse` schema barrel. The app's Drizzle instance (src/server/db.ts) merges this
 * with the shared `@kitstak/db/schema` (core auth tables, customers, entitlements).
 * Migrations are hand-written SQL in apps/pulse/drizzle (never `drizzle-kit push`).
 * Add one `export * from './<area>'` line per schema file, mirroring the SQL.
 */
export { pulseSchema } from './_shared';
export * from './setup';
export * from './jobs';
export * from './streams';
export * from './control';
