/**
 * Kitting task handler (M08; replaces the 0.6 stub). Executing the Kitting task of a
 * "with picking" work order first completes its open picking tasks to the kitting area,
 * then builds `qty` kits (default: every kit still to build) at the task's target —
 * components are consumed through ledger Kitting and the kits arrive as a Kitting receipt.
 */
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { createKit } from "@/server/repositories/work-orders-commands";
import { DomainError } from "../errors";
import { assertExecutable } from "./shared";
import type { TaskExecution, TaskHandler } from "./types";

export const executeKitting: TaskHandler = (tx, ctx, task, input): TaskExecution => {
  assertExecutable(task);
  if (!task.workOrderId) throw new DomainError("INVALID_STATE", `Kitting task ${task.taskNo} has no work order.`);
  const wo = tx.select().from(schema.workOrders).where(eq(schema.workOrders.id, task.workOrderId)).get();
  if (!wo) throw new DomainError("NOT_FOUND", "Work order not found");
  const remaining = Math.max(0, wo.requestedQty - wo.processedQty);
  const qty = input.qty ?? remaining;
  if (!Number.isInteger(qty) || qty < 1 || qty > remaining) throw new DomainError("VALIDATION", `Kitting quantity must be between 1 and ${remaining}.`);
  const kit = tx.select().from(schema.products).where(eq(schema.products.id, wo.kitProductId)).get();
  createKit(tx, ctx, {
    workOrderId: wo.id, qty, locationId: input.targetLocationId, lpId: input.targetLpId ?? null,
    // Scan flows carry no attributes: a lot-tracked kit gets the work order code as its lot.
    lotNumber: kit?.trackLot ? (wo.outputLot ?? wo.code) : null, expiryDate: wo.outputExpiry, productionDate: kit?.trackProductionDate ? new Date().toISOString().slice(0, 10) : null,
  });
  return { taskId: task.id, doneQty: qty, shortQty: 0 };
};
