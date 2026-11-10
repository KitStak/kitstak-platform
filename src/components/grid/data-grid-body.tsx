"use client";

/**
 * Body for `DataGrid`: loading skeleton, error (Retry), empty state, rows with pinned /
 * sticky cells, optional expanded detail rows, and windowed rendering once a page holds
 * more than `VIRTUALIZE_ABOVE` rows.
 */
import * as React from "react";
import { flexRender, type Row, type Table } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { VIRTUALIZE_ABOVE, type GridDensity } from "./grid-types";
import { cellPlacement } from "./data-grid-columns";

export const ROW_HEIGHT: Readonly<Record<GridDensity, number>> = { Large: 48, Small: 40 };
const SKELETON_ROWS = 12;
const OVERSCAN = 12;

export interface DataGridBodyProps<T> {
  readonly table: Table<T>;
  readonly density: GridDensity;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry?: () => void;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly emptyAction?: React.ReactNode;
  readonly onRowClick?: (row: T) => void;
  readonly renderExpanded?: (row: T) => React.ReactNode;
  readonly stickyRightOffset: number;
  readonly scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Absolute index of the first row on this page (for aria-rowindex). */
  readonly rowOffset?: number;
  readonly highlightRowId?: string | null;
}

function FullRow({ colSpan, children }: { readonly colSpan: number; readonly children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan}>
        <div className="sticky left-0 flex w-full max-w-[100vw] flex-col items-center gap-2 py-16 text-center">{children}</div>
      </td>
    </tr>
  );
}

interface BodyRowProps<T> {
  readonly row: Row<T>;
  readonly table: Table<T>;
  readonly height: number;
  readonly onRowClick?: (row: T) => void;
  readonly renderExpanded?: (row: T) => React.ReactNode;
  readonly stickyRightOffset: number;
  readonly measureRef?: (el: HTMLTableRowElement | null) => void;
  readonly index?: number;
  readonly rowOffset?: number;
}

function BodyRow<T>({ row, table, height, onRowClick, renderExpanded, stickyRightOffset, measureRef, index, rowOffset = 0 }: BodyRowProps<T>) {
  const selected = row.getIsSelected();
  const cells = row.getVisibleCells();
  return (
    <>
      <tr
        ref={measureRef}
        role="row"
        data-index={index ?? row.index}
        data-row-id={row.id}
        aria-rowindex={rowOffset + row.index + 2}
        aria-selected={selected || undefined}
        onClick={onRowClick ? () => onRowClick(row.original) : undefined}
        style={{ height }}
        className={cn("group border-t border-border transition-colors", onRowClick && "cursor-pointer", selected ? "bg-primary-soft/60" : "hover:bg-surface-sunken")}
      >
        {cells.map((cell) => {
          const placement = cellPlacement(cell.column, table, stickyRightOffset);
          const meta = cell.column.columnDef.meta;
          const align = meta?.align;
          return (
            <td
              key={cell.id}
              role="cell"
              style={placement.style}
              className={cn(
                "whitespace-nowrap align-middle",
                meta?.clip === false ? "overflow-visible" : "overflow-hidden text-ellipsis",
                meta?.cellPadding ?? "px-3",
                align === "right" && "text-right",
                meta?.justify === "center" && "text-center [&>*]:mx-auto",
                placement.className,
                placement.sticky && (selected ? "bg-primary-soft" : "bg-surface group-hover:bg-surface-sunken")
              )}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </td>
          );
        })}
      </tr>
      {renderExpanded && row.getIsExpanded() ? (
        <tr className="border-t border-border bg-surface-sunken/60">
          <td colSpan={cells.length} className="px-0 py-2">
            {/* Pinned to the visible width so the panel does not scroll away with wide grids. */}
            <div className="sticky left-0 w-[var(--grid-visible-width,100%)] max-w-full px-4">{renderExpanded(row.original)}</div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function VirtualRows<T>({ rows, scrollRef, height, ...rest }: Omit<BodyRowProps<T>, "row" | "measureRef" | "index"> & { readonly rows: readonly Row<T>[]; readonly scrollRef: React.RefObject<HTMLDivElement | null> }) {
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns non-memoisable functions by design
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => height,
    overscan: OVERSCAN,
    getItemKey: (index) => rows[index]?.id ?? index,
  });
  const items = virtualizer.getVirtualItems();
  const colSpan = rest.table.getVisibleLeafColumns().length;
  const top = items[0]?.start ?? 0;
  const bottom = virtualizer.getTotalSize() - (items[items.length - 1]?.end ?? 0);
  return (
    <>
      {top > 0 ? (
        <tr aria-hidden style={{ height: top }}>
          <td colSpan={colSpan} />
        </tr>
      ) : null}
      {items.map((item) => {
        const row = rows[item.index];
        return row ? <BodyRow key={row.id} row={row} height={height} index={item.index} measureRef={virtualizer.measureElement} {...rest} /> : null;
      })}
      {bottom > 0 ? (
        <tr aria-hidden style={{ height: bottom }}>
          <td colSpan={colSpan} />
        </tr>
      ) : null}
    </>
  );
}

/** After 6s of skeletons, say so and offer Retry instead of an endless shimmer. */
function SlowLoadNotice({ colSpan, onRetry }: { readonly colSpan: number; readonly onRetry?: () => void }) {
  const [slow, setSlow] = React.useState(false);
  React.useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 6000);
    return () => window.clearTimeout(t);
  }, []);
  if (!slow) return null;
  return (
    <tr>
      <td colSpan={Math.max(1, colSpan)} className="px-3 py-2">
        <div role="status" className="flex items-center gap-3 text-[12px] text-secondary">
          <span>This is taking longer than usual. The server may be busy.</span>
          {onRetry ? <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button> : null}
        </div>
      </td>
    </tr>
  );
}

