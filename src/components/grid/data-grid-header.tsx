"use client";

/**
 * Header row for `DataGrid`: sort buttons (shift-click = multi-sort), `?` header tips,
 * drag-to-reorder grips (dnd-kit), resize handles, and pinned/sticky cell placement.
 */
import * as React from "react";
import { flexRender, type Header, type Table } from "@tanstack/react-table";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { ArrowDown, ArrowUp, ArrowUpDown, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/ui/info-tip";
import type { SortSpec } from "@/server/query/grid-query";
import { sortIndicator } from "./grid-sort";
import { cellPlacement, columnLabel, isSystemColumn, sortFieldOf } from "./data-grid-columns";

interface HeaderCellProps<T> {
  readonly header: Header<T, unknown>;
  readonly sort: readonly SortSpec[];
  readonly onSort: (field: string, additive: boolean) => void;
  readonly reorderable: boolean;
  readonly stickyRightOffset: number;
}

function HeaderCell<T>({ header, sort, onSort, reorderable, stickyRightOffset }: HeaderCellProps<T>) {
  const column = header.column;
  const meta = column.columnDef.meta;
  const system = isSystemColumn(column.id);
  const canDrag = reorderable && !system && !column.getIsPinned();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.id, disabled: !canDrag });
  const name = columnLabel(column.columnDef, column.id);
  const placement = cellPlacement(column, header.getContext().table, stickyRightOffset);
  const field = sortFieldOf(column);
  const indicator = column.getCanSort() ? sortIndicator(sort, field) : null;
  const label = header.isPlaceholder ? null : flexRender(column.columnDef.header, header.getContext());
  const ariaSort = indicator ? (indicator.dir === "asc" ? "ascending" : "descending") : column.getCanSort() ? "none" : undefined;

  return (
    <th
      ref={setNodeRef}
      scope="col"
      aria-sort={ariaSort}
      style={{
        ...placement.style,
        transform: transform ? `translate3d(${transform.x}px, 0, 0)` : undefined,
        transition,
      }}
      className={cn(
        "group/th relative whitespace-nowrap py-2.5 align-middle text-[11px] font-semibold uppercase tracking-[0.04em] text-secondary",
        meta?.cellPadding ?? "px-3",
        meta?.align === "right" ? "text-right" : "text-left",
        placement.className,
        placement.sticky && "bg-surface",
        isDragging && "z-30 bg-primary-soft opacity-90"
      )}
    >
      <span className={cn("inline-flex items-center gap-1", meta?.align === "right" && "flex-row-reverse", meta?.headerClassName)}>
        {canDrag ? (
          <button type="button" aria-label={`Move ${name} column`} className="-ml-2 flex h-5 w-4 cursor-grab items-center justify-center rounded text-faint opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 group-hover/th:opacity-100" {...attributes} {...listeners}>
            <GripVertical className="h-3 w-3" aria-hidden />
          </button>
        ) : null}
        {column.getCanSort() ? (
          <button
            type="button"
            onClick={(e) => onSort(field, e.shiftKey)}
            title="Click to sort · Shift-click to add a sort"
            className="inline-flex items-center gap-1 uppercase transition-colors hover:text-foreground focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            {label}
            {indicator ? (
              <span className="inline-flex items-center text-primary">
                {indicator.dir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />}
                {indicator.position ? <sup className="text-[9px] font-bold">{indicator.position}</sup> : null}
              </span>
            ) : (
              <ArrowUpDown data-sort-affordance="" className="h-3 w-3 text-faint opacity-0 transition-opacity group-hover/th:opacity-100 group-focus-within/th:opacity-100" aria-hidden />
            )}
          </button>
        ) : (
          label
        )}
        {meta?.headerTip ? <InfoTip content={meta.headerTip} label={`About ${name}`} /> : null}
      </span>
      {column.getCanResize() ? (
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${name} column`}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={header.getResizeHandler()}
          onTouchStart={header.getResizeHandler()}
          onDoubleClick={() => column.resetSize()}
          className={cn("absolute right-0 top-1/2 h-5 w-1.5 -translate-y-1/2 cursor-col-resize touch-none rounded-full transition-colors hover:bg-primary/40", column.getIsResizing() ? "bg-primary" : "bg-transparent group-hover/th:bg-border-strong")}
        />
      ) : null}
    </th>
  );
}

export interface DataGridHeaderProps<T> {
  readonly table: Table<T>;
  readonly sort: readonly SortSpec[];
  readonly onSort: (field: string, additive: boolean) => void;
  readonly onReorder?: (id: string, beforeId: string | null) => void;
  readonly stickyRightOffset: number;
}

function headerIds<T>(table: Table<T>): readonly string[] {
  return (table.getHeaderGroups()[0]?.headers ?? []).map((h) => h.column.id);
}

/**
 * Drag context for header reordering. Rendered OUTSIDE the <table> (dnd-kit adds
 * screen-reader helper <div>s, which are invalid inside <thead>) with a stable id so
 * server and client markup match.
 */
export function HeaderDndContext<T>({ table, onReorder, children }: { readonly table: Table<T>; readonly onReorder?: (id: string, beforeId: string | null) => void; readonly children: React.ReactNode }) {
  const id = React.useId();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!onReorder || !over || active.id === over.id) return;
    const ids = headerIds(table);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    // Moving right: insert after the target, i.e. before the target's next sibling.
    const beforeId = from < to ? (ids[to + 1] ?? null) : String(over.id);
    onReorder(String(active.id), beforeId);
  };
  return (
    <DndContext id={id} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      {children}
    </DndContext>
  );
}

export function DataGridHeader<T>({ table, sort, onSort, onReorder, stickyRightOffset }: DataGridHeaderProps<T>) {
  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  return (
    <thead className="sticky top-0 z-20 bg-surface shadow-[inset_0_-1px_0_var(--border)]">
      <SortableContext items={headers.map((h) => h.column.id)} strategy={horizontalListSortingStrategy}>
        <tr>
          {headers.map((header) => (
            <HeaderCell key={header.id} header={header} sort={sort} onSort={onSort} reorderable={Boolean(onReorder)} stickyRightOffset={stickyRightOffset} />
          ))}
        </tr>
      </SortableContext>
    </thead>
  );
}
