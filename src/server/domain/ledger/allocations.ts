/**
 * Allocation primitives: reserve / release stock on a bucket. Allocation does not move
 * stock; it writes an `inventory_allocations` row, re-derives `inventory.allocated` and
 * posts an `Allocation` / `Allocation Cancel` transaction (from = to = bucket, net 0).
 */
import { eq } from "drizzle-orm";
import type { InventoryStatus } from "@/lib/enums";
import * as schema from "@/server/db/schema";
import { DomainError, insufficientStock, ruleViolation } from "../errors";
import { checkScope, type DomainCtx, type Tx } from "../types";
import { freeQty, getBucket, packRatio, syncAllocated, type AllocationRow } from "./bucket";
import { assertNotCountLocked } from "./count-locks";
import { getLocation } from "./rules";
import { writeTxn, type TxnRefs, type TxnRow } from "./txn";

export type AllocationStatus = AllocationRow["status"];

/** Allocation status that matches the status of the bucket holding the stock. */
export function allocationStatusFor(status: InventoryStatus): AllocationStatus {
  return status === "Stock" ? "Allocated" : status;
}

export function getAllocation(tx: Tx, allocationId: string): AllocationRow {
  const row = tx.select().from(schema.inventoryAllocations).where(eq(schema.inventoryAllocations.id, allocationId)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Allocation not found");
  return row;
}

export interface AllocateInput {
  readonly inventoryId: string;
  readonly qty: number;
  readonly orderId?: string | null;
  readonly orderLineId?: string | null;
  readonly workOrderId?: string | null;
  readonly workOrderComponentId?: string | null;
  readonly jobId?: string | null;
  readonly taskId?: string | null;
  readonly algorithmId?: string | null;
  readonly ruleName?: string | null;
  readonly waveId?: string | null;
  readonly refs?: TxnRefs;
}

export function allocate(tx: Tx, ctx: DomainCtx, input: AllocateInput): { allocation: AllocationRow; txn: TxnRow } {
  if (!Number.isInteger(input.qty) || input.qty <= 0) throw new DomainError("VALIDATION", "Allocation quantity must be a positive whole number");
  const bucket = getBucket(tx, input.inventoryId);
  checkScope(ctx, bucket, "Inventory");
  if (bucket.status !== "Stock") throw ruleViolation("Only inventory in Stock status can be allocated.");
  if (bucket.damageReason) throw ruleViolation("Damaged inventory can't be allocated.");
  const loc = getLocation(tx, bucket.locationId);
  if (loc.isLocked) throw ruleViolation(`Location ${loc.code} is locked.`);
  assertNotCountLocked(tx, loc);
  if (freeQty(bucket) < input.qty) {
    throw insufficientStock(`Only ${freeQty(bucket)} units are free in this bucket; ${input.qty} requested.`, { inventoryId: bucket.id });
  }
  const allocation = tx.insert(schema.inventoryAllocations).values({
    inventoryId: bucket.id, qty: input.qty, status: "Allocated",
    orderId: input.orderId ?? null, orderLineId: input.orderLineId ?? null,
    workOrderId: input.workOrderId ?? null, workOrderComponentId: input.workOrderComponentId ?? null,
    jobId: input.jobId ?? null, taskId: input.taskId ?? null, algorithmId: input.algorithmId ?? null,
    ruleName: input.ruleName ?? null, waveId: input.waveId ?? null, createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning().get();
  const updated = syncAllocated(tx, bucket.id);
  const txn = writeTxn(tx, ctx, {
    type: "Allocation", from: updated, to: updated, uomQty: input.qty,
    packQty: Math.floor(input.qty / packRatio(tx, bucket.productId, bucket.packType)),
    refs: { orderId: input.orderId, orderLineId: input.orderLineId, workOrderId: input.workOrderId, jobId: input.jobId, ...input.refs },
  });
  return { allocation, txn };
}

export interface ReleaseInput {
  readonly allocationId: string;
  /** Defaults to the whole allocation. */
  readonly qty?: number;
  readonly refs?: TxnRefs;
}

/** Posts an Allocation Cancel. Only stock that has not been picked can be released. */
export function releaseAllocation(tx: Tx, ctx: DomainCtx, input: ReleaseInput): { released: number; txn: TxnRow | null } {
  const alloc = getAllocation(tx, input.allocationId);
  if (alloc.status !== "Allocated") {
    throw new DomainError("INVALID_STATE", `This allocation is ${alloc.status.toLowerCase()}; only unpicked allocations can be released.`);
  }
  const qty = input.qty ?? alloc.qty;
  if (!Number.isInteger(qty) || qty <= 0 || qty > alloc.qty) throw new DomainError("VALIDATION", `Release quantity must be between 1 and ${alloc.qty}`);
  const remaining = alloc.qty - qty;
  tx.update(schema.inventoryAllocations)
    .set(remaining === 0 ? { status: "Cancelled", updatedBy: ctx.userId } : { qty: remaining, updatedBy: ctx.userId })
    .where(eq(schema.inventoryAllocations.id, alloc.id)).run();
  const bucket = syncAllocated(tx, alloc.inventoryId);
  const txn = writeTxn(tx, ctx, {
    type: "Allocation Cancel", from: bucket, to: bucket, uomQty: qty,
    packQty: Math.floor(qty / packRatio(tx, bucket.productId, bucket.packType)),
    refs: { orderId: alloc.orderId, orderLineId: alloc.orderLineId, workOrderId: alloc.workOrderId, jobId: alloc.jobId, ...input.refs },
  });
  return { released: qty, txn };
}

/** Document references of an allocation (for split rows). */
function copyOf(a: AllocationRow): Omit<typeof schema.inventoryAllocations.$inferInsert, "qty" | "inventoryId"> {
  return {
    orderId: a.orderId, orderLineId: a.orderLineId, workOrderId: a.workOrderId, workOrderComponentId: a.workOrderComponentId,
    jobId: a.jobId, taskId: a.taskId, algorithmId: a.algorithmId, ruleName: a.ruleName, waveId: a.waveId,
  };
}

/**
 * Moves `qty` of an allocation to another bucket (pick/pack/sort/load). Returns the id of
 * the allocation row that now points at the target (the same row when fully moved).
 */
export function carryAllocation(tx: Tx, ctx: DomainCtx, alloc: AllocationRow, qty: number, targetId: string, targetStatus: InventoryStatus): string {
  const status = allocationStatusFor(targetStatus);
  if (qty === alloc.qty) {
    tx.update(schema.inventoryAllocations).set({ inventoryId: targetId, status, updatedBy: ctx.userId })
      .where(eq(schema.inventoryAllocations.id, alloc.id)).run();
    return alloc.id;
  }
  tx.update(schema.inventoryAllocations).set({ qty: alloc.qty - qty, updatedBy: ctx.userId })
    .where(eq(schema.inventoryAllocations.id, alloc.id)).run();
  return tx.insert(schema.inventoryAllocations)
    .values({ ...copyOf(alloc), inventoryId: targetId, qty, status, createdBy: ctx.userId, updatedBy: ctx.userId })
    .returning({ id: schema.inventoryAllocations.id }).get().id;
}

/** Marks `qty` of an allocation consumed (Shipped for shipments, Cancelled otherwise). */
export function consumeAllocation(tx: Tx, ctx: DomainCtx, alloc: AllocationRow, qty: number, shipped: boolean): void {
  const status: AllocationStatus = shipped ? "Shipped" : "Cancelled";
  if (qty === alloc.qty) {
    tx.update(schema.inventoryAllocations).set({ status, updatedBy: ctx.userId }).where(eq(schema.inventoryAllocations.id, alloc.id)).run();
    return;
  }
  tx.update(schema.inventoryAllocations).set({ qty: alloc.qty - qty, updatedBy: ctx.userId })
    .where(eq(schema.inventoryAllocations.id, alloc.id)).run();
  tx.insert(schema.inventoryAllocations).values({ ...copyOf(alloc), inventoryId: alloc.inventoryId, qty, status, createdBy: ctx.userId, updatedBy: ctx.userId }).run();
}