export function DataGridBody<T>({ table, density, loading, error, onRetry, emptyTitle, emptyDescription, emptyAction, onRowClick, renderExpanded, stickyRightOffset, scrollRef, rowOffset = 0 }: DataGridBodyProps<T>) {
  const columns = table.getVisibleLeafColumns();
  const height = ROW_HEIGHT[density];
  const rows = table.getRowModel().rows;

  if (loading) {
    return (
      <tbody aria-busy="true">
        <SlowLoadNotice colSpan={columns.length} onRetry={onRetry} />
        {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
          <tr key={i} style={{ height }} className="border-t border-border">
            {columns.map((col) => (
              <td key={col.id} className="px-3">
                <Skeleton className="h-3.5 w-[70%]" />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    );
  }
  if (error) {
    return (
      <tbody>
        <FullRow colSpan={columns.length}>
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-danger-soft">
            <AlertTriangle className="h-5 w-5 text-danger" aria-hidden />
          </span>
          <p className="text-[14px] font-semibold text-foreground">Something went wrong</p>
          <p className="max-w-sm text-[12px] text-faint">{error}</p>
          {onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </FullRow>
      </tbody>
    );
  }
  if (rows.length === 0) {
    return (
      <tbody>
        <FullRow colSpan={columns.length}>
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-soft">
            <Inbox className="h-5 w-5 text-faint" aria-hidden />
          </span>
          <p className="text-[14px] font-semibold text-foreground">{emptyTitle}</p>
          <p className="max-w-sm text-[12px] text-faint">{emptyDescription}</p>
          {emptyAction}
        </FullRow>
      </tbody>
    );
  }
  const rowProps = { table, height, onRowClick, renderExpanded, stickyRightOffset, rowOffset };
  return (
    <tbody>
      {rows.length > VIRTUALIZE_ABOVE ? (
        <VirtualRows rows={rows} scrollRef={scrollRef} {...rowProps} />
      ) : (
        rows.map((row) => <BodyRow key={row.id} row={row} {...rowProps} />)
      )}
    </tbody>
  );
}
