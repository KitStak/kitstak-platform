'use client';

/**
 * Phone fallback for DataGrid (below `md` / 768px a wide table shows ~2 columns and no
 * context). A page opts in by passing `renderMobileCard` to DataGrid; the table hides on
 * phones and this tappable card list renders instead, sharing the grid's data, loading /
 * error / empty states, row-click navigation and `useRowNav` pending overlay. Other grids
 * adopt the pattern by supplying their own `renderMobileCard`.
 */
import * as React from 'react';
import { AlertTriangle, ChevronRight, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const SKELETON_CARDS = 6;

export interface MobileCardListProps<T> {
  readonly data: readonly T[];
  readonly getRowId: (row: T) => string;
  /** Card body for one row (title line, meta line, chips — the page decides). */
  readonly renderCard: (row: T) => React.ReactNode;
  readonly onRowClick?: (row: T) => void;
  /** Row navigating away (useRowNav): its card shows a pending overlay. */
  readonly pendingRowId?: string | null;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onRetry?: () => void;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly className?: string;
}

function CenteredState({ children }: { readonly children: React.ReactNode }) {
  return <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">{children}</div>;
}

export function MobileCardList<T>({
  data,
  getRowId,
  renderCard,
  onRowClick,
  pendingRowId,
  loading = false,
  error = null,
  onRetry,
  emptyTitle,
  emptyDescription,
  className,
}: MobileCardListProps<T>) {
  if (loading) {
    return (
      <div role="status" aria-label="Loading" className={cn('flex flex-col gap-2 p-3', className)}>
        {Array.from({ length: SKELETON_CARDS }, (_, i) => (
          <div key={i} className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-4 w-20 rounded-full" />
            </div>
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <CenteredState>
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-danger-soft">
          <AlertTriangle className="h-5 w-5 text-danger" aria-hidden />
        </span>
        <p className="text-base font-semibold text-foreground">Something went wrong</p>
        <p className="max-w-sm text-xs text-faint">{error}</p>
        {onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </CenteredState>
    );
  }
  if (data.length === 0) {
    return (
      <CenteredState>
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-soft">
          <Inbox className="h-5 w-5 text-faint" aria-hidden />
        </span>
        <p className="text-base font-semibold text-foreground">{emptyTitle}</p>
        <p className="max-w-sm text-xs text-faint">{emptyDescription}</p>
      </CenteredState>
    );
  }
  return (
    <ul className={cn('flex flex-col gap-2 p-3', className)}>
      {data.map((row) => {
        const id = getRowId(row);
        const pending = pendingRowId != null && pendingRowId === id;
        const body = (
          <>
            <span className="min-w-0 flex-1">{renderCard(row)}</span>
            {onRowClick ? (
              <ChevronRight className="h-4 w-4 shrink-0 self-center text-faint" aria-hidden />
            ) : null}
          </>
        );
        return (
          <li key={id}>
            {onRowClick ? (
              <button
                type="button"
                data-testid="grid-mobile-card"
                data-row-id={id}
                data-pending-nav={pending || undefined}
                aria-busy={pending || undefined}
                onClick={pending ? undefined : () => onRowClick(row)}
                className="flex w-full gap-2 rounded-lg border border-border bg-surface p-3 text-left transition-colors active:bg-surface-sunken"
              >
                {body}
              </button>
            ) : (
              <div className="flex w-full gap-2 rounded-lg border border-border bg-surface p-3">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
