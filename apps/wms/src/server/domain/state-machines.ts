/**
 * Status machines (BUILD_PLAN 0.4 #2, F5). Status changes go through
 * `stateMachines.<entity>.transition()`; an invalid change throws INVALID_STATE with a
 * human message. `canTransition()` returns the same reason so the UI can disable an
 * action and show the reason as a tooltip.
 *
 * Machines are pure; callers persist the returned status.
 */
import type {
  BILL_STATUSES,
  COUNT_LINE_STATUSES,
  CountPlanStatus,
  EOD_STATUSES,
  JobStatus,
  PoStatus,
  ReturnStatus,
  ShipmentPlanStatus,
  SoStatus,
  TaskStatus,
  WaveStatus,
  WorkOrderStatus,
} from "@/lib/enums";
import { DomainError } from "./errors";

export type TransitionCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface GuardContext {
  /** SO: status before On Hold, required to release a hold. */
  readonly previousStatus?: string;
  /** Cancel reason (SO cancel requires one). */
  readonly reason?: string | null;
  /** PO: number of active receipts. */
  readonly activeReceipts?: number;
  readonly [key: string]: unknown;
}

interface Guard<S extends string> {
  readonly from?: readonly S[];
  readonly to: readonly S[];
  readonly check: (from: S, to: S, ctx: GuardContext) => string | null;
}

export interface StateMachine<S extends string> {
  readonly name: string;
  readonly statuses: readonly S[];
  readonly terminal: readonly S[];
  canTransition(from: S, to: S, ctx?: GuardContext): TransitionCheck;
  /** Asserts the transition and returns `to`. */
  transition(from: S, to: S, ctx?: GuardContext): S;
  /** Statuses reachable in one step from `from` (ignoring guards). */
  nextStatuses(from: S): readonly S[];
  /** Shortest valid path from -> to (excluding `from`), or null. Guards are not evaluated. */
  path(from: S, to: S): readonly S[] | null;
}

function defineMachine<S extends string>(
  name: string,
  edges: Readonly<Record<S, readonly S[]>>,
  terminalMessages: Partial<Record<S, string>>,
  guards: readonly Guard<S>[] = [],
): StateMachine<S> {
  const statuses = Object.keys(edges) as S[];
  const terminal = statuses.filter((s) => edges[s].length === 0);
  const canTransition = (from: S, to: S, ctx: GuardContext = {}): TransitionCheck => {
    if (!(from in edges)) return { ok: false, reason: `Unknown ${name} status "${from}".` };
    if (from === to && !terminalMessages[from]) return { ok: false, reason: `The ${name} is already ${to}.` };
    if (!edges[from].includes(to)) {
      const reason = terminalMessages[from] ?? `A ${name} in ${from} status can't be changed to ${to}.`;
      return { ok: false, reason };
    }
    for (const guard of guards) {
      if (!guard.to.includes(to) || (guard.from && !guard.from.includes(from))) continue;
      const failure = guard.check(from, to, ctx);
      if (failure) return { ok: false, reason: failure };
    }
    return { ok: true };
  };
  return {
    name,
    statuses,
    terminal,
    canTransition,
    transition(from, to, ctx) {
      const result = canTransition(from, to, ctx);
      if (!result.ok) throw new DomainError("INVALID_STATE", result.reason, { machine: name, from, to });
      return to;
    },
    nextStatuses: (from) => edges[from] ?? [],
    path(from, to) {
      if (from === to) return [];
      const prev = new Map<S, S>();
      const queue: S[] = [from];
      const seen = new Set<S>([from]);
      while (queue.length > 0) {
        const cur = queue.shift() as S;
        for (const nxt of edges[cur] ?? []) {
          if (seen.has(nxt)) continue;
          seen.add(nxt);
          prev.set(nxt, cur);
          if (nxt === to) {
            const out: S[] = [to];
            let p = cur;
            while (p !== from) { out.unshift(p); p = prev.get(p) as S; }
            return out;
          }
          queue.push(nxt);
        }
      }
      return null;
    },
  };
}

