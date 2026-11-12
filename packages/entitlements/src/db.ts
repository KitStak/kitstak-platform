/**
 * The database seam this package needs: `select` + `insert` from any Drizzle Postgres
 * database (node-postgres in CRM/portal, postgres-js in WMS). Narrowed with `Pick` so
 * the type does not depend on an app's full schema generic, and so tests can satisfy
 * it with a plain-object mock (repo norm — see apps/crm/src/server/api.test.ts).
 */
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

export type EntitlementsDb = Pick<PgDatabase<PgQueryResultHKT, Record<string, unknown>>, 'select' | 'insert'>;
