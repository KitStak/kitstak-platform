/**
 * Leaf module (imports only drizzle-orm) for the custom-field slot SQL used by the locations and
 * LP type grid bindings. Keeping it dependency-free means module evaluation order can never leave
 * `customFieldSql` undefined when `LOCATION_SQL` / `LP_TYPE_SQL` spread it at module load.
 */
import { getTableName, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

export const CUSTOM_SLOTS = [
  'textBox1',
  'textBox2',
  'textBox3',
  'dropDown1',
  'dropDown2',
  'date1',
  'date2',
  'date3',
  'toggle1',
  'toggle2',
] as const;

/** `customField.<slot>` → json_extract(<table>.custom_fields, '$.<slot>') for filters, sort and columns. */
export function customFieldSql(column: PgColumn): Readonly<Record<string, SQL>> {
  const qualified = sql.raw(`"${getTableName(column.table)}"."${column.name}"`);
  return Object.fromEntries(
    CUSTOM_SLOTS.map((slot) => [`customField.${slot}`, sql`(${qualified} ->> ${slot}::text)`]),
  );
}

export const CUSTOM_FIELD_SORT_KEYS: readonly string[] = CUSTOM_SLOTS.map((slot) => `customField.${slot}`);
