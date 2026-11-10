/**
 * Bulk command dispatch for `POST /api/orders/bulk/[action]`: body schema per action and
 * the domain / repository command it runs. Returns the 0.2 per-id result.
 */
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/server/db";
import type { AppDb } from "@/server/api/db";
import { orders, runBulk, type BulkResult, type DomainCtx } from "@/server/domain";
import type { OrderBulkAction } from "@/lib/grid-defs/orders/shipment-orders";
import { cancelPicking, removeSerials, resolvePackShort, resolvePickShort, returnInfoSchema, updateReturnInfo } from "./orders-commands";
import { bulkIdsSchema, idSchema } from "./platform-common";

const ids = z.object({ ids: bulkIdsSchema });

export const BULK_BODY_SCHEMAS: Readonly<Record<OrderBulkAction, z.ZodType>> = {
  cancel: ids.extend({ reasonId: z.string().min(1, "Select a cancel reason").max(64), note: z.string().trim().max(500).nullish() }),
  hold: ids,
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

export function runOrderBulk(action: OrderBulkAction, db: AppDb, ctx: DomainCtx, body: Record<string, unknown>): OrderBulkResult {
  const list = body.ids as string[];
  switch (action) {
    case "cancel":
      return db.transaction((tx) => {
        const res = orders.cancelOrders(tx, ctx, { ids: list, reasonId: body.reasonId as string, note: (body.note as string | null | undefined) ?? null });
        labelCancelReason(tx, res.succeeded, body.reasonId as string);
        return res;
      });
    case "hold":
      return orders.holdOrders(db, ctx, { ids: list });
    case "release":
      return orders.releaseOrders(db, ctx, { ids: list });
    case "change-warehouse":
      return orders.changeWarehouse(db, ctx, { ids: list, warehouseId: body.warehouseId as string });
    case "delete":
      return orders.deleteOrders(db, ctx, { ids: list });
    case "backorder": {
      const childIds: string[] = [];
      const res = runBulk(db, list, (inner, id) => {
        childIds.push(orders.createBackorder(inner, ctx, { orderId: id }).id);
      });
      return { ...res, childIds };
    }
    case "unmerge":
      return runBulk(db, list, (inner, id) => {
        orders.unmergeOrder(inner, ctx, { orderId: id });
      });
    case "cancel-picking":
      return cancelPicking(db, ctx, list);
    case "resolve-pick-short":
      return resolvePickShort(db, ctx, list);
    case "resolve-pack-short":
      return resolvePackShort(db, ctx, list);
    case "update-return-info":
      return updateReturnInfo(db, ctx, body as z.output<typeof returnInfoSchema>);
    case "remove-serials":
      return removeSerials(db, ctx, list);
  }
}

/**
 * LOCAL ADAPTER (docs/requests/orders-outbound.md REQ-8): the domain logs the cancel reason
 * as its lookup id; rewrite those rows to the reason name so no raw id reaches the change log.
 */
export function labelCancelReason(tx: AppDb, orderIds: readonly string[], reasonId: string): void {
  if (orderIds.length === 0) return;
  const name = tx.select({ name: schema.lookupValues.name }).from(schema.lookupValues).where(eq(schema.lookupValues.id, reasonId)).get()?.name;
  if (!name) return;
  const cl = schema.changeLog;
  tx.update(cl).set({ toValue: name, message: `Cancel Reason is modified.  --> ${name}` })
    .where(and(eq(cl.entityType, "shipment_order"), inArray(cl.entityId, [...orderIds]), eq(cl.field, "cancelReasonId"), eq(cl.toValue, reasonId))).run();
}
