/**
 * Picking task handler: moves the allocated stock to the target (tote / cart / pack
 * station) as `Picked`, updates the line's picked qty and handles pick-short:
 * `missing_log` row, pick short status Open, allocation released (unless the client
 * retains allocations during missing) and, when asked, a resolution job.
 */
import { eq } from "drizzle-orm";
import { clientSettingsSchema, parseSettings } from "@/lib/domain-types";
import * as schema from "@/server/db/schema";
import { reallocateLine } from "../allocation";
import { DomainError } from "../errors";
import { createResolutionJob, releaseForLine } from "../jobs";
import { getAllocation } from "../ledger/allocations";
import { getBucket } from "../ledger/bucket";
import { move } from "../ledger/operations";
import { pickSerial } from "../ledger/serials";
import type { DomainCtx, Tx } from "../types";
import { assertExecutable, assertQty, bumpLine, completeTask, markOrderShort, reducePlanned } from "./shared";
import type { TaskExecuteInput, TaskExecution, TaskHandler, TaskRow } from "./types";

function retainsAllocation(tx: Tx, clientId: string): boolean {
  const client = tx.select({ settings: schema.clients.settings }).from(schema.clients).where(eq(schema.clients.id, clientId)).get();
  return parseSettings(clientSettingsSchema, client?.settings).fulfillment.retainAllocationDuringMissing;
}

function handleShort(tx: Tx, ctx: DomainCtx, task: TaskRow, input: TaskExecuteInput, allocationId: string, shortQty: number): string | null {
  const alloc = getAllocation(tx, allocationId);
  const bucket = getBucket(tx, alloc.inventoryId);
  const job = tx.select().from(schema.jobs).where(eq(schema.jobs.id, task.jobId)).get();
  const retain = bucket.clientId ? retainsAllocation(tx, bucket.clientId) : false;
  tx.insert(schema.missingLog).values({
    waveNo: job?.waveNumber ?? null, jobId: task.jobId, taskId: task.id, orderId: task.orderId, productId: bucket.productId,
    locationId: bucket.locationId, lpId: bucket.lpId, packType: bucket.packType, missingQty: shortQty, inventoryQty: bucket.onHand,
    isRetain: retain, notes: input.note ?? null, warehouseId: bucket.warehouseId, clientId: bucket.clientId ?? "", enteredBy: ctx.source,
  }).run();
  if (task.orderId) markOrderShort(tx, ctx, task.orderId, "pick");
  if (task.orderLineId) {
    tx.update(schema.orderLineShortages).set({ missingTriggered: true }).where(eq(schema.orderLineShortages.orderLineId, task.orderLineId)).run();
  }
  if (retain) return null;
  releaseForLine(tx, ctx, alloc, shortQty);
  if (!input.createResolutionJob || !task.orderLineId || !task.orderId) {
    if (task.orderLineId) reducePlanned(tx, task.orderLineId, shortQty);
    return null;
  }
  const before = new Set(tx.select({ id: schema.inventoryAllocations.id }).from(schema.inventoryAllocations)
    .where(eq(schema.inventoryAllocations.orderLineId, task.orderLineId)).all().map((r) => r.id));
  const got = reallocateLine(tx, ctx, { orderLineId: task.orderLineId, excludeLocationIds: [bucket.locationId] });
  reducePlanned(tx, task.orderLineId, shortQty - got);
  const created = tx.select({ id: schema.inventoryAllocations.id }).from(schema.inventoryAllocations)
    .where(eq(schema.inventoryAllocations.orderLineId, task.orderLineId)).all().map((r) => r.id).filter((id) => !before.has(id));
  return createResolutionJob(tx, ctx, { sourceJobId: task.jobId, orderId: task.orderId, allocationIds: created })?.id ?? null;
}

export const executePicking: TaskHandler = (tx, ctx, task, input): TaskExecution => {
  assertExecutable(task);
  if (!task.allocationId) throw new DomainError("INVALID_STATE", `Picking task ${task.taskNo} has no allocation.`);
  const alloc = getAllocation(tx, task.allocationId);
  if (alloc.status !== "Allocated") throw new DomainError("INVALID_STATE", `Picking task ${task.taskNo} was already picked.`);
  const remaining = Math.min(task.plannedQty - task.actualQty, alloc.qty);
  const qty = input.qty ?? remaining;
  assertQty(qty, remaining, "Picked");
  if (input.serials && input.serials.length > 0 && input.serials.length !== qty) {
    throw new DomainError("VALIDATION", `${qty} serial numbers are required; ${input.serials.length} scanned.`);
  }
  if (qty > 0) {
    const moved = move(tx, ctx, {
      inventoryId: alloc.inventoryId, qty, toLocationId: input.targetLocationId, toLpId: input.targetLpId ?? null,
      toStatus: "Picked", allocationId: alloc.id, type: "Picking", refs: { jobId: task.jobId, taskId: task.id },
      // Scanned serials are moved one by one below; otherwise the ledger carries serials itself.
      carrySerials: !(input.serials && input.serials.length > 0),
    });
    for (const serial of input.serials ?? []) {
      pickSerial(tx, ctx, { productId: moved.source.productId, serial, orderLineId: task.orderLineId ?? "", fromInventoryId: moved.source.id, toInventoryId: moved.target.id, txnId: moved.txn.id });
    }
    if (task.orderLineId) bumpLine(tx, ctx, task.orderLineId, "pickedQuantity", qty);
  }
  const shortQty = remaining - qty;
  // After a partial pick the original allocation row keeps the short remainder at the source.
  const resolutionJobId = shortQty > 0 ? handleShort(tx, ctx, task, input, alloc.id, shortQty) : null;
  completeTask(tx, ctx, task, { doneQty: qty, targetLocationId: input.targetLocationId, targetLpId: input.targetLpId, pickShort: shortQty > 0 });
  return { taskId: task.id, doneQty: qty, shortQty, resolutionJobId };
};
