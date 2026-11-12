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
import { and, eq, inArray, isNull, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { schema } from '@/server/db';
import { mapSeq } from '@/server/db/sql';

export const TEST_TEXT_PREFIXES: readonly string[] = ['KS-CRIT', 'KS-E2E'];

const so = schema.shipmentOrders;

function prefixed(col: SQL | PgColumn, prefixes: readonly string[]): SQL {
  return or(...prefixes.map((p) => ilike(col, `${p}%`))) as SQL;
}

export interface OrderTestDataPlan {
  readonly orders: readonly { readonly id: string; readonly code: string }[];
  readonly keptOrders: readonly { readonly code: string; readonly reason: string }[];
  readonly tags: readonly { readonly id: string; readonly name: string }[];
  readonly orderTypes: readonly { readonly id: string; readonly name: string; readonly inUse: boolean }[];
  readonly noteIds: readonly string[];
}

export async function planOrderTestDataPurge(
  db: AppDb,
  prefixes: readonly string[] = TEST_TEXT_PREFIXES,
): Promise<OrderTestDataPlan> {
  const candidates = await db
    .select({ id: so.id, code: so.code, jobId: so.jobId })
    .from(so)
    .where(
      and(
        isNull(so.deletedAt),
        or(
          prefixed(so.customerName, prefixes),
          prefixed(so.note, prefixes),
          prefixed(so.storeOrderNumber, prefixes),
          prefixed(so.code, prefixes),
        ),
      ),
    );
  const orders: { id: string; code: string }[] = [];
  const keptOrders: { code: string; reason: string }[] = [];
  for (const c of candidates) {
    const allocated =
      (
        await db
          .select({ n: sql<number>`COALESCE(SUM(${schema.orderLines.allocatedQuantity}), 0)` })
          .from(schema.orderLines)
          .where(eq(schema.orderLines.orderId, c.id))
          .limit(1)
      )[0]?.n ?? 0;
    if (c.jobId) keptOrders.push({ code: c.code, reason: 'in a job' });
    else if (allocated > 0) keptOrders.push({ code: c.code, reason: `${allocated} units allocated` });
    else orders.push({ id: c.id, code: c.code });
  }
  const tags = await db
    .select({ id: schema.tags.id, name: schema.tags.name })
    .from(schema.tags)
    .where(prefixed(schema.tags.name, prefixes));
  const lv = schema.lookupValues;
  const orderTypes = await mapSeq(
    await db
      .select({ id: lv.id, name: lv.name })
      .from(lv)
      .where(and(eq(lv.type, 'so_type'), prefixed(lv.name, prefixes))),
    async (t) => ({
      ...t,
      inUse: Boolean(
        (
          await db
            .select({ id: so.id })
            .from(so)
            .where(and(eq(so.orderTypeId, t.id), isNull(so.deletedAt)))
            .limit(1)
        )[0],
      ),
    }),
  );
  const en = schema.entityNotes;
  const noteIds = (
    await db
      .select({ id: en.id })
      .from(en)
      .where(and(eq(en.entityType, 'shipment_order'), or(...prefixes.map((p) => ilike(en.body, `%${p}%`)))))
  ).map((r) => r.id);
  return { orders, keptOrders, tags, orderTypes, noteIds };
}

export async function purgeOrderTestData(
  db: AppDb,
  plan: OrderTestDataPlan,
  at = new Date().toISOString(),
): Promise<void> {
  if (plan.orders.length)
    await db
      .update(so)
      .set({ deletedAt: at, updatedAt: at })
      .where(
        inArray(
          so.id,
          plan.orders.map((o) => o.id),
        ),
      );
  if (plan.tags.length) {
    const ids = plan.tags.map((t) => t.id);
    await db.delete(schema.entityTags).where(inArray(schema.entityTags.tagId, ids));
    await db.delete(schema.tags).where(inArray(schema.tags.id, ids));
  }
  for (const t of plan.orderTypes) {
    if (t.inUse)
      await db
        .update(schema.lookupValues)
        .set({ isActive: false, updatedAt: at })
        .where(eq(schema.lookupValues.id, t.id));
    else await db.delete(schema.lookupValues).where(eq(schema.lookupValues.id, t.id));
  }
  if (plan.noteIds.length)
    await db.delete(schema.entityNotes).where(inArray(schema.entityNotes.id, [...plan.noteIds]));
}
