import { cn } from "@/lib/utils";

/**
 * Unified status pill system for the Shipment Orders grid.
 *
 * Every pill gets the SAME treatment — a tinted fill with a 9999px radius and
 * 12px/500 type — so queued stages no longer render as outline pills while
 * in-progress stages render as fills. One tint per semantic group:
 *
 * - queued      (Ready to Pick / Pack / Ship / Load, Allocated) → slate tint
 * - in-progress (Picking / Packing Started, Receiving, …)       → blue tint
 * - attention   (Open, On Hold, Backorder)                      → amber tint
 * - problem     (Shortage, Cancelled, Error)                    → red tint
 * - done        (Shipped, Delivered, Completed, Received)       → green tint
 * - inert       (Pending, Draft, Closed, Inactive, fallback)    → slate tint
 *
 * Colors come from the app's semantic tokens (globals.css) instead of raw hex
 * so the pills stay legible in both themes; the light-theme token values match
 * the spec'd palette (slate #F2F4F7/#475467, blue, amber, red tints).
 */
type StatusGroup = "queued" | "inProgress" | "attention" | "problem" | "done" | "inert";

const GROUP_STYLES: Record<StatusGroup, string> = {
  queued: "bg-neutral-soft text-neutral",
  inProgress: "bg-primary-soft text-primary",
  attention: "bg-warning-soft text-warning",
  problem: "bg-danger-soft text-danger",
  done: "bg-success-soft text-success",
  inert: "bg-neutral-soft text-neutral",
};

const STATUS_GROUPS: Record<string, StatusGroup> = {
  // queued — waiting for an operator to start the next stage
  "ready to pick": "queued",
  "ready to pack": "queued",
  "ready to ship": "queued",
  "ready to load": "queued",
  allocated: "queued",
  // in-progress — actively being worked
  "picking started": "inProgress",
  "packing started": "inProgress",
  "in progress": "inProgress",
  receiving: "inProgress",
  started: "inProgress",
  // attention — awaiting action / blocked on a decision
  open: "attention",
  "on hold": "attention",
  backorder: "attention",
  // problem — something went wrong
  shortage: "problem",
  cancelled: "problem",
  error: "problem",
  // done — terminal success states
  shipped: "done",
  delivered: "done",
  completed: "done",
  received: "done",
  active: "done",
  // inert — dormant states
  pending: "inert",
  draft: "inert",
  closed: "inert",
  inactive: "inert",
};

export interface OrderStatusPillProps {
  status: string;
  className?: string;
}

export function OrderStatusPill({ status, className }: OrderStatusPillProps) {
  const group = STATUS_GROUPS[status.toLowerCase()] ?? "inert";
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-medium leading-4",
        GROUP_STYLES[group],
        className
      )}
    >
      {status}
    </span>
  );
}
