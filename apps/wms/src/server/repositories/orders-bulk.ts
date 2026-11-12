/**
 * Bulk command dispatch for `POST /api/orders/bulk/[action]`: body schema per action and
 * the domain / repository command it runs. Returns the 0.2 per-id result.
 */
import { z } from "zod";
import type { AppDb } from "@/server/api/db";
import { orders, runBulk, type BulkResult, type DomainCtx } from "@/server/domain";
import type { OrderBulkAction } from "@/lib/grid-defs/orders/shipment-orders";
import { schema } from "@/server/db";
import { inArray } from "drizzle-orm";
import { cancelPicking, logOrderComment, removeSerials, resolvePackShort, resolvePickShort, returnInfoSchema, updateReturnInfo } from "./orders-commands";
import { bulkIdsSchema, idSchema } from "./platform-common";
import { withTidyLog } from "./orders-change-log";
import { withWriteTx } from "@/server/db/sql";

const ids = z.object({ ids: bulkIdsSchema });

export const BULK_BODY_SCHEMAS: Readonly<Record<OrderBulkAction, z.ZodType>> = {
  cancel: ids.extend({ reasonId: z.string().min(1, "Select a cancel reason").max(64), note: z.string().trim().max(500).nullish() }),
  hold: ids.extend({ reason: z.string().trim().max(500).nullish() }),
  release: ids,
  delete: ids,
  unmerge: ids,
  backorder: ids,
  "cancel-picking": ids,
  "resolve-pick-short": ids,
  "resolve-pack-short": ids,
  "remove-serials": ids,
  "change-warehouse": ids.extend({ warehouseId: idSchema }),
  "update-return-info": returnInfoSchema,
};

export type OrderBulkResult = BulkResult & { readonly childIds?: readonly string[] };

/** Runs the action, then tidies the change-log rows it wrote (formatted dates, "—" for empty sides). */
export async function runOrderBulk(action: OrderBulkAction, db: AppDb, ctx: DomainCtx, body: Record<string, unknown>): Promise<OrderBulkResult> {
  const list = body.ids as string[];
  return await withTidyLog(db, list, async () => await dispatch(action, db, ctx, body, list));
}

async function dispatch(action: OrderBulkAction, db: AppDb, ctx: DomainCtx, body: Record<string, unknown>, list: string[]): Promise<OrderBulkResult> {
  switch (action) {
    case "cancel":
      // The change log resolves cancelReasonId to the lookup name itself (REQ-8 applied).
      // The dialog's note is context for the cancel, never a replacement for the order's own Note.
      return await withWriteTx(db, async (tx) => {
        const res = await orders.cancelOrders(tx, ctx, { ids: list, reasonId: body.reasonId as string });
        const note = typeof body.note === "string" ? body.note.trim() : "";
        if (note && res.succeeded.length > 0) await recordCancelNotes(tx, ctx, res.succeeded, note);
        return res;
      });
    case "hold":
      // Enterprise audit: the optional hold reason is a change-log entry plus an order note (critic r5).
      return await withWriteTx(db, async (tx) => {
        const res = await orders.holdOrders(tx, ctx, { ids: list });
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        if (reason && res.succeeded.length > 0) await recordHoldReasons(tx, ctx, res.succeeded, reason);
        return res;
      });
    case "release":
      return await orders.releaseOrders(db, ctx, { ids: list });
    case "change-warehouse":
      return await orders.changeWarehouse(db, ctx, { ids: list, warehouseId: body.warehouseId as string });
    case "delete":
      return await orders.deleteOrders(db, ctx, { ids: list });
    case "backorder": {
      const childIds: string[] = [];
      const res = await runBulk(db, list, async (inner, id) => {
        childIds.push((await orders.createBackorder(inner, ctx, { orderId: id })).id);
      });
      return { ...res, childIds };
    }
    case "unmerge":
      return await runBulk(db, list, async (inner, id) => {
        await orders.unmergeOrder(inner, ctx, { orderId: id });
      });
    case "cancel-picking":
      return await cancelPicking(db, ctx, list);
    case "resolve-pick-short":
      return await resolvePickShort(db, ctx, list);
    case "resolve-pack-short":
      return await resolvePackShort(db, ctx, list);
    case "update-return-info":
      return await updateReturnInfo(db, ctx, body as z.output<typeof returnInfoSchema>);
    case "remove-serials":
      return await removeSerials(db, ctx, list);
  }
}


/** Cancel note: a change-log entry on the Cancel plus an order note, leaving shipment_orders.note untouched. */
export const HOLD_REASON_PREFIX = "Hold reason: ";

/** "Hold reason: …" on each held order's change log and Notes (shown on the detail hold banner). */
export async function recordHoldReasons(tx: AppDb, ctx: DomainCtx, ids: readonly string[], reason: string): Promise<void> {
  const rows = await tx.select({ id: schema.shipmentOrders.id, code: schema.shipmentOrders.code }).from(schema.shipmentOrders).where(inArray(schema.shipmentOrders.id, [...ids]));
  for (const r of rows) {
    await logOrderComment(tx, ctx, { orderId: r.id, code: r.code, field: "holdReason", label: "Hold Reason", value: reason, message: HOLD_REASON_PREFIX + reason });
    await tx.insert(schema.entityNotes).values({ entityType: "shipment_order", entityId: r.id, body: HOLD_REASON_PREFIX + reason, userId: ctx.userId });
  }
}

export async function recordCancelNotes(tx: AppDb, ctx: DomainCtx, ids: readonly string[], note: string): Promise<void> {
  const rows = await tx.select({ id: schema.shipmentOrders.id, code: schema.shipmentOrders.code }).from(schema.shipmentOrders).where(inArray(schema.shipmentOrders.id, [...ids]));
  for (const r of rows) {
    await logOrderComment(tx, ctx, { orderId: r.id, code: r.code, field: "cancelNote", label: "Cancel Note", value: note, message: `Cancel note: ${note}` });
    await tx.insert(schema.entityNotes).values({ entityType: "shipment_order", entityId: r.id, body: `Cancel note: ${note}`, userId: ctx.userId });
  }
}
