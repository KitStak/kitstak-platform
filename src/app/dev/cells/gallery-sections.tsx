'use client';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, cn, labelColorStyle, toLabelColor } from '@/components/ui';
import {
  Cell,
  CellEditorPreview,
  CellSummary,
  ColumnTypeIcon,
  EditLabelsDialog,
  LabelEditor,
  columnTypeLabel,
  countLabelUsage,
  focusSiblingCell,
  labelsFromSettings,
  type CellBoard,
  type CellCommitValue,
  type CellDensity,
  type CellNavDirection,
  type CellServices,
} from '@/features/cells';
import { COLUMN_TYPES } from '@/server/db/schema/cell-values';
import type { ColumnDto, ItemDto } from '@/server/services/contracts/dto';
import { GROUPS, USERS } from './fixtures';

type Commit = (item: ItemDto, column: ColumnDto, value: CellCommitValue) => Promise<unknown>;

export function Section({ id, title, description, children }: { readonly id: string; readonly title: string; readonly description?: string; readonly children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20">
      <div className="mb-3 flex flex-col gap-0.5 px-1">
        <h2 id={`${id}-title`} className="text-lg font-semibold text-fg">
          {title}
        </h2>
        {description ? <p className="text-sm text-fg-secondary">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Sticky name column: 280px on desktop, narrower on phones so other columns peek in. */
const NAME_WIDTH = 'min(280px, 46vw)';

function HeaderCell({ column, index }: { readonly column: ColumnDto; readonly index: number }) {
  return (
    <div
      role="columnheader"
      aria-colindex={index}
      style={{ width: column.width }}
      className="flex h-9 shrink-0 items-center justify-center gap-1.5 border-r border-b border-border-subtle px-2 text-sm text-fg-secondary"
    >
      <ColumnTypeIcon type={column.type} size="sm" />
      <span className="truncate">{column.title}</span>
    </div>
  );
}

/** A realistic two-group table with every column type, editable, with footer summaries. */
export function BoardTable({
  columns,
  items,
  board,
  density,
  commit,
}: {
  readonly columns: readonly ColumnDto[];
  readonly items: readonly ItemDto[];
  readonly board: CellBoard;
  readonly density: CellDensity;
  readonly commit: Commit;
}) {
  const nameColumn = columns.find((column) => column.type === 'name') as ColumnDto;
  const rest = columns.filter((column) => column.type !== 'name');
  const [filter, setFilter] = useState<{ key: string; labelId: string | null } | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const visible = filter
    ? items.filter((item) => {
        const value = item.values[filter.key] as { labelId?: string; labelIds?: string[] } | undefined;
        if (filter.labelId === null) return !value;
        return value?.labelId === filter.labelId || value?.labelIds?.includes(filter.labelId);
      })
    : items;
  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (!target.matches('[data-ks-cell]')) return;
    const map: Record<string, CellNavDirection> = { ArrowRight: 'next', ArrowLeft: 'prev', ArrowDown: 'down', ArrowUp: 'up' };
    const direction = map[event.key];
    if (!direction) return;
    event.preventDefault();
    focusSiblingCell(target, direction);
  };
  return (
    <div className="overflow-hidden rounded-xl border border-border-subtle bg-panel shadow-xs">
      {filter ? (
        <div className="flex items-center gap-2 border-b border-border-subtle bg-highlight px-4 py-2 text-sm text-fg">
          Quick filter from the battery is on.
          <Button size="xs" variant="tertiary" onClick={() => setFilter(null)}>
            Clear filter
          </Button>
        </div>
      ) : null}
      <div
        className="group/scroller overflow-x-auto"
        data-scrolled={scrolled ? 'true' : undefined}
        onScroll={(event) => setScrolled(event.currentTarget.scrollLeft > 0)}
      >
        <div role="grid" aria-label="Demo deals board" data-testid="board-table" className="w-max pb-2" onKeyDown={onGridKey}>
          <div role="row" className="sticky top-0 z-[3] flex bg-panel">
            <div role="columnheader" aria-colindex={1} style={{ width: NAME_WIDTH }} className="sticky left-0 z-[2] flex h-9 shrink-0 items-center border-r border-b border-border-subtle bg-panel px-4 text-sm text-fg-secondary transition-shadow duration-[var(--duration-fast)] group-data-[scrolled=true]/scroller:shadow-[6px_0_8px_-6px_rgb(0_0_0/0.28)]">
              {nameColumn.title}
            </div>
            {rest.map((column, columnIndex) => (
              <HeaderCell key={column.id} column={column} index={columnIndex + 2} />
            ))}
          </div>
          {GROUPS.map((group) => {
            const groupItems = visible.filter((item) => item.groupId === group.id);
            const color = toLabelColor(group.color);
            return (
              <div key={group.id} role="rowgroup" data-testid="board-group" data-group-id={group.id} style={labelColorStyle(color)}>
                <div role="row" className="flex">
                  <div role="rowheader" aria-colspan={rest.length + 1} className="sticky left-0 z-[2] flex h-11 w-fit max-w-[100vw] items-end gap-2 px-4 pb-1.5">
                    {/* --lc-text is the label hue tuned for AA on panels in both themes. */}
                    <h3 className="font-heading text-lg font-medium text-[var(--lc-text)]">{group.title}</h3>
                    <span className="pb-0.5 text-sm text-fg-muted">{groupItems.length} deals</span>
                  </div>
                </div>
                {groupItems.map((item, rowIndex) => (
                  <div key={item.id} role="row" data-item-id={item.id} aria-rowindex={rowIndex + 2} className="group/row flex hover:bg-[var(--surface-muted)]">
                    <div style={{ width: NAME_WIDTH }} className="sticky left-0 z-[2] flex shrink-0 border-r border-b border-border-subtle bg-panel group-hover/row:bg-[var(--surface-muted)] transition-shadow duration-[var(--duration-fast)] group-data-[scrolled=true]/scroller:shadow-[6px_0_8px_-6px_rgb(0_0_0/0.28)]">
                      <span aria-hidden className="w-1.5 shrink-0 bg-[var(--lc-bg)]" />
                      <Cell column={nameColumn} item={item} board={board} users={USERS} density={density} aria-colindex={1} onCommit={(value) => commit(item, nameColumn, value)} />
                    </div>
                    {rest.map((column, columnIndex) => (
                      <div key={column.id} style={{ width: column.width }} className="flex shrink-0 border-r border-b border-border-subtle">
                        <Cell
                          column={column}
                          item={item}
                          board={board}
                          users={USERS}
                          density={density}
                          aria-colindex={columnIndex + 2}
                          onCommit={(value) => commit(item, column, value)}
                        />
                      </div>
                    ))}
                  </div>
                ))}
                <div role="row" className="flex" data-testid="group-footer">
                  <div role="gridcell" aria-label={`${group.title} summary`} style={{ width: NAME_WIDTH }} className="sticky left-0 z-[2] shrink-0 bg-panel transition-shadow duration-[var(--duration-fast)] group-data-[scrolled=true]/scroller:shadow-[6px_0_8px_-6px_rgb(0_0_0/0.28)]" />
                  {rest.map((column) => (
                    <div key={column.id} role="gridcell" style={{ width: column.width }} className="shrink-0 border-r border-b border-border-subtle">
                      <CellSummary
                        column={column}
                        items={groupItems}
                        board={board}
                        users={USERS}
                        onFilterLabel={column.type === 'status' || column.type === 'dropdown' ? (labelId) => setFilter({ key: column.key, labelId }) : undefined}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const STATES = ['Display', 'Hover', 'Empty', 'Empty · hover', 'Read-only'] as const;

/** Every column type in display / hover / empty / empty-hover / read-only states. */
export function StateMatrix({
  columns,
  item,
  emptyItem,
  board,
  density,
  commit,
}: {
  readonly columns: readonly ColumnDto[];
  readonly item: ItemDto;
  readonly emptyItem: ItemDto;
  readonly board: CellBoard;
  readonly density: CellDensity;
  readonly commit: Commit;
}) {
  const ordered = COLUMN_TYPES.map((type) => columns.find((column) => column.type === type)).filter((column): column is ColumnDto => Boolean(column));
  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-panel shadow-xs">
      <div role="grid" aria-label="Cell states" className="min-w-[1080px]" data-testid="state-matrix">
        <div role="row" className="grid grid-cols-[180px_repeat(5,minmax(160px,1fr))] border-b border-border-subtle bg-muted text-xs font-semibold tracking-wide text-fg-muted uppercase">
          <div role="columnheader" className="px-4 py-2.5">
            Type
          </div>
          {STATES.map((state) => (
            <div role="columnheader" key={state} className="border-l border-border-subtle px-3 py-2.5">
              {state}
            </div>
          ))}
        </div>
        {ordered.map((column) => {
          const sized = { ...column, width: 180 };
          const cell = (target: ItemDto, extra: { forceHover?: boolean; readOnly?: boolean }) => (
            <div className="flex border-l border-border-subtle">
              <Cell column={sized} item={target} board={board} users={USERS} density={density} tabIndex={-1} onCommit={(value) => commit(target, column, value)} {...extra} />
            </div>
          );
          return (
            <div role="row" key={column.id} data-type={column.type} className="grid grid-cols-[180px_repeat(5,minmax(160px,1fr))] border-b border-border-subtle last:border-b-0">
              <div role="rowheader" className="flex items-center gap-2.5 px-4">
                <ColumnTypeIcon type={column.type} variant="tile" size="md" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-fg">{columnTypeLabel(column.type)}</span>
                  <span className="truncate font-mono text-2xs text-fg-muted">{column.type}</span>
                </span>
              </div>
              {cell(item, {})}
              {cell(item, { forceHover: true })}
              {cell(emptyItem, {})}
              {cell(emptyItem, { forceHover: true })}
              {cell(item, { readOnly: true })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Every editor rendered open on its popover surface. */
export function EditorGrid({ columns, item, board, commit }: { readonly columns: readonly ColumnDto[]; readonly item: ItemDto; readonly board: CellBoard; readonly commit: Commit }) {
  const editable = columns.filter((column) => !['progress', 'mirror', 'formula', 'last_updated', 'creation_log', 'item_id', 'button', 'checkbox', 'rating'].includes(column.type));
  return (
    <div className="columns-1 gap-4 md:columns-2 xl:columns-3" data-cell-scope="">
      {editable.map((column) => (
        <figure key={column.id} className="mb-4 break-inside-avoid rounded-xl border border-border-subtle bg-sunken p-4">
          <figcaption className="mb-3 flex items-center gap-2 text-sm font-medium text-fg">
            <ColumnTypeIcon type={column.type} variant="tile" size="sm" />
            {columnTypeLabel(column.type)} <span className="text-fg-muted">· {column.title}</span>
          </figcaption>
          <CellEditorPreview column={column} item={item} board={board} users={USERS} onCommit={(value) => commit(item, column, value)} />
        </figure>
      ))}
    </div>
  );
}

export function LabelsSection({ columns, items, services }: { readonly columns: readonly ColumnDto[]; readonly items: readonly ItemDto[]; readonly services: CellServices }) {
  const status = columns.find((column) => column.type === 'status') as ColumnDto;
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  const usage = countLabelUsage(items, status.key);
  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      <div className="ks-popover-surface p-3" data-testid="label-editor-inline">
        <LabelEditor
          key={key}
          kind="status"
          labels={labelsFromSettings(status.settings)}
          usage={usage}
          itemNoun="Deal"
          onApply={async (change) => {
            await services.saveLabels?.(status, change);
            setKey((value) => value + 1);
          }}
          onCancel={() => setKey((value) => value + 1)}
        />
      </div>
      <div className="flex flex-col items-start gap-3 rounded-xl border border-border-subtle bg-panel p-5 text-sm text-fg-secondary">
        <p>
          Rename inline, pick a color from the token palette, drag the grip (or focus it and use Space + arrows) to reorder, mark the Done label, and delete. Deleting a label that
          deals use asks where they should move first.
        </p>
        <Button variant="secondary" onClick={() => setOpen(true)} data-testid="open-edit-labels-dialog">
          Open “Edit labels” dialog
        </Button>
        <EditLabelsDialog
          open={open}
          onOpenChange={setOpen}
          columnTitle={status.title}
          kind="status"
          labels={labelsFromSettings(status.settings)}
          usage={usage}
          itemNoun="Deal"
          onApply={async (change) => {
            await services.saveLabels?.(status, change);
            setOpen(false);
          }}
        />
      </div>
    </div>
  );
}

export function IconsSection() {
  return (
    <div className="grid grid-cols-2 gap-2 rounded-xl border border-border-subtle bg-panel p-4 sm:grid-cols-3 lg:grid-cols-5">
      {COLUMN_TYPES.map((type) => (
        <div key={type} className={cn('flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-hover')}>
          <ColumnTypeIcon type={type} variant="tile" />
          <ColumnTypeIcon type={type} />
          <span className="truncate text-sm text-fg">{columnTypeLabel(type)}</span>
        </div>
      ))}
    </div>
  );
}
