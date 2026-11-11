/**
 * Local adapters around shared behaviour M08 has requested from foundation
 * (docs/requests/work-orders-kitting.md). They code against the intended interface so the
 * module keeps working before and after the F-patch lands:
 *
 *   REQ-1  `stateMachines.workOrder` edge In Process → Open (Cancel Picking).
 *   REQ-3  a domain writer for work-order allocation exceptions. Until it exists this adapter
 *          writes the row itself with the same shape `domain/allocation.ts` uses.
 */
import type { WorkOrderStatus } from "@/lib/enums";
import * as schema from "@/server/db/schema";
import * as allocationDomain from "@/server/domain/allocation";
import { DomainError } from "@/server/domain/errors";
import { stateMachines } from "@/server/domain/state-machines";
import type { DomainCtx, Tx } from "@/server/domain/types";

export const WORK_ORDER_EXCEPTION_WAVE = "Manual Allocation - Work Order";
export const WORK_ORDER_ALGORITHM = "Work order components";

/** "Reopen" path used by Cancel Picking while REQ-1 is pending: In Process → Open is not an edge yet. */
export const CANCEL_PICKING_PENDING_REASON = "Cancel Picking on In Process work orders needs the In Process → Open status edge (foundation request REQ-1).";

/** Validates (and returns) a work order status change through the shared machine. */
export function transitionWorkOrder(from: WorkOrderStatus, to: WorkOrderStatus, opts: { readonly dryRun?: boolean } = {}): WorkOrderStatus {
  const check = stateMachines.workOrder.canTransition(from, to);
  if (!check.ok) {
    const reason = from === "In Process" && to === "Open" ? CANCEL_PICKING_PENDING_REASON : check.reason;
    throw new DomainError("INVALID_STATE", reason, { machine: "work order", from, to });
  }
  return opts.dryRun ? from : to;
}

/** True when the shared machine already allows Cancel Picking from In Process. */
export const canReopenInProcess = (): boolean => stateMachines.workOrder.canTransition("In Process", "Open").ok;

interface ExceptionInput {
  readonly workOrder: { readonly id: string; readonly warehouseId: string; readonly clientId: string };
  readonly productId: string;
  readonly inventoryQty: number;
  readonly requiredQty: number;
}

type ExceptionWriter = (tx: Tx, ctx: DomainCtx, input: ExceptionInput & { readonly waveNo: string; readonly explanation: string }) => void;

export async function recordWorkOrderException(tx: Tx, ctx: DomainCtx, input: ExceptionInput): Promise<void> {
  const shared = (allocationDomain as unknown as { readonly recordWorkOrderException?: ExceptionWriter }).recordWorkOrderException;
  const payload = { ...input, waveNo: WORK_ORDER_EXCEPTION_WAVE, explanation: allocationDomain.EXPLANATION_SHORTAGE };
  if (typeof shared === "function") {
    await shared(tx, ctx, payload);
    return;
  }
  await tx.insert(schema.allocationExceptions).values({
    orderId: input.workOrder.id, waveNo: WORK_ORDER_EXCEPTION_WAVE, algorithmName: WORK_ORDER_ALGORITHM, algorithmRuleName: null,
    shortageProductId: input.productId, inventoryUomQty: Math.max(0, input.inventoryQty), orderLineQty: input.requiredQty,
    explanation: allocationDomain.EXPLANATION_SHORTAGE, runBy: ctx.source, warehouseId: input.workOrder.warehouseId, clientId: input.workOrder.clientId,
  });
}
