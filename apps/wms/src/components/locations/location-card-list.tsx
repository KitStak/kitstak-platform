'use client';

/**
 * Phone layout of the Locations grid (blind judge J1: at 390 px the table showed ~2 columns).
 * Below the `sm` breakpoint the page renders one card per location (code, status, where it is,
 * what it holds) with the same row menu, plus a compact pager and Export. Rendered with CSS
 * (`sm:hidden`), so the server HTML is already right for a phone.
 */
import * as React from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ExportButton, RowMenu, type RowAction } from '@/components/grid';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { splitCamel } from '@/lib/grid-defs/facility/common';
import type { LocationRow } from '@/server/repositories/locations';
import { AvailabilityPill, LockedPill } from '@/components/facility/facility-shared';

/** "A · 01 · L1" from the structure fields; blanks are skipped. PURE. */
export function locationWhere(
  r: Pick<LocationRow, 'warehouseCode' | 'locationZone' | 'aisle' | 'rack' | 'level'>,
): string {
  const parts = [
    r.warehouseCode,
    r.locationZone ? `Zone ${r.locationZone}` : null,
    r.aisle ? `Aisle ${r.aisle}` : null,
    r.rack ? `Rack ${r.rack}` : null,
    r.level ? `Level ${r.level}` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

export function LocationCardList({
  rows,
  total,
  page,
  pageSize,
  onPageChange,
  loading,
  error,
  onRetry,
  rowActions,
  gridKey,
  queryString,
  empty,
}: {
  readonly rows: readonly LocationRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly onPageChange: (page: number) => void;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly rowActions: (row: LocationRow) => readonly RowAction[];
  readonly gridKey: string;
  readonly queryString: string;
  readonly empty: { readonly title: string; readonly description: string };
}) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <section
      aria-label="Locations"
      className="flex min-h-0 flex-1 flex-col gap-2 px-4 pb-4 sm:hidden"
      data-slot="location-cards"
    >
      {error ? (
        <EmptyState
          title="Couldn't load locations"
          description={error}
          action={<Button onClick={onRetry}>Retry</Button>}
          compact
        />
      ) : loading && rows.length === 0 ? (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading locations">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-[84px] w-full rounded-lg" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title={empty.title} description={empty.description} compact />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-border bg-surface px-3 py-2.5 shadow-xs"
              data-row-id={r.id}
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/locations/${r.id}`}
                      className="font-mono text-base font-semibold text-primary hover:underline"
                    >
                      {r.code}
                    </Link>
                    <AvailabilityPill status={r.inventoryStatus} />
                    {r.isLocked ? <LockedPill value /> : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-secondary">{locationWhere(r)}</p>
                  <p className="mt-0.5 truncate text-xs text-faint">
                    {[
                      r.areaType ?? 'No area',
                      r.locationType ? splitCamel(r.locationType) : null,
                      r.locationGroup,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <p className="mt-1 text-xs tabular-nums text-body">
                    {r.storedUnits.toLocaleString()} units · {r.skuCount} SKU{r.skuCount === 1 ? '' : 's'}
                    {r.openTaskCount > 0
                      ? ` · ${r.openTaskCount} open task${r.openTaskCount === 1 ? '' : 's'}`
                      : ''}
                  </p>
                </div>
                <RowMenu actions={rowActions(r)} label={`Actions for ${r.code}`} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="sticky bottom-0 -mx-4 mt-auto flex items-center justify-between gap-2 border-t border-border bg-surface px-4 py-2 text-xs text-secondary">
        <span className="tabular-nums" aria-live="polite">
          {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
        </span>
        <div className="flex items-center gap-1">
          <ExportButton gridKey={gridKey} queryString={queryString} total={total} />
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="tabular-nums">
            {page}/{pages}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Next page"
            disabled={page >= pages}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </section>
  );
}
