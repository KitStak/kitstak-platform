"use client";

/**
 * Bulk action buttons. Each stays disabled until rows are selected and explains why in
 * a tooltip ("Select at least one order"). The first `inline` actions render as
 * buttons; the rest collapse into an "Actions" menu.
 */
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DisabledReason } from "@/components/ui/tooltip";
import type { BulkAction } from "./grid-types";

export const DEFAULT_EMPTY_REASON = "Select at least one record";

/** Why `action` is unavailable for the selection (count or ids), or null when it can run. */
export function bulkDisabledReason(action: BulkAction, selection: number | readonly string[], noun?: string): string | null {
  const count = typeof selection === "number" ? selection : selection.length;
  if (count === 0) return action.emptyReason ?? (noun ? `Select at least one ${noun}` : DEFAULT_EMPTY_REASON);
  if (action.disabledReason) return action.disabledReason;
  if (action.eligibility && typeof selection !== "number") return action.eligibility(selection);
  return null;
}

export interface BulkActionsProps {
  readonly actions: readonly BulkAction[];
  readonly selectedIds: readonly string[];
  /** Singular noun for the default reason, e.g. "order". */
  readonly noun?: string;
  readonly inline?: number;
}

export function BulkActions({ actions, selectedIds, noun, inline = 2 }: BulkActionsProps) {
  if (actions.length === 0) return null;
  const shown = actions.slice(0, inline);
  const rest = actions.slice(inline);
  return (
    <div className="flex items-center gap-2">
      {shown.map((action) => {
        const reason = bulkDisabledReason(action, selectedIds, noun);
        const Icon = action.icon;
        return (
          <DisabledReason key={action.key} reason={reason}>
            <Button variant={action.destructive ? "danger" : "secondary"} disabled={Boolean(reason)} onClick={() => action.onSelect(selectedIds)}>
              {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
              {action.label}
            </Button>
          </DisabledReason>
        );
      })}
      {rest.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">
              Actions
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            {rest.map((action) => (
              <DropdownMenuItem key={action.key} icon={action.icon} destructive={action.destructive} disabledReason={bulkDisabledReason(action, selectedIds, noun)} onSelect={() => action.onSelect(selectedIds)}>
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
