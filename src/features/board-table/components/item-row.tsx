'use client';
import { memo, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { Checkbox, cn, labelColorStyle, toLabelColor } from '@/components/ui';
import { Cell, type CellCommitValue, type CellNavDirection } from '@/features/cells';
import type { ColumnDto, ItemDto } from '@/server/services/contracts/dto';
import { columnLabels } from '../lib/cell-text';
import { LAYOUT } from '../lib/rows';
import { ROW_FLASH } from '../hooks/use-remote-flash';
import { useTableStore } from '../state/table-store';
import { groupColorVar, useTable, type GridDirection } from '../table-context';
import { DragGrip } from './drag-grip';
import { NameCell } from './name-cell';
import { RowMenu } from './row-menu';

const NAV: Readonly<Record<CellNavDirection, GridDirection>> = {
  next: 'next',
  prev: 'prev',
  up: 'up',
  down: 'down',
};

export interface ItemRowProps {
  readonly item: ItemDto;
  readonly rowKey: string;
  readonly variant: 'item' | 'subitem';
  readonly groupColor: string;
  readonly index: number;
  readonly start: number;
  readonly height: number;
  readonly width: number;
  /** Visible ids of the row's group/parent in display order (shift-click ranges). */
  readonly siblingIds: readonly string[];
  readonly isLastItem: boolean;
  readonly dragDisabled: boolean;
}

/** One item (or subitem) row: gutter menu + grip, group stripe, checkbox, sticky name, cells. */
export const ItemRow = memo(function ItemRow(props: ItemRowProps) {
  const { item, rowKey, variant, groupColor, index, start, height, width, siblingIds, dragDisabled } = props;
  const table = useTable();
  const { layout, subLayout, users, cellBoard, canEdit, actions, density, navigate } = table;
  const rowLayout = variant === 'subitem' ? subLayout : layout;
  const selected = useTableStore((state) => state.selected.has(item.id));
  const focusCol = useTableStore((state) => (state.focus?.rowKey === rowKey ? state.focus.col : null));
  const expanded = useTableStore((state) => state.expanded.has(item.id));
  const flash = useTableStore((state) => state.flashes[item.id]);
  const drop = useTableStore((state) => (state.drop?.rowKey === rowKey ? state.drop.side : null));
  const toggleSelect = useTableStore((state) => state.toggleSelect);
  const toggleExpanded = useTableStore((state) => state.toggleExpanded);
  const isTemp = item.id.startsWith('temp-');
  const readOnly = !canEdit || isTemp;

  const dragging = useTableStore((state) => state.dragKind === 'item' && state.dragIds.has(item.id));
  const canDrag = !(dragDisabled || readOnly || variant === 'subitem');

  const onCheck = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    toggleSelect(item.id, { range: event.shiftKey, orderedIds: siblingIds });
  };
  const tab = (col: number) => (focusCol === col ? 0 : -1);
  const commit = (column: ColumnDto) => (value: CellCommitValue) => actions.setCell(item, column, value);
  const flashKeys = flash ?? [];
  const nameWidth = variant === 'subitem' ? rowLayout.nameWidth - LAYOUT.subCheck : rowLayout.nameWidth;
  const cellDensity = variant === 'subitem' ? 'compact' : density;

  const style = {
    top: start,
    height,
    width,
    '--bt-group': groupColorVar(groupColor),
  } as CSSProperties;

  return (
    <div
      role="row"
      aria-rowindex={index + 1}
      aria-selected={selected}
      data-kind={variant}
      data-row-key={rowKey}
      data-item-id={item.id}
      data-testid={variant === 'item' ? 'item-row' : 'subitem-row'}
      data-selected={selected ? 'true' : undefined}
      data-pending={isTemp ? 'true' : undefined}
      data-enter={isTemp ? 'true' : undefined}
      data-flash={flashKeys.includes(ROW_FLASH) ? '*' : undefined}
      data-dragging={dragging ? 'true' : undefined}
      data-drop={variant === 'item' ? 'item' : undefined}
      data-group-id={item.groupId}
      className={cn('bt-row', dragging && 'opacity-40', variant === 'subitem' && 'bt-sub-enter')}
      style={style}
    >
      <div className="bt-sticky" style={{ width: rowLayout.stickyWidth }}>
        {/* Gutter background only: its controls live in the checkbox gridcell (grid a11y). */}
        <div className="bt-gutter" aria-hidden />
        <div className="bt-stripe" />
        {variant === 'subitem' ? (
          <div className="bt-sticky-cell justify-end" style={{ width: LAYOUT.check }} aria-hidden>
            <span className="mr-0.5 h-1/2 w-3 self-start rounded-bl-md border-b border-l border-border-strong" />
          </div>
        ) : null}
        <div
          role="gridcell"
          data-grid-col={0}
          tabIndex={tab(0)}
          aria-label={`Select ${item.name}`}
          className="bt-sticky-cell bt-focusable static justify-center"
          style={{ width: variant === 'subitem' ? LAYOUT.subCheck : LAYOUT.check }}
          onClick={onCheck}
          onKeyDown={(event) => {
            if (event.key === ' ' && event.target === event.currentTarget) {
              event.preventDefault();
              toggleSelect(item.id, { range: event.shiftKey, orderedIds: siblingIds });
            }
          }}
        >
          <Checkbox
            checked={selected}
            tabIndex={-1}
            aria-label={`Select ${item.name}`}
            data-testid="row-checkbox"
            onClick={onCheck}
            disabled={isTemp}
          />
          <RowGutterActions>
            <DragGrip
              id={`item:${item.id}`}
              data={{ type: 'item', itemId: item.id, groupId: item.groupId }}
              label={`Drag ${item.name}`}
              disabled={!canDrag}
            />
            <RowMenu item={item} variant={variant} />
          </RowGutterActions>
        </div>
        <NameCell
          item={item}
          rowKey={rowKey}
          width={nameWidth}
          tabIndex={tab(1)}
          variant={variant}
          flash={flashKeys.includes('name')}
          expanded={expanded}
          onToggleExpand={() => toggleExpanded(item.id)}
          readOnly={readOnly}
        />
      </div>
      <div className="bt-body">
        {rowLayout.columns.map((entry, colIndex) => (
          <div
            key={entry.column.id}
            className="bt-cell"
            data-grid-col={colIndex + 2}
            data-collapsed={entry.collapsed ? 'true' : undefined}
            data-flash={flashKeys.includes(entry.column.key) ? 'true' : undefined}
            data-col-drag-source={undefined}
            data-column-cell={entry.column.key}
            style={{ width: entry.width }}
          >
            {entry.collapsed ? (
              <CollapsedCell column={entry.column} item={item} />
            ) : (
              <Cell
                column={entry.column}
                item={item}
                board={cellBoard}
                users={users}
                density={cellDensity}
                readOnly={readOnly}
                tabIndex={tab(colIndex + 2)}
                aria-colindex={colIndex + 3}
                onCommit={commit(entry.column)}
                onNavigate={(direction) => navigate(rowKey, colIndex + 2, NAV[direction])}
              />
            )}
          </div>
        ))}
      </div>
      <div className="bt-tail" />
      {drop ? <span className="bt-drop-line" data-side={drop} aria-hidden /> : null}
    </div>
  );
});

/**
 * Row grip + "…" menu. Rendered inside the checkbox gridcell (so role=row only owns
 * gridcells) but positioned over the gutter at the left edge of the sticky block.
 */
export function RowGutterActions({ children }: { readonly children: ReactNode }) {
  return (
    <div
      className="bt-gutter-actions"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

/** A collapsed column keeps a hint of its content: the status color, nothing otherwise. */
function CollapsedCell({ column, item }: { readonly column: ColumnDto; readonly item: ItemDto }) {
  if (column.type !== 'status') return <span className="flex-1" aria-hidden />;
  const id = (item.values[column.key] as { labelId?: string } | undefined)?.labelId;
  const label = columnLabels(column).find((entry) => entry.id === id);
  if (!label || label.isDefault) return <span className="flex-1" aria-hidden />;
  return (
    <span
      aria-label={label.name}
      title={label.name}
      className="flex-1 bg-[var(--lc-bg)]"
      style={labelColorStyle(toLabelColor(label.color))}
    />
  );
}
