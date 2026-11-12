'use client';

/**
 * Status pill + clickable status icon (Logiwa parity). The popover lists only the legal
 * next statuses from the state machine; "Shipped" routes to Ship, "Cancelled" confirms.
 */
import * as React from 'react';
import { ArrowRight, ChevronDown } from 'lucide-react';
import type { ShipmentPlanStatus } from '@/lib/enums';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { StatusPill } from '@/components/ui/status-pill';
import { Tooltip } from '@/components/ui/tooltip';
import { STATUS_HINT } from './plans-client';

/** A non-status step offered under the statuses (e.g. "Truck departed" on a loaded plan). */
export interface PlanStatusExtra {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly onSelect: () => void;
}

export interface PlanStatusPopoverProps {
  readonly status: ShipmentPlanStatus;
  readonly nextStatuses: readonly ShipmentPlanStatus[];
  /** Null = may change; otherwise the reason the icon is disabled. */
  readonly disabledReason: string | null;
  readonly onPick: (status: ShipmentPlanStatus) => void;
  /** False when the user may never change statuses: the icon is hidden, not just disabled. */
  readonly canChange?: boolean;
  /** Next statuses shown disabled with the reason (e.g. loading while orders aren't Ready to Ship). */
  readonly blocked?: Readonly<Partial<Record<ShipmentPlanStatus, string>>>;
  readonly extras?: readonly PlanStatusExtra[];
}

export function PlanStatusPopover({
  status,
  nextStatuses,
  disabledReason,
  onPick,
  canChange = true,
  blocked,
  extras = [],
}: PlanStatusPopoverProps) {
  const [open, setOpen] = React.useState(false);
  const reason = disabledReason ?? (nextStatuses.length === 0 ? `${status} is a final status` : null);
  // The pill itself opens the popover (Logiwa parity): a chevron marks it as a control. A blocked or final
  // status keeps a plain pill, with the reason in a tooltip.
  const trigger = (
    <button
      type="button"
      aria-label={`Change status (currently ${status})`}
      aria-haspopup="menu"
      disabled={Boolean(reason)}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-0.5 rounded-full transition-shadow hover:ring-2 hover:ring-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 data-[state=open]:ring-2 data-[state=open]:ring-primary/40 disabled:cursor-not-allowed"
      data-testid="plan-status-trigger"
    >
      <StatusPill status={status} domain="shipmentPlan" />
      <ChevronDown className="h-3.5 w-3.5 text-secondary" aria-hidden />
    </button>
  );
  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {nextStatuses.length === 0 || !canChange ? (
        <StatusPill status={status} domain="shipmentPlan" />
      ) : reason ? (
        <Tooltip content={reason}>
          <span className="inline-flex">
            <StatusPill status={status} domain="shipmentPlan" />
          </span>
        </Tooltip>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-1.5">
            <p className="px-2 pb-1.5 pt-1 text-2xs font-semibold text-faint">Move to</p>
            <ul role="menu" className="flex flex-col">
              {nextStatuses.map((s) => (
                <li key={s} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={Boolean(blocked?.[s])}
                    aria-disabled={Boolean(blocked?.[s])}
                    onClick={() => {
                      if (blocked?.[s]) return;
                      setOpen(false);
                      onPick(s);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-sunken focus-visible:bg-surface-sunken focus-visible:outline-none disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    <ArrowRight className="h-3 w-3 shrink-0 text-faint" aria-hidden />
                    <span className="flex min-w-0 flex-col">
                      <StatusPill status={s} domain="shipmentPlan" size="sm" className="self-start" />
                      <span
                        className={
                          blocked?.[s]
                            ? 'mt-0.5 text-2xs font-medium text-warning'
                            : 'mt-0.5 text-2xs text-secondary'
                        }
                      >
                        {blocked?.[s] ?? STATUS_HINT[s]}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {extras.map((x) => (
                <li key={x.key} role="none" className="mt-1 border-t border-border pt-1">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      x.onSelect();
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-sunken focus-visible:bg-surface-sunken focus-visible:outline-none"
                  >
                    <ArrowRight className="h-3 w-3 shrink-0 text-faint" aria-hidden />
                    <span className="flex min-w-0 flex-col">
                      <span className="text-xs font-semibold text-foreground">{x.label}</span>
                      <span className="mt-0.5 text-2xs text-secondary">{x.hint}</span>
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
