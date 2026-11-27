'use client';

/**
 * Work order status tones: Open is info (new work), so it reads differently from Completed
 * (positive). Other statuses use the shared work-order map. `WoStatusPill` is the grid / header
 * pill (the shared Pill); `WoStatusFilter` is the list's status filter row with a neutral
 * selected state (never crimson).
 */
import * as React from 'react';
import { FilterChip } from '@/components/ui/filter-chip';
import { TonePill } from '@/components/ui/status-pill';
import { statusLabel, statusTone, TONES, type StatusTone } from '@/lib/status-colors';

export function woStatusTone(status: string): StatusTone {
  return status.toLowerCase() === 'open' ? TONES.teal : statusTone(status, 'workOrder');
}

/** Solid accent of a status (the filter chip dot). */
export function woStatusAccent(status: string): string {
  return woStatusTone(status).dot;
}

export function WoStatusPill({
  status,
  className,
}: {
  readonly status: string;
  /** @deprecated Pills have one size; kept so existing call sites compile. */
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}) {
  return (
    <TonePill status={status} tone={woStatusTone(status)} className={className}>
      {statusLabel(status)}
    </TonePill>
  );
}

export interface WoStatusFilterItem {
  readonly key: string;
  readonly label: string;
  /** Formatted count; null while counts load (renders a count skeleton, not "…"). */
  readonly count: string | null;
  /** Tooltip for the count (e.g. why it shows "—"). */
  readonly countTitle?: string;
  /** null = the "All" pill. */
  readonly status: string | null;
  readonly active: boolean;
  readonly onClick: () => void;
}

/** One status filter chip: dot + label + count; the selected one gets the neutral selected surface. */
export function WoStatusFilterPill({ item }: { readonly item: WoStatusFilterItem }) {
  return (
    <FilterChip
      active={item.active}
      onClick={item.onClick}
      dot={item.status ? woStatusAccent(item.status) : undefined}
      label={item.label}
      countTitle={item.countTitle}
      count={
        item.count === null ? (
          <span
            className="inline-block h-2.5 w-5 animate-pulse rounded-full bg-surface-sunken motion-reduce:animate-none"
            aria-label="Loading count"
            role="status"
          />
        ) : (
          item.count
        )
      }
    />
  );
}
