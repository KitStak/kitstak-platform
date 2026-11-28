/**
 * KitStak Crew `crew` schema barrel. The app's Drizzle instance (src/server/db.ts) merges this with
 * the shared `@kitstak/db/schema` (core auth tables, vendors, entitlements). Migrations are hand
 * written SQL in apps/crew/drizzle (never `drizzle-kit push`). One export line per schema file.
 */
export { crewSchema } from './_shared';
export * from './setup';
export * from './people';
export * from './control';
