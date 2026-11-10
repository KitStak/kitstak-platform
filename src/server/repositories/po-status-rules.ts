/**
 * Purchase order status rules (M05). Wraps the shared `stateMachines.purchaseOrder` and adds
 * the Logiwa re-open edge Completed -> Started (REQ-R2-3): the "Change Purchase Order Status"
 * modal can move a Completed order back to Started, which clears Completed / Actual Receiving
 * (see `statusChangeStamps`) so receipts can be cancelled or corrected again.
 *
 * When the shared machine gains the edge this wrapper stays correct (the union is idempotent).
 */
import type { PoStatus } from "@/lib/enums";
import { stateMachines } from "@/server/domain";
import type { GuardContext, TransitionCheck } from "@/server/domain/state-machines";
import { AppError } from "@/server/api/errors";

/** Manual-only edges M05 adds on top of the shared machine. */
export const PO_REOPEN_EDGES: Readonly<Partial<Record<PoStatus, readonly PoStatus[]>>> = { Completed: ["Started"] };

const isReopen = (from: PoStatus, to: PoStatus): boolean => (PO_REOPEN_EDGES[from] ?? []).includes(to);

export function canChangePoStatus(from: PoStatus, to: PoStatus, ctx: GuardContext = {}): TransitionCheck {
  if (isReopen(from, to)) return { ok: true };
  return stateMachines.purchaseOrder.canTransition(from, to, ctx);
}

export function nextPoStatuses(from: PoStatus): readonly PoStatus[] {
  const base = stateMachines.purchaseOrder.nextStatuses(from);
  const extra = (PO_REOPEN_EDGES[from] ?? []).filter((s) => !base.includes(s));
  return [...base, ...extra];
}

/** Asserts a manual status change and returns `to` (INVALID_STATE with the machine's reason otherwise). */
export function assertPoStatusChange(from: PoStatus, to: PoStatus, ctx: GuardContext = {}): PoStatus {
  const check = canChangePoStatus(from, to, ctx);
  if (!check.ok) throw new AppError("INVALID_STATE", check.reason);
  return to;
}
