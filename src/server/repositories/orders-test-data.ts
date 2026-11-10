/**
 * Outbound demo-data hygiene. Critic and e2e runs leave orders, tags, order types and notes
 * behind whose text starts with a test prefix (KS-CRIT, KS-E2E). Before a buyer demo they go:
 * - orders whose customer, note, store order # or code carries a prefix are soft-deleted when they
 *   hold no job and no allocation (others are reported, never force-removed);
 * - tags with a prefix are deleted (their entity links cascade);
 * - order-type lookups with a prefix are deleted when unused, else deactivated;
 * - order notes with a prefix are deleted.
 * `planOrderTestDataPurge` is the dry run; `purgeOrderTestData` applies it in the caller's transaction.
 */
import { and, eq, inArray, isNull, like, or, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { schema } from "@/server/db";

export const TEST_TEXT_PREFIXES: readonly string[] = ["KS-CRIT", "KS-E2E"];

const so = schema.shipmentOrders;

function prefixed(col: SQL | SQLiteColumn, prefixes: readonly string[]): SQL {
  return or(...prefixes.map((p) => like(col, `${p}%`))) as SQL;
}

export interface OrderTestDataPlan {
  readonly orders: readonly { readonly id: string; readonly code: string }[];
  readonly keptOrders: readonly { readonly code: string; readonly reason: string }[];
  readonly tags: readonly { readonly id: string; readonly name: string }[];
  readonly orderTypes: readonly { readonly id: string; readonly name: string; readonly inUse: boolean }[];
  readonly noteIds: readonly string[];
}

export function planOrderTestDataPurge(db: AppDb, prefixes: readonly string[] = TEST_TEXT_PREFIXES): OrderTestDataPlan {
  const candidates = db
    .select({ id: so.id, code: so.code, jobId: so.jobId })
    .from(so)
    .where(and(isNull(so.deletedAt), or(prefixed(so.customerName, prefixes), prefixed(so.note, prefixes), prefixed(so.storeOrderNumber, prefixes), prefixed(so.code, prefixes))))
    .all();
  const orders: { id: string; code: string }[] = [];
  const keptOrders: { code: string; reason: string }[] = [];
  for (const c of candidates) {
    const allocated = db
      .select({ n: sql<number>`COALESCE(SUM(${schema.orderLines.allocatedQuantity}), 0)` })
      .from(schema.orderLines)
      .where(eq(schema.orderLines.orderId, c.id))
      .get()?.n ?? 0;
    if (c.jobId) keptOrders.push({ code: c.code, reason: "in a job" });
    else if (allocated > 0) keptOrders.push({ code: c.code, reason: `${allocated} units allocated` });
    else orders.push({ id: c.id, code: c.code });
  }
  const tags = db.select({ id: schema.tags.id, name: schema.tags.name }).from(schema.tags).where(prefixed(schema.tags.name, prefixes)).all();
  const lv = schema.lookupValues;
  const orderTypes = db
    .select({ id: lv.id, name: lv.name })
    .from(lv)
    .where(and(eq(lv.type, "so_type"), prefixed(lv.name, prefixes)))
    .all()
    .map((t) => ({ ...t, inUse: Boolean(db.select({ id: so.id }).from(so).where(and(eq(so.orderTypeId, t.id), isNull(so.deletedAt))).get()) }));
  const en = schema.entityNotes;
  const noteIds = db
    .select({ id: en.id })
    .from(en)
    .where(and(eq(en.entityType, "shipment_order"), or(...prefixes.map((p) => like(en.body, `%${p}%`)))))
    .all()
    .map((r) => r.id);
  return { orders, keptOrders, tags, orderTypes, noteIds };
}

export function purgeOrderTestData(db: AppDb, plan: OrderTestDataPlan, at = new Date().toISOString()): void {
  if (plan.orders.length) db.update(so).set({ deletedAt: at, updatedAt: at }).where(inArray(so.id, plan.orders.map((o) => o.id))).run();
  if (plan.tags.length) {
    const ids = plan.tags.map((t) => t.id);
    db.delete(schema.entityTags).where(inArray(schema.entityTags.tagId, ids)).run();
    db.delete(schema.tags).where(inArray(schema.tags.id, ids)).run();
  }
  for (const t of plan.orderTypes) {
    if (t.inUse) db.update(schema.lookupValues).set({ isActive: false, updatedAt: at }).where(eq(schema.lookupValues.id, t.id)).run();
    else db.delete(schema.lookupValues).where(eq(schema.lookupValues.id, t.id)).run();
  }
  if (plan.noteIds.length) db.delete(schema.entityNotes).where(inArray(schema.entityNotes.id, [...plan.noteIds])).run();
}
