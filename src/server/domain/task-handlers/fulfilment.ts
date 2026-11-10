/**
 * Sorting, Packing and Loading task handlers. Each moves the order's committed stock
 * from one status to the next through the ledger, carrying its allocations:
 *   Sorting  Picked          -> Sorted   (per order line)
 *   Packing  Picked | Sorted -> Packed   (per order line)
 *   Loading  Packed          -> Loaded   (per order)
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import type { InventoryStatus, TxnType } from "@/lib/enums";
import * as schema from "@/server/db/schema";
import { DomainError } from "../errors";
import { move } from "../ledger/operations";
import type { Tx } from "../types";
import { assertExecutable, assertQty, bumpLine, completeTask, markOrderShort } from "./shared";
import type { TaskExecution, TaskHandler, TaskRow } from "./types";

type LineColumn = "sortedQuantity" | "packedQuantity" | "loadedQuantity";

interface StepSpec {
  readonly from: (tx: Tx, task: TaskRow) => readonly InventoryStatus[];
  readonly to: InventoryStatus;
  readonly type: TxnType;
  readonly column: LineColumn;
  readonly perLine: boolean;
}

function committed(tx: Tx, task: TaskRow, statuses: readonly InventoryStatus[], perLine: boolean) {
  const a = schema.inventoryAllocations;
  const where = [inArray(a.status, statuses.map((s) => (s === "Stock" ? "Allocated" : s)))];
  if (perLine) {
    if (!task.orderLineId) throw new DomainError("INVALID_STATE", `Task ${task.taskNo} has no order line.`);
    where.push(eq(a.orderLineId, task.orderLineId));
  } else {
    if (!task.orderId) throw new DomainError("INVALID_STATE", `Task ${task.taskNo} has no order.`);
    where.push(eq(a.orderId, task.orderId));
  }
  return tx.select().from(a).where(and(...where)).orderBy(a.createdAt).all();
}

function makeHandler(step: StepSpec): TaskHandler {
  return (tx, ctx, task, input): TaskExecution => {
    assertExecutable(task);
    const allocs = committed(tx, task, step.from(tx, task), step.perLine);
    const available = allocs.reduce((s, a) => s + a.qty, 0);
    const qty = input.qty ?? available;
    assertQty(qty, available, step.type);
    let left = qty;
    const perLine = new Map<string, number>();
    for (const a of allocs) {
      if (left <= 0) break;
      const take = Math.min(a.qty, left);
      move(tx, ctx, {
        inventoryId: a.inventoryId, qty: take, toLocationId: input.targetLocationId, toLpId: input.targetLpId ?? null,
        toStatus: step.to, allocationId: a.id, type: step.type, refs: { jobId: task.jobId, taskId: task.id },
      });
      if (a.orderLineId) perLine.set(a.orderLineId, (perLine.get(a.orderLineId) ?? 0) + take);
      left -= take;
    }
    for (const [lineId, n] of perLine) bumpLine(tx, ctx, lineId, step.column, n);
    const shortQty = available - qty;
    const packShort = step.to === "Packed" && shortQty > 0;
    if (packShort && task.orderId) markOrderShort(tx, ctx, task.orderId, "pack");
    completeTask(tx, ctx, task, { doneQty: qty, targetLocationId: input.targetLocationId, targetLpId: input.targetLpId, packShort });
    return { taskId: task.id, doneQty: qty, shortQty };
  };
}

function hasSortingTask(tx: Tx, task: TaskRow): boolean {
  if (!task.orderLineId) return false;
  return !!tx.select({ id: schema.tasks.id }).from(schema.tasks)
    .where(and(eq(schema.tasks.orderLineId, task.orderLineId), eq(schema.tasks.taskType, "Sorting"), ne(schema.tasks.status, "Cancelled"))).get();
}

export const executeSorting = makeHandler({ from: () => ["Picked"], to: "Sorted", type: "Sorting", column: "sortedQuantity", perLine: true });
export const executePacking = makeHandler({
  from: (tx, task) => (hasSortingTask(tx, task) ? ["Sorted"] : ["Picked"]), to: "Packed", type: "Packing", column: "packedQuantity", perLine: true,
});
export const executeLoading = makeHandler({ from: () => ["Packed"], to: "Loaded", type: "Loading", column: "loadedQuantity", perLine: false });

