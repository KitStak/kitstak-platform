/**
 * KitStak Ledger `ledger` schema barrel. The app's Drizzle instance (src/server/db.ts) merges this
 * with the shared `@kitstak/db/schema` (core auth tables, customers, vendors, entitlements).
 * Migrations are hand written SQL in apps/ledger/drizzle (never `drizzle-kit push`).
 */
export { ledgerSchema } from './_shared';
export * from './setup';
export * from './receivables';
export * from './payables';
export * from './bank';
export * from './books';
