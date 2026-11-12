'use client';
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { ArrowDown, ArrowUp, ChevronsLeftRight, Filter, GripVertical, Info } from 'lucide-react';
import { Checkbox, Tooltip, cn } from '@/components/ui';
import type { ColumnDto } from '@/server/services/contracts/dto';
import type { ColumnLayout, TableLayout } from '../lib/columns';
import { minWidthFor } from '../lib/columns';
import { dropIndex, placementAt, selectionState } from '../lib/ordering';
import { LAYOUT } from '../lib/rows';
import { clampWidth } from '../lib/view-state';
import { useTableStore, useTableStoreApi } from '../state/table-store';
import { groupColorVar, useTable } from '../table-context';
import { AddColumnButton } from './column-center';
import { ColumnMenu } from './column-menu';

const RenameHostContext = createContext(false);

/**
 * dnd-kit renders a role=status live region next to its children; inside role=row that
 * breaks grid semantics, so it is portalled to <body>.
 */
const a11yContainer = { container: typeof document === 'undefined' ? undefined : document.body };

const horizontalOnly = ({
  transform,
}: {
  transform: { x: number; y: number; scaleX: number; scaleY: number };
}) => ({ ...transform, y: 0 });

export interface ColumnHeaderRowProps {
  readonly groupId: string;
  readonly groupColor: string;
  readonly scope: 'item' | 'subitem';
  /** Ids the select-all checkbox controls (visible items of the group / subitems of the parent). */
  readonly itemIds: readonly string[];
  readonly index: number;
  readonly start: number;
  readonly height: number;
  readonly width: number;
  readonly sticky?: boolean;
}

