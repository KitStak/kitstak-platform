/**
 * The `wms` Postgres schema every WMS table lives in (integration blueprint §2.1: one
 * Supabase Postgres with `core` / `crm` / `wms` schemas). Tables are declared as
 * `wmsSchema.table('name', ...)` so Drizzle renders `"wms"."name"`; raw SQL resolves
 * through the connection `search_path` (`wms, public`) set in `src/server/db/index.ts`.
 */
import { pgSchema } from 'drizzle-orm/pg-core';

export const wmsSchema = pgSchema('wms');
