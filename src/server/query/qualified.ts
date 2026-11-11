/**
 * Table-qualified column references for correlated subqueries (docs/requests/orders-outbound.md REQ-6).
 *
 * In a single-table `db.select().from(t)`, drizzle renders `${t.id}` as a bare `"id"`, so a
 * correlated subquery like `(SELECT … FROM order_lines l WHERE l.order_id = ${t.id})` binds to the
 * subquery's own `id` (silently wrong) or fails with "ambiguous column name". Use
 *
 *   const q = qualified(schema.shipmentOrders);
 *   sql`(SELECT COUNT(*) FROM order_lines l WHERE l.order_id = ${q.id})`
 *
 * which always renders `"shipment_orders"."id"`.
 */
import { getTableColumns, getTableName, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

export type Qualified<T extends PgTable> = { readonly [K in keyof T["$inferSelect"]]: SQL };

export function qualified<T extends PgTable>(table: T): Qualified<T> {
  const name = getTableName(table).replaceAll('"', '""');
  return Object.fromEntries(
    Object.entries(getTableColumns(table)).map(([key, col]) => [key, sql.raw(`"${name}"."${col.name.replaceAll('"', '""')}"`)]),
  ) as Qualified<T>;
}
