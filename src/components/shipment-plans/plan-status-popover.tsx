"use client";

/**
 * Status pill + clickable status icon (Logiwa parity). The popover lists only the legal
 * next statuses from the state machine; "Shipped" routes to Ship, "Cancelled" confirms.
 */
import * as React from "react";
import { ArrowRight, PencilLine } from "lucide-react";
import type { ShipmentPlanStatus } from "@/lib/enums";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusPill } from "@/components/ui/status-pill";
import { Tooltip } from "@/components/ui/tooltip";
import { STATUS_HINT } from "./plans-client";

export interface PlanStatusPopoverProps {
  readonly status: ShipmentPlanStatus;
  readonly nextStatuses: readonly ShipmentPlanStatus[];
  /** Null = may change; otherwise the reason the icon is disabled. */
  readonly disabledReason: string | null;
  readonly onPick: (status: ShipmentPlanStatus) => void;
}

export function PlanStatusPopover({ status, nextStatuses, disabledReason, onPick }: PlanStatusPopoverProps) {
  const [open, setOpen] = React.useState(false);
  const reason = disabledReason ?? (nextStatuses.length === 0 ? `${status} is a final status` : null);
  const icon = (
    <button
      type="button"
      aria-label={`Change status (currently ${status})`}
      disabled={Boolean(reason)}
      onClick={(e) => e.stopPropagation()}
      className="flex h-6 w-6 items-center justify-center rounded-md text-secondary transition-colors hover:bg-surface-sunken hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <PencilLine className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <StatusPill status={status} domain="shipmentPlan" />
      {reason ? (
        <Tooltip content={reason}><span>{icon}</span></Tooltip>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{icon}</PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-1.5">
            <p className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">Move to</p>
            <ul role="menu" className="flex flex-col">
              {nextStatuses.map((s) => (
                <li key={s} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      onPick(s);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-sunken focus-visible:bg-surface-sunken focus-visible:outline-none"
                  >
                    <ArrowRight className="h-3 w-3 shrink-0 text-faint" aria-hidden />
                    <span className="flex min-w-0 flex-col">
                      <StatusPill status={s} domain="shipmentPlan" size="sm" className="self-start" />
                      <span className="mt-0.5 text-[11px] text-secondary">{STATUS_HINT[s]}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}