/* ------------------------------------------------------------ shipment order */
const SO_HOLDABLE: readonly SoStatus[] = ["Open", "Shortage", "Ready to Pick", "Ready to Sort", "Ready to Pack", "Ready to Load", "Ready to Ship"];
const SO_CANCELLABLE: readonly SoStatus[] = ["Open", "Shortage", "Ready to Pick", "On Hold"];

const soEdges: Record<SoStatus, readonly SoStatus[]> = {
  "Open": ["Ready to Pick", "Shortage", "On Hold", "Cancelled"],
  "Shortage": ["Ready to Pick", "Open", "On Hold", "Cancelled"],
  "Ready to Pick": ["Picking Started", "Open", "Shortage", "On Hold", "Cancelled"],
  "Picking Started": ["Ready to Sort", "Ready to Pack", "Ready to Load", "Ready to Ship"],
  "Ready to Sort": ["Sorting Started", "On Hold"],
  "Sorting Started": ["Ready to Pack", "Ready to Ship"],
  "Ready to Pack": ["Packing Started", "On Hold"],
  "Packing Started": ["Ready to Load", "Ready to Ship"],
  "Ready to Load": ["Loading Started", "On Hold"],
  "Loading Started": ["Ready to Ship"],
  "Ready to Ship": ["Shipped", "Partially Shipped", "On Hold"],
  "Partially Shipped": ["Shipped"],
  "Shipped": ["Delivered"],
  "Delivered": [],
  "Cancelled": [],
  "On Hold": [...SO_HOLDABLE, "Cancelled"],
};

const shipmentOrder = defineMachine<SoStatus>("shipment order", soEdges, {
  "Cancelled": "Cancelled orders can't be changed.",
  "Delivered": "Delivered orders can't be changed.",
  "Picking Started": "Picking has started for this order. Complete or cancel its job first.",
  "Sorting Started": "Sorting has started for this order.",
  "Packing Started": "Packing has started for this order.",
  "Loading Started": "Loading has started for this order.",
}, [
  {
    to: ["Cancelled"],
    check: (from, _to, ctx) => {
      if (!SO_CANCELLABLE.includes(from)) return "Only orders that have not started picking can be cancelled.";
      return ctx.reason ? null : "A cancel reason is required.";
    },
  },
  {
    from: ["On Hold"],
    to: SO_HOLDABLE,
    check: (_from, to, ctx) =>
      ctx.previousStatus === undefined || ctx.previousStatus === to ? null : `An order on hold returns to its previous status (${ctx.previousStatus}).`,
  },
]);

/* ---------------------------------------------------------------------- PO */
const purchaseOrder = defineMachine<PoStatus>("purchase order", {
  Pending: ["Started", "Receiving", "Completed", "Cancelled"],
  Started: ["Receiving", "Completed", "Cancelled"],
  // Receiving -> Started: a partial receive settles as Started (M05 §4; the ledger marks Receiving in-transaction).
  Receiving: ["Started", "Completed", "Cancelled"],
  // Re-open (Logiwa "Change Purchase Order Status"): Completed -> Started clears the completion stamps.
  Completed: ["Started"],
  Cancelled: [],
}, {
  Completed: "A purchase order in completed status can't be changed.",
  Cancelled: "Cancelled purchase orders can't be changed.",
}, [{
  to: ["Cancelled"],
  check: (_f, _t, ctx) => ((ctx.activeReceipts ?? 0) > 0 ? "Cancel the received lines before cancelling the purchase order." : null),
}]);

/* ------------------------------------------------------------- job / task */
const job = defineMachine<JobStatus>("job", {
  "Pending": ["Started", "In Progress", "Completed", "Cancelled"],
  "Started": ["In Progress", "Completed", "Cancelled"],
  "In Progress": ["Started", "Completed", "Cancelled"],
  "Completed": [],
  "Cancelled": [],
}, { Completed: "Completed jobs can't be changed.", Cancelled: "Cancelled jobs can't be changed." });

const task = defineMachine<TaskStatus>("task", {
  Pending: ["Started", "Completed", "Cancelled"],
  Started: ["Completed", "Cancelled"],
  Completed: [],
  Cancelled: [],
}, { Completed: "Completed tasks can't be changed.", Cancelled: "Cancelled tasks can't be changed." });

