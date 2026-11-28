import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from './cn';
import { ScrollX } from './scroll-x';

/**
 * Plain data table shared with KitStak WMS. One density and one header style everywhere:
 * 36px rows, sentence-case 12px medium muted headers, 1px row dividers, tabular numerals.
 */
export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /**
   * Every table sits in a `ScrollX` region: when it is wider than its card it scrolls sideways
   * with a tab stop, a name and a fade cue (CONTRACTS 19.8). Pass false for a table that is
   * already inside a `ScrollX` of its own.
   */
  readonly scroll?: boolean;
  /** Extra classes for the scroll region around the table. */
  readonly scrollClassName?: string;
}

export function Table({ className, scroll = true, scrollClassName, ...props }: TableProps) {
  const table = <table className={cn('w-full border-collapse text-left text-sm text-fg tabular-nums', className)} {...props} />;
  if (!scroll) return table;
  return (
    <ScrollX label={props['aria-label'] ?? 'Table'} className={scrollClassName}>
      {table}
    </ScrollX>
  );
}

/**
 * Surface classes for a body cell pinned to an edge with `position: sticky`. The row hover color is
 * see through, so a pinned cell keeps its solid panel color and lays the hover tint over it: the
 * columns that scroll under it never show through. The row needs the `group` class.
 */
export const PINNED_CELL_SURFACE =
  'bg-panel group-hover:bg-[image:linear-gradient(var(--surface-hover),var(--surface-hover))] group-data-[selected=true]:bg-selected';

export function TableHead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-panel shadow-[inset_0_-1px_0_var(--border-default)]', className)} {...props} />;
}

export function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn('h-9 border-b border-border-subtle transition-colors last:border-b-0 hover:bg-hover data-[selected=true]:bg-selected', className)}
      {...props}
    />
  );
}

export interface TableHeaderCellProps extends ThHTMLAttributes<HTMLTableCellElement> {
  readonly numeric?: boolean;
}

export function TableHeaderCell({ className, numeric, scope = 'col', ...props }: TableHeaderCellProps) {
  return (
    <th
      scope={scope}
      className={cn('h-9 px-3 align-middle text-xs font-medium whitespace-nowrap text-fg-muted', numeric && 'text-right', className)}
      {...props}
    />
  );
}

export interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  readonly numeric?: boolean;
}

export function TableCell({ className, numeric, ...props }: TableCellProps) {
  return <td className={cn('px-3 py-1.5 align-middle', numeric && 'text-right', className)} {...props} />;
}

export interface TablePaginationProps {
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
  readonly onPageChange: (page: number) => void;
  /** Left-aligned extras (page size select, selection count). */
  readonly children?: ReactNode;
  readonly className?: string;
}

const pagerButton =
  'inline-flex size-7 items-center justify-center rounded-md text-fg-secondary transition-colors hover:bg-hover hover:text-fg ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-[0.38]';

/** Pagination footer: total on the left, "page / pages" with previous and next on the right. */
export function TablePagination({ page, pageCount, total, onPageChange, children, className }: TablePaginationProps) {
  const pages = Math.max(1, pageCount);
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border-subtle bg-panel px-4 py-2 text-xs text-fg-muted', className)}>
      <div className="flex min-w-0 items-center gap-3">
        {children}
        <span className="whitespace-nowrap">
          Total: <span className="font-medium text-fg tabular-nums">{total.toLocaleString('en-US')}</span>
        </span>
      </div>
      <nav aria-label="Pagination" className="flex shrink-0 items-center gap-1">
        <button type="button" aria-label="Previous page" className={pagerButton} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft aria-hidden className="size-4" />
        </button>
        <span className="px-1 tabular-nums">
          <span className="font-medium text-fg">{page.toLocaleString('en-US')}</span> / {pages.toLocaleString('en-US')}
        </span>
        <button type="button" aria-label="Next page" className={pagerButton} disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          <ChevronRight aria-hidden className="size-4" />
        </button>
      </nav>
    </div>
  );
}
