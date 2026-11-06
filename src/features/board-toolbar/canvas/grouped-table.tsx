'use client';

/**
 * Table view regrouped by a column ("Group by" in the toolbar). Board groups are replaced by
 * buckets (status labels, people, date ranges…) for this view only. Rows are virtualized,
 * cells are fully editable (same cell components as the main table), and the name opens the
 * item panel. Grid keyboard: arrows move between cells, Enter edits (handled by the cell).
 */
import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, Maximize2, MessageCircle } from 'lucide-react';
import { Avatar, EmptyState, Tooltip, cn } from '@/components/ui';
import { countLabel, filterItems, sortItems, type OpenItemOptions } from '@/features/board-table';
import { Cell, CellServicesProvider, useBoardCellServices, type CellBoard, type CellCommitValue, type CellDensity } from '@/features/cells';
import { useUpdateCell } from '@/lib/hooks';
import type { BoardPayloadDto, ColumnDto, ItemDto } from '@/server/services/contracts/dto';
import type { GroupBySpec, ToolbarDraft } from '../lib/draft';
import { bucketItems, type ItemBucket } from '../lib/group-by';

const ROW: Readonly<Record<CellDensity, number>> = { compact: 32, default: 36, comfortable: 40 };
const HEADER = 44;
const COLUMN_HEADER = 36;
const GAP = 24;
const NAME_WIDTH = 340;

type Row =
  | { readonly kind: 'group'; readonly bucket: ItemBucket; readonly collapsed: boolean }
  | { readonly kind: 'columns'; readonly bucket: ItemBucket }
  | { readonly kind: 'item'; readonly bucket: ItemBucket; readonly item: ItemDto }
  | { readonly kind: 'gap'; readonly key: string };

export interface GroupedTableProps {
  readonly boardId: string;
  readonly payload: BoardPayloadDto;
  readonly working: ToolbarDraft;
  readonly groupBy: GroupBySpec;
  readonly search: string;
  readonly density: CellDensity;
  readonly widths: Readonly<Record<string, number>>;
  readonly onOpenItem: (itemId: string, options?: OpenItemOptions) => void;
  readonly onClearGroupBy: () => void;
}

