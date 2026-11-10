/**
 * Column helpers shared by every table in `src/server/db/schema/**` (BUILD_PLAN F1.1).
 *
 * Relative imports only: drizzle-kit loads the schema without the `@/` alias.
 */
import { sql } from "drizzle-orm";
import { integer, text } from "drizzle-orm/sqlite-core";
import type { CustomFieldValues } from "../../lib/enums";

export const nowIso = (): string => new Date().toISOString();

/** `text` UUID primary key. */
export const pk = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());

/**
 * `text` primary key with no default: the id is required on insert. Used where
 * existing callers type insert rows and read `id` back before inserting
 * (legacy seed builders), so the column must not become optional.
 */
export const requiredPk = () => text("id").primaryKey();

export const bool = (name: string) => integer(name, { mode: "boolean" });

export const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();

/** created/updated stamps + optimistic-concurrency version. Replaces any existing createdAt. */
export const stamps = () => ({
  createdAt: text("created_at").notNull().$defaultFn(nowIso),
  createdBy: text("created_by"),
  updatedAt: text("updated_at").notNull().$defaultFn(nowIso).$onUpdateFn(nowIso),
  updatedBy: text("updated_by"),
  version: integer("version").notNull().default(1),
});

export const customFields = () => ({
  customFields: json<CustomFieldValues>("custom_fields").notNull().default(sql`'{}'`),
});

/** SQL default for an empty JSON array column. */
export const EMPTY_JSON_ARRAY = sql`'[]'`;
/** SQL default for an empty JSON object column. */
export const EMPTY_JSON_OBJECT = sql`'{}'`;