/* -------------------------------------------------------------- counting */
const countPlan = defineMachine<CountPlanStatus>("count plan", {
  "Pending": ["Ready To Count", "Count Started", "Cancelled"],
  "Ready To Count": ["Count Started", "Cancelled"],
  "Count Started": ["Count Completed", "Cancelled"],
  "Count Completed": ["Inventory Updated", "Count Started"],
  "Inventory Updated": [],
  "Cancelled": [],
}, { "Inventory Updated": "Inventory has already been updated for this count." });

type CountLineStatus = (typeof COUNT_LINE_STATUSES)[number];
const countLine = defineMachine<CountLineStatus>("count line", {
  "Pending": ["Ready To Count", "Count Started", "Cancelled"],
  "Ready To Count": ["Count Started", "Cancelled"],
  "Count Started": ["Count Completed", "Cancelled"],
  "Count Completed": ["Inventory Updated", "Recount Created", "Count Started"],
  "Inventory Updated": [],
  // REQ-16: a cancelled recount reopens the original line so its count result can still be posted.
  "Recount Created": ["Count Completed"],
  "Cancelled": [],
}, {});

/* ------------------------------------------------- kitting / returns / plans */
const workOrder = defineMachine<WorkOrderStatus>("work order", {
  "Open": ["In Process", "Shortage", "Cancelled"],
  "Shortage": ["Open", "In Process", "Cancelled"],
  // In Process -> Open: Cancel Picking (components released, picking job cancelled) before any kit is built.
  "In Process": ["Completed", "Cancelled", "Open"],
  "Completed": [],
  "Cancelled": [],
}, {}, [
  {
    from: ["In Process"], to: ["Open"],
    check: (_from, _to, ctx) => (typeof ctx.processedQty === "number" && ctx.processedQty > 0
      ? "Kits have already been built for this work order; picking can't be cancelled."
      : null),
  },
]);

const returnOrder = defineMachine<ReturnStatus>("return", {
  "Pending": ["Started", "In Transit", "Cancelled"],
  "In Transit": ["Started", "Completed", "Cancelled"],
  "Started": ["Completed", "Cancelled"],
  // Reopen a short-closed return only (guarded below).
  "Completed": ["Started"],
  "Cancelled": [],
}, { Completed: "Completed returns can't be changed." }, [
  {
    from: ["Completed"], to: ["Started"],
    check: (_from, _to, ctx) => (typeof ctx.shortQty === "number" && ctx.shortQty > 0
      ? null
      : "Only a short-closed return (units still outstanding) can be reopened."),
  },
]);

const shipmentPlan = defineMachine<ShipmentPlanStatus>("shipment plan", {
  "Open": ["In Progress", "Loading Started", "Cancelled"],
  "In Progress": ["Loading Started", "Cancelled"],
  "Loading Started": ["Loading Completed"],
  "Loading Completed": ["Shipped"],
  "Shipped": [],
  "Cancelled": [],
}, {});

type EodStatus = (typeof EOD_STATUSES)[number];
const endOfDay = defineMachine<EodStatus>("end of day manifest", { Open: ["Closed"], Closed: [] }, {
  Closed: "This end of day manifest is already closed.",
});

type BillStatus = (typeof BILL_STATUSES)[number];
const billingReport = defineMachine<BillStatus>("billing report", {
  Draft: ["Approved", "Canceled"],
  Approved: ["Canceled"],
  Canceled: [],
}, {});

const wave = defineMachine<WaveStatus>("wave", {
  "Pending": ["Preparing For Optimization", "Started", "Completed", "Failed"],
  "Preparing For Optimization": ["Optimizing", "Failed"],
  "Optimizing": ["Optimization Completed", "Failed"],
  "Optimization Completed": ["Started", "Completed", "Failed"],
  "Started": ["In Progress", "Completed", "Failed"],
  "In Progress": ["Completed", "Failed"],
  "Completed": [],
  "Failed": [],
}, {});

export const stateMachines = {
  shipmentOrder,
  purchaseOrder,
  job,
  task,
  countPlan,
  countLine,
  workOrder,
  returnOrder,
  shipmentPlan,
  endOfDay,
  billingReport,
  wave,
} as const;

export type StateMachineKey = keyof typeof stateMachines;