export function GroupedTable(props: GroupedTableProps) {
  const { payload, working, groupBy, boardId } = props;
  const board = payload.board;
  const noun = board.itemTerminology || 'Item';
  const columns = useMemo(() => payload.columns.filter((column) => column.scope === 'item'), [payload.columns]);
  const groupColumn = columns.find((column) => column.key === groupBy.columnKey);
  const shownColumns = useMemo(
    () => columns.filter((column) => column.type !== 'name' && !working.hiddenColumnKeys.includes(column.key)),
    [columns, working.hiddenColumnKeys],
  );
  const nameColumn = columns.find((column) => column.type === 'name');
  const topItems = useMemo(
    () => payload.items.filter((item) => !item.parentItemId && !item.archivedAt && !item.deletedAt),
    [payload.items],
  );
  const usersById = useMemo(() => new Map(payload.users.map((user) => [user.id, user])), [payload.users]);
  const visible = useMemo(() => {
    const ctx = { columns, users: usersById };
    const state = { filters: working.filters, search: props.search, personFilter: working.personFilter, sort: working.sort };
    return sortItems(filterItems(topItems, state, ctx), state, ctx);
  }, [columns, props.search, topItems, usersById, working.filters, working.personFilter, working.sort]);
  const buckets = useMemo(
    () => (groupColumn ? bucketItems(visible, groupColumn, groupBy, payload.users) : []),
    [groupBy, groupColumn, payload.users, visible],
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const bucket of buckets) {
      const isCollapsed = collapsed.has(bucket.key);
      out.push({ kind: 'group', bucket, collapsed: isCollapsed });
      if (!isCollapsed) {
        out.push({ kind: 'columns', bucket });
        for (const item of bucket.items) out.push({ kind: 'item', bucket, item });
      }
      out.push({ kind: 'gap', key: `gap-${bucket.key}` });
    }
    return out;
  }, [buckets, collapsed]);

  const rowHeight = ROW[props.density];
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const row = rows[index];
      return row?.kind === 'group' ? HEADER : row?.kind === 'columns' ? COLUMN_HEADER : row?.kind === 'gap' ? GAP : rowHeight;
    },
    overscan: 12,
  });

  const services = useBoardCellServices(boardId, topItems);
  const updateCell = useUpdateCell();
  const cellBoard = useMemo<CellBoard>(
    () => ({ id: board.id, itemTerminology: noun, columns: payload.columns, groups: payload.groups, canEdit: board.canEdit }),
    [board.canEdit, board.id, noun, payload.columns, payload.groups],
  );
  const commit = (item: ItemDto, column: ColumnDto) => (value: CellCommitValue) =>
    updateCell.mutateAsync({ boardId, itemId: item.id, columnKey: column.key, value });
  const widthOf = (column: ColumnDto) => props.widths[column.key] ?? column.width;
  const totalWidth = NAME_WIDTH + shownColumns.reduce((sum, column) => sum + widthOf(column), 0);

  if (!groupColumn) {
    return (
      <EmptyState
        title="The grouping column was removed"
        description="Pick another column to group by, or go back to board groups."
        actions={
          <button type="button" className="text-base font-medium text-fg-link hover:underline" onClick={props.onClearGroupBy}>
            Use board groups
          </button>
        }
      />
    );
  }
  if (visible.length === 0) {
    return (
      <EmptyState
        illustration="search"
        title={`No ${countLabel(0, noun).replace(/^0 /, '').toLowerCase()} match this view`}
        description="Try clearing a filter or the search."
      />
    );
  }

  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <CellServicesProvider value={services}>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto"
        role="grid"
        aria-label={`${board.name} grouped by ${groupColumn.title}`}
        aria-rowcount={visible.length}
        data-testid="board-table"
        data-grouped-by={groupColumn.key}
      >
        <div className="relative px-8 max-md:px-4" style={{ height: virtualizer.getTotalSize(), minWidth: totalWidth + 64 }}>
          {virtualizer.getVirtualItems().map((virtual) => {
            const row = rows[virtual.index];
            if (!row || row.kind === 'gap') return null;
            const color = `var(--label-${row.bucket.color})`;
            const style = { top: virtual.start, height: virtual.size, width: totalWidth } as const;
            if (row.kind === 'group') {
              return (
                <div key={`g-${row.bucket.key}`} role="row" className="absolute left-8 flex items-end pb-1.5 max-md:left-4" style={style} data-testid="board-group">
                  <div role="rowheader" className="sticky left-8 flex items-center gap-2">
                    <button
                      type="button"
                      aria-expanded={!row.collapsed}
                      onClick={() => toggle(row.bucket.key)}
                      className="flex items-center gap-1.5 rounded-sm px-1 font-heading text-md font-semibold transition-colors duration-[var(--duration-instant)] hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
                      style={{ color: `var(--label-${row.bucket.color}-text, ${color})` }}
                    >
                      <ChevronDown aria-hidden className={cn('size-4 transition-transform duration-[var(--duration-fast)]', row.collapsed && '-rotate-90')} />
                      {row.bucket.userId ? <Avatar name={row.bucket.title} colorKey={row.bucket.userId} size="xs" /> : null}
                      {row.bucket.title}
                    </button>
                    <span className="text-sm text-fg-muted tabular-nums">{countLabel(row.bucket.items.length, noun).toLowerCase()}</span>
                  </div>
                </div>
              );
            }
            if (row.kind === 'columns') {
              return (
                <div
                  key={`c-${row.bucket.key}`}
                  role="row"
                  className="absolute left-8 flex rounded-t-md border-y border-border-subtle bg-panel text-sm font-medium text-fg-secondary max-md:left-4"
                  style={style}
                >
                  <div role="columnheader" className="sticky left-0 z-[1] flex shrink-0 items-center border-l-[6px] bg-panel px-3" style={{ width: NAME_WIDTH, borderLeftColor: color }}>
                    {nameColumn?.title ?? noun}
                  </div>
                  {shownColumns.map((column) => (
                    <div role="columnheader" key={column.id} className="flex shrink-0 items-center justify-center truncate border-l border-border-subtle px-2" style={{ width: widthOf(column) }}>
                      <span className="truncate">{column.title}</span>
                    </div>
                  ))}
                </div>
              );
            }
            const item = row.item;
            return (
              <div
                key={`i-${row.bucket.key}-${item.id}`}
                role="row"
                data-testid="item-row"
                data-item-id={item.id}
                className="group/row absolute left-8 flex border-b border-border-subtle bg-panel transition-colors duration-[var(--duration-instant)] hover:bg-hover max-md:left-4"
                style={style}
              >
                <div role="gridcell" className="sticky left-0 z-[1] flex shrink-0 items-center gap-1 border-l-[6px] bg-inherit pr-2 pl-3" style={{ width: NAME_WIDTH, borderLeftColor: color }}>
                  <button
                    type="button"
                    onClick={() => props.onOpenItem(item.id)}
                    className="min-w-0 flex-1 truncate rounded-xs text-left text-base text-fg hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                    title={item.name}
                  >
                    {item.name}
                  </button>
                  <Tooltip content="Open">
                    <button
                      type="button"
                      aria-label={`Open ${item.name}`}
                      onClick={() => props.onOpenItem(item.id)}
                      className="inline-flex size-6 items-center justify-center rounded-xs text-icon opacity-0 transition-opacity group-hover/row:opacity-100 hover:bg-pressed focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus"
                    >
                      <Maximize2 aria-hidden className="size-3.5" />
                    </button>
                  </Tooltip>
                  <Tooltip content={item.updateCount ? `${item.updateCount} updates` : 'Add an update'}>
                    <button
                      type="button"
                      aria-label={`Updates for ${item.name}`}
                      onClick={() => props.onOpenItem(item.id, { tab: 'updates' })}
                      className={cn(
                        'inline-flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-xs px-1 text-xs transition-opacity hover:bg-pressed focus-visible:outline-2 focus-visible:outline-focus',
                        item.updateCount ? 'text-primary-text' : 'text-icon opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100',
                      )}
                    >
                      <MessageCircle aria-hidden className="size-3.5" />
                      {item.updateCount ? <span className="tabular-nums">{item.updateCount}</span> : null}
                    </button>
                  </Tooltip>
                </div>
                {shownColumns.map((column) => (
                  <div role="gridcell" key={column.id} data-column-key={column.key} data-column-type={column.type} className="flex shrink-0 items-stretch border-l border-border-subtle" style={{ width: widthOf(column) }}>
                    <Cell
                      column={column}
                      item={item}
                      board={cellBoard}
                      users={payload.users}
                      density={props.density}
                      readOnly={!board.canEdit}
                      reportsErrors
                      onCommit={commit(item, column)}
                    />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </CellServicesProvider>
  );
}
