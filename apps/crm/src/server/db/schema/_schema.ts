/**
 * CRM domain tables live in the `crm` Postgres schema. Auth tables (auth.ts) stay in
 * `public` for this phase — they move to `core` in Phase 3. pg enums created by 0000
 * remain in `public`; tables moved to `crm` keep referencing them across schemas.
 */
import { pgSchema } from 'drizzle-orm/pg-core';

export const crmSchema = pgSchema('crm');
