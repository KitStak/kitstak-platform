/**
 * KitStak Projects `pm` schema barrel. The app's Drizzle instance (src/server/db.ts) merges this
 * with the shared `@kitstak/db/schema` (core auth tables, customers, entitlements).
 * Migrations are hand-written SQL in apps/projects/drizzle (never `drizzle-kit push`).
 */
export { pmSchema } from './_shared';
export * from './workspace';
export * from './projects';
export * from './tasks';
export * from './collaboration';
export * from './planning';
export * from './studio';
export * from './integrations';