/** Column header row (one per group, plus the sticky overlay copy and subitem headers). */
export const ColumnHeaderRow = memo(function ColumnHeaderRow(props: ColumnHeaderRowProps) {
  const { groupId, groupColor, scope, itemIds, index, start, height, width, sticky } = props;
  const table = useTable();
  const { layout, subLayout, terminology, canEdit, columns, actions, openColumnCenter, addColumn } = table;
  const renameHost = useTableStore((state) => state.renameHost);
  const isRenameHost = scope === 'subitem' || renameHost === (sticky ? 'overlay' : groupId);
  const rowLayout = scope === 'subitem' ? subLayout : layout;
  const store = useTableStoreApi();
  const checked = useTableStore((state) => selectionState(state.selected, itemIds));
  const selectMany = useTableStore((state) => state.selectMany);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const ids = rowLayout.columns.map((entry) => entry.column.id);

  const onDragStart = (event: DragStartEvent) => {
    const column = rowLayout.columns.find((entry) => entry.column.id === event.active.id)?.column;
    store.getState().setDrag('column', column?.key ?? null);
  };
  const onDragEnd = (event: DragEndEvent) => {
    store.getState().setDrag(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const moving = columns.find((column) => column.id === active.id);
    if (!moving) return;
    const siblings = columns.filter((column) => column.scope === scope && column.type !== 'name');
    const fromIndex = ids.indexOf(String(active.id));
    const toIndex = ids.indexOf(String(over.id));
    const movingSet = new Set([moving.id]);
    const target = dropIndex(siblings, movingSet, String(over.id), toIndex > fromIndex ? 'after' : 'before');
    const placement = placementAt(siblings, movingSet, target);
    if (placement) actions.reorderColumn(moving, placement);
  };

  const subNameWidth = rowLayout.nameWidth - LAYOUT.subCheck;
  return (
    <RenameHostContext.Provider value={isRenameHost}>
      <div
        role="row"
        aria-rowindex={sticky ? undefined : index + 1}
        data-kind={scope === 'subitem' ? 'sub-header' : 'column-header'}
        data-testid={scope === 'subitem' ? 'subitem-header' : 'column-header-row'}
        className="bt-row"
        style={
          {
            top: sticky ? undefined : start,
            position: sticky ? 'relative' : undefined,
            height,
            width,
            '--bt-group': groupColorVar(groupColor),
          } as CSSProperties
        }
      >
        <div className="bt-sticky h-full" style={{ width: rowLayout.stickyWidth }}>
          <div className="bt-gutter" />
          <div className="bt-stripe" data-edge={scope === 'item' ? 'top' : undefined} />
          {scope === 'subitem' ? (
            <div className="bt-sticky-cell border-b-0" style={{ width: LAYOUT.check }} aria-hidden />
          ) : null}
          <div
            role="columnheader"
            className="bt-sticky-cell justify-center border-t border-t-border-subtle"
            style={{ width: scope === 'subitem' ? LAYOUT.subCheck : LAYOUT.check }}
          >
            <Checkbox
              checked={checked}
              disabled={itemIds.length === 0}
              aria-label={scope === 'subitem' ? 'Select all subitems' : 'Select all items in this group'}
              data-testid="select-all"
              onCheckedChange={() => selectMany(itemIds)}
            />
          </div>
          {rowLayout.name ? (
            <NameHeader
              column={rowLayout.name}
              width={scope === 'subitem' ? subNameWidth : rowLayout.nameWidth}
              title={scope === 'subitem' ? 'Subitem' : terminology}
            />
          ) : (
            <div
              role="columnheader"
              className="bt-colhead justify-start border-l-0 pl-3"
              style={{ width: scope === 'subitem' ? subNameWidth : rowLayout.nameWidth }}
            >
              {scope === 'subitem' ? 'Subitem' : terminology}
            </div>
          )}
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[horizontalOnly]}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => store.getState().setDrag(null)}
          accessibility={a11yContainer}
        >
          <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
            <div className="flex h-full">
              {rowLayout.columns.map((entry) => (
                <HeaderCell key={entry.column.id} entry={entry} canEdit={canEdit} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        <div
          className="bt-colhead justify-start border-r-0 pl-2"
          style={{ width: LAYOUT.addColumn }}
          role="columnheader"
          aria-label={canEdit ? undefined : 'No more columns'}
        >
          {canEdit ? (
          <AddColumnButton
            label={scope === 'subitem' ? 'Add subitem column' : 'Add column'}
            existingTypes={columns.filter((column) => column.scope === scope).map((column) => column.type)}
            onAdd={(type) => addColumn(type, { scope })}
            onMore={(trigger) => openColumnCenter({ scope, returnFocus: trigger })}
          />
          ) : null}
        </div>
      </div>
    </RenameHostContext.Provider>
  );
});

function useHeaderRename(column: ColumnDto) {
  const { actions } = useTable();
  const host = useContext(RenameHostContext);
  const renaming = useTableStore((state) => state.renameColumnId === column.id) && host;
  const setRenameColumn = useTableStore((state) => state.setRenameColumn);
  return {
    renaming,
    start: () => setRenameColumn(column.id),
    done: (title: string | null) => {
      setRenameColumn(null);
      const next = title?.trim();
      if (next && next !== column.title) void actions.updateColumn(column, { title: next });
    },
  };
}

function HeaderTitle({
  column,
  align,
  canEdit,
}: {
  readonly column: ColumnDto;
  readonly align: 'center' | 'start';
  readonly canEdit: boolean;
}) {
  const rename = useHeaderRename(column);
  const { view } = useTable();
  const sort = view.state.sort.find((rule) => rule.columnKey === column.key);
  const filtered = view.state.filters.rules.some((rule) => rule.columnKey === column.key);
  if (rename.renaming && canEdit) return <HeaderRenameInput initial={column.title} onDone={rename.done} />;
  return (
    <span
      className={cn(
        'flex min-w-0 flex-1 items-center gap-1',
        align === 'center' ? 'justify-center' : 'justify-start',
      )}
    >
      <Tooltip content={column.title} delayDuration={600}>
        <span
          className="min-w-0 truncate"
          data-testid="column-title"
          onDoubleClick={() => {
            if (canEdit) rename.start();
          }}
        >
          {column.title}
        </span>
      </Tooltip>
      {column.description ? (
        <Tooltip content={column.description}>
          <button
            type="button"
            aria-label={`About ${column.title}: ${column.description}`}
            onClick={(event) => event.stopPropagation()}
            className="inline-flex shrink-0 rounded-full text-icon hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus"
          >
            <Info aria-hidden className="size-3.5" />
          </button>
        </Tooltip>
      ) : null}
      {sort ? (
        sort.direction === 'asc' ? (
          <ArrowUp aria-hidden className="size-3.5 shrink-0 text-primary-text" />
        ) : (
          <ArrowDown aria-hidden className="size-3.5 shrink-0 text-primary-text" />
        )
      ) : null}
      {filtered ? (
        <>
          <Filter aria-hidden className="size-3 shrink-0 fill-primary text-primary-text" />
          <span className="sr-only">(filtered)</span>
        </>
      ) : null}
    </span>
  );
}

function HeaderRenameInput({
  initial,
  onDone,
}: {
  readonly initial: string;
  readonly onDone: (title: string | null) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  return (
    <input
      ref={ref}
      value={draft}
      maxLength={255}
      aria-label="Column name"
      data-testid="column-title-input"
      onPointerDown={(event) => event.stopPropagation()}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') finish(draft);
        if (event.key === 'Escape') finish(null);
      }}
      onBlur={() => finish(draft)}
      className="h-7 min-w-0 flex-1 rounded-xs border border-primary bg-panel px-1.5 text-center text-base text-fg outline-none shadow-[0_0_0_2px_var(--focus-ring-soft)]"
    />
  );
}

function ResizeHandle({ column, width }: { readonly column: ColumnDto; readonly width: number }) {
  const { view, autoFit } = useTable();
  const setLiveWidth = useTableStore((state) => state.setLiveWidth);
  const [active, setActive] = useState(false);
  const start = useRef<{ x: number; width: number } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, width };
    setActive(true);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    setLiveWidth(
      column.key,
      clampWidth(start.current.width + event.clientX - start.current.x, minWidthFor(column.type)),
    );
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const next = clampWidth(start.current.width + event.clientX - start.current.x, minWidthFor(column.type));
    start.current = null;
    setActive(false);
    if (next !== width) view.setColumnWidth(column.key, next);
    // Keep the live width until the optimistic view update lands (no snap-back frame).
    window.setTimeout(() => setLiveWidth(column.key, null), 250);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${column.title}`}
      aria-valuenow={width}
      tabIndex={-1}
      data-active={active ? 'true' : undefined}
      data-testid="column-resize"
      className="bt-resize"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(event) => {
        event.stopPropagation();
        autoFit(column);
      }}
    />
  );
}

function NameHeader({
  column,
  width,
  title,
}: {
  readonly column: ColumnDto;
  readonly width: number;
  readonly title: string;
}) {
  const { canEdit } = useTable();
  const openColumnDialog = useTableStore((state) => state.openColumnDialog);
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      role="columnheader"
      data-column-key={column.key}
      data-testid="column-header"
      data-menu-open={menuOpen ? 'true' : undefined}
      className="bt-colhead justify-start gap-1 pl-3"
      style={{ width }}
    >
      <HeaderTitle column={{ ...column, title }} align="start" canEdit={canEdit && column.scope === 'item'} />
      <ColumnMenu
        column={column}
        onOpenChange={setMenuOpen}
        onDialog={(kind) => openColumnDialog({ columnId: column.id, kind })}
      />
      <ResizeHandle column={column} width={width} />
    </div>
  );
}

function HeaderCell({ entry, canEdit }: { readonly entry: ColumnLayout; readonly canEdit: boolean }) {
  const { column, width, collapsed } = entry;
  const { view } = useTable();
  const openColumnDialog = useTableStore((state) => state.openColumnDialog);
  const [menuOpen, setMenuOpen] = useState(false);
  const sortRule = view.state.sort.find((rule) => rule.columnKey === column.key);
  const ariaSort = sortRule ? (sortRule.direction === 'asc' ? 'ascending' : 'descending') : 'none';
  const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({
    id: column.id,
    disabled: !canEdit || collapsed,
  });
  const style: CSSProperties = {
    width,
    transform: transform ? `translate3d(${Math.round(transform.x)}px, 0, 0)` : undefined,
    transition,
  };

  if (collapsed) {
    return (
      <div
        ref={setNodeRef}
        role="columnheader"
        data-column-key={column.key}
        className="bt-colhead px-0"
        style={style}
      >
        <Tooltip content={`Expand ${column.title}`}>
          <button
            type="button"
            aria-label={`Expand column ${column.title}`}
            onClick={() => view.toggleCollapsedColumn(column.key)}
            className="inline-flex size-6 items-center justify-center rounded-sm text-icon hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus"
          >
            <ChevronsLeftRight aria-hidden className="size-3.5" />
          </button>
        </Tooltip>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      role="columnheader"
      aria-sort={ariaSort}
      data-column-key={column.key}
      data-column-type={column.type}
      data-testid="column-header"
      data-dragging={isDragging ? 'true' : undefined}
      data-menu-open={menuOpen ? 'true' : undefined}
      className="bt-colhead gap-0.5"
      style={style}
    >
      {canEdit ? (
        <button
          type="button"
          aria-label={`Reorder ${column.title}`}
          className="bt-reveal -ml-1 inline-flex h-6 w-3.5 shrink-0 cursor-grab items-center justify-center rounded-xs text-icon hover:bg-hover active:cursor-grabbing"
          {...attributes}
          {...listeners}
          tabIndex={-1}
        >
          <GripVertical aria-hidden className="size-3.5" />
        </button>
      ) : (
        <span className="w-3.5" />
      )}
      <HeaderTitle column={column} align="center" canEdit={canEdit} />
      <ColumnMenu
        column={column}
        onOpenChange={setMenuOpen}
        onDialog={(kind) => openColumnDialog({ columnId: column.id, kind })}
      />
      {canEdit ? <ResizeHandle column={column} width={width} /> : null}
    </div>
  );
}

export type { TableLayout };
