"use client";

/**
 * Count toolbar bulk actions (Logiwa 04 §6–§8): every action is a first-class button
 * (Cancel | Update Inv. | Create Job / Create Recount) with Logiwa's (i) help tooltip.
 * Disabled buttons use the neutral greyed style (never a faded red). Below `lg` the
 * actions collapse into one compact "Actions" menu so the toolbar stays on one row at
 * tablet width. Only actions the viewer is permitted to run are passed in.
 */
import * as React from "react";
import { ChevronDown, Info } from "lucide-react";
import { bulkDisabledReason } from "@/components/grid/bulk-actions";
import type { BulkAction } from "@/components/grid/grid-types";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RECOUNT_RULE_HINT } from "@/lib/grid-defs/counts/count-math";
import { DisabledReason, Tooltip } from "@/components/ui/tooltip";

export interface CountBulkAction extends BulkAction {
  /** Logiwa-style (i) help text shown next to the button. */
  readonly info?: string;
}

/** Logiwa tooltip copy for the count bulk actions. */
export const COUNT_ACTION_INFO = {
  updateInv: "Triggers inventory update for count lines with the Count Completed status. Lines in other statuses will be canceled.",
  recount: RECOUNT_RULE_HINT,
  createJob: "Splits pending count plans into Count jobs by location batch so counters can start.",
  cancel: "Cancels the selected records and their open count tasks. Locked locations unlock right away.",
} as const;

export function CountBulkBar({ actions, selectedIds, noun }: { readonly actions: readonly CountBulkAction[]; readonly selectedIds: readonly string[]; readonly noun: string }) {
  if (actions.length === 0) return null;
  return (
    <>
      <div className="hidden items-center gap-1.5 lg:flex" role="group" aria-label="Bulk actions">
        {actions.map((a) => {
          const reason = bulkDisabledReason(a, selectedIds, noun);
          const Icon = a.icon;
          return (
            <span key={a.key} className="inline-flex items-center">
              <DisabledReason reason={reason}>
                <Button variant="secondary" disabled={Boolean(reason)} onClick={() => a.onSelect(selectedIds)}>
                  {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}{a.label}
                </Button>
              </DisabledReason>
              {a.info ? (
                <Tooltip content={a.info}>
                  <button type="button" data-audit-skip="" aria-label={`About ${a.label}`} className="ml-0.5 inline-flex h-6 w-6 items-center justify-center rounded text-faint hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
                    <Info className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </Tooltip>
              ) : null}
            </span>
          );
        })}
      </div>
      {/* Below lg the menu takes its own right-aligned row: the shared toolbar's filter group does not wrap,
          so sharing the row let "Actions" cover the Views / Clear controls at 768px (critic r4). */}
      <div className="flex w-[calc(100vw-7rem)] justify-end lg:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">Actions{selectedIds.length ? ` (${selectedIds.length})` : ""}<ChevronDown className="h-3.5 w-3.5" aria-hidden /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[220px]">
            {actions.map((a) => (
              <DropdownMenuItem key={a.key} icon={a.icon} disabledReason={bulkDisabledReason(a, selectedIds, noun)} onSelect={() => a.onSelect(selectedIds)}>
                {a.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
