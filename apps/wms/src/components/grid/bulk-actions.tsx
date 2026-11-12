'use client';

/**
 * Bulk action buttons. Each stays disabled until rows are selected and explains why in
 * a tooltip ("Select at least one order"). The first `inline` actions render as
 * buttons; the rest collapse into an "Actions" menu.
 *
 * A destructive action renders red only while it can run; disabled it uses the same
 * neutral disabled look as every other action. `pending` shows a spinner.
 */
import * as React from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DisabledReason } from '@/components/ui/tooltip';
import type { BulkAction } from './grid-types';

export const DEFAULT_EMPTY_REASON = 'Select at least one record';
export const BULK_PENDING_REASON = 'Working…';

/** Why `action` is unavailable for the selection (count or ids), or null when it can run. */
export function bulkDisabledReason(
  action: BulkAction,
  selection: number | readonly string[],
  noun?: string,
): string | null {
  if (action.pending) return BULK_PENDING_REASON;
  const count = typeof selection === 'number' ? selection : selection.length;
  if (count === 0) return action.emptyReason ?? (noun ? `Select at least one ${noun}` : DEFAULT_EMPTY_REASON);
  if (action.disabledReason) return action.disabledReason;
  if (action.eligibility && typeof selection !== 'number') return action.eligibility(selection);
  return null;
}

/** Button variant for a bulk action: danger only when destructive and runnable. */
export function bulkVariant(action: BulkAction, reason: string | null): 'danger' | 'secondary' {
  return action.destructive && !reason ? 'danger' : 'secondary';
}

export interface BulkActionsProps {
  readonly actions: readonly BulkAction[];
  readonly selectedIds: readonly string[];
  /** Singular noun for the default reason, e.g. "order". */
  readonly noun?: string;
  /** How many actions render as buttons before the rest collapse into "Actions" (default 2; 0 = all in the menu). */
  readonly inline?: number;
}

export function BulkActions({ actions, selectedIds, noun, inline = 2 }: BulkActionsProps) {
  if (actions.length === 0) return null;
  const count = Math.max(0, inline);
  const shown = actions.slice(0, count);
  const rest = actions.slice(count);
  return (
    <div className="flex items-center gap-2">
      {shown.map((action) => {
        const reason = bulkDisabledReason(action, selectedIds, noun);
        const Icon = action.pending ? Loader2 : action.icon;
        return (
          <DisabledReason key={action.key} reason={action.pending ? null : reason}>
            <Button
              variant={bulkVariant(action, reason)}
              disabled={Boolean(reason)}
              aria-busy={action.pending || undefined}
              title={!reason ? action.info : undefined}
              onClick={() => action.onSelect(selectedIds)}
            >
              {Icon ? (
                <Icon className={action.pending ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} aria-hidden />
              ) : null}
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
              <DropdownMenuItem
                key={action.key}
                icon={action.icon}
                destructive={action.destructive}
                description={action.info}
                disabledReason={bulkDisabledReason(action, selectedIds, noun)}
                onSelect={() => action.onSelect(selectedIds)}
              >
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
