'use client';
import { forwardRef, useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Archive, CopyPlus, Download, FolderInput, MoreHorizontal, PenLine, Trash2, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Kbd,
  Popover,
  PopoverContent,
  PopoverAnchor,
  cn,
} from '@/components/ui';
import { Cell, ColumnTypeIcon } from '@/features/cells';
import { COLUMN_TYPE_REGISTRY } from '@/server/db/schema/column-types';
import type { ColumnDto, ItemDto } from '@/server/services/contracts/dto';
import { plural } from '../lib/terminology';
import { useTableStore } from '../state/table-store';
import { groupColorVar, useTable } from '../table-context';

const MAX_DOTS = 12;

interface BarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly icon: ReactNode;
  readonly label: string;
  readonly danger?: boolean;
  readonly testId?: string;
}

const BarButton = forwardRef<HTMLButtonElement, BarButtonProps>(function BarButton(
  { icon, label, danger, testId, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      data-testid={testId}
      className={cn(
        'flex h-14 w-[68px] shrink-0 flex-col max-sm:h-11 max-sm:w-11 items-center justify-center gap-1 rounded-md text-xs font-medium text-fg-secondary',
        'transition-colors duration-[var(--duration-instant)] hover:bg-hover hover:text-fg active:bg-pressed focus-visible:outline-2 focus-visible:outline-focus',
        'data-[state=open]:bg-hover data-[state=open]:text-fg [&_svg]:size-[18px]',
        danger && 'hover:bg-danger-subtle hover:text-danger-text',
        className,
      )}
      {...rest}
    >
      {icon}
      {/* Phones show icon-only actions; the label stays as the accessible name. */}
      <span className="max-sm:sr-only">{label}</span>
    </button>
  );
});

/** Floating multi-select action bar (bottom center), with bulk "Set value". */
export function BulkBar({ items }: { readonly items: readonly ItemDto[] }) {
  const {
    actions,
    terminology,
    groups,
    groupsById,
    layout,
    cellBoard,
    users,
    canEdit,
    exportItems,
    openMoveToBoard,
  } = useTable();
  const selected = useTableStore((state) => state.selected);
  const clearSelection = useTableStore((state) => state.clearSelection);
  const chosen = useMemo(() => items.filter((item) => selected.has(item.id)), [items, selected]);
  if (selected.size === 0) return null;
  const ids = [...selected];
  const noun = plural(terminology.toLowerCase(), ids.length);

  return (
    <div
      role="toolbar"
      aria-label={`${ids.length} ${noun} selected`}
      data-testid="bulk-bar"
      className="bt-bulkbar fixed bottom-6 left-1/2 z-[var(--z-dropdown)] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-lg border border-border-subtle bg-raised py-1 pr-2 pl-0 shadow-popover max-sm:bottom-4 max-sm:w-[calc(100vw-24px)] max-sm:overflow-visible max-sm:pr-1"
      onKeyDown={(event) => {
        if (event.key === 'Escape') clearSelection();
      }}
    >
      <div className="flex h-16 shrink-0 items-center gap-3 border-r border-border-subtle pr-4 max-sm:h-12 max-sm:gap-2 max-sm:pr-2">
        <span
          className="flex h-16 w-14 max-sm:h-12 max-sm:w-11 items-center justify-center rounded-l-lg bg-primary text-xl font-medium text-primary-fg tabular-nums"
          data-testid="bulk-count"
        >
          {ids.length}
        </span>
        <span className="text-sm font-medium text-fg sm:hidden">selected</span>
        <span className="flex flex-col gap-1 max-sm:hidden">
          <span className="text-md font-medium whitespace-nowrap text-fg">
            {ids.length === 1 ? terminology : `${terminology}s`} selected
          </span>
          <span className="flex gap-1" aria-hidden>
            {chosen.slice(0, MAX_DOTS).map((item) => (
              <span
                key={item.id}
                className="size-2 rounded-full"
                style={{ background: groupColorVar(groupsById.get(item.groupId)?.color) }}
              />
            ))}
            {chosen.length > MAX_DOTS ? (
              <span className="text-2xs leading-2 text-fg-muted">+{chosen.length - MAX_DOTS}</span>
            ) : null}
          </span>
        </span>
      </div>
      {canEdit ? (
        <>
          <BarButton
            icon={<CopyPlus aria-hidden />}
            label="Duplicate"
            onClick={() => actions.duplicateItems(ids)}
            testId="bulk-duplicate"
            className="max-sm:hidden"
          />
          <BarButton
            icon={<Download aria-hidden />}
            label="Export"
            onClick={() => exportItems(ids, 'selection')}
            testId="bulk-export"
          />
          <BarButton
            icon={<Archive aria-hidden />}
            label="Archive"
            testId="bulk-archive"
            className="max-sm:hidden"
            onClick={() => {
              actions.removeItems(ids, 'archive');
              clearSelection();
            }}
          />
          <BarButton
            icon={<Trash2 aria-hidden />}
            label="Delete"
            danger
            testId="bulk-delete"
            onClick={() => {
              actions.removeItems(ids, 'delete');
              clearSelection();
            }}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <BarButton
                icon={<FolderInput aria-hidden />}
                label="Move to"
                testId="bulk-move"
                className="max-sm:hidden"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="center" className="w-56">
              {groups.map((group) => (
                <DropdownMenuItem
                  key={group.id}
                  icon={
                    <span
                      aria-hidden
                      className="size-3 rounded-full"
                      style={{ background: groupColorVar(group.color) }}
                    />
                  }
                  onSelect={() => {
                    actions.moveToGroup(ids, group);
                    clearSelection();
                  }}
                >
                  {group.title}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                icon={<FolderInput aria-hidden />}
                onSelect={() => openMoveToBoard({ kind: 'items', itemIds: ids })}
              >
                Another board…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <SetValueButton
            columns={layout.columns.map((entry) => entry.column)}
            sample={chosen[0]}
            ids={ids}
            cellBoard={cellBoard}
            users={users}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <BarButton
                icon={<MoreHorizontal aria-hidden />}
                label="More"
                testId="bulk-more"
                className="sm:hidden"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="max-h-80 w-56">
              <DropdownMenuItem icon={<CopyPlus aria-hidden />} onSelect={() => actions.duplicateItems(ids)}>
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={<Archive aria-hidden />}
                onSelect={() => {
                  actions.removeItems(ids, 'archive');
                  clearSelection();
                }}
              >
                Archive
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Move to group</DropdownMenuLabel>
              {groups.map((group) => (
                <DropdownMenuItem
                  key={group.id}
                  icon={
                    <span
                      aria-hidden
                      className="size-3 rounded-full"
                      style={{ background: groupColorVar(group.color) }}
                    />
                  }
                  onSelect={() => {
                    actions.moveToGroup(ids, group);
                    clearSelection();
                  }}
                >
                  {group.title}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                icon={<FolderInput aria-hidden />}
                onSelect={() => openMoveToBoard({ kind: 'items', itemIds: ids })}
              >
                Another board…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : (
        <BarButton
          icon={<Download aria-hidden />}
          label="Export"
          onClick={() => exportItems(ids, 'selection')}
        />
      )}
      <span className="ml-1 hidden items-center gap-1 text-xs whitespace-nowrap text-fg-muted lg:flex">
        <Kbd>Esc</Kbd> to clear
      </span>
      <IconButton
        label="Clear selection"
        icon={<X aria-hidden />}
        onClick={clearSelection}
        className="ml-1 max-sm:ml-auto"
        data-testid="bulk-clear"
      />
    </div>
  );
}

function SetValueButton({
  columns,
  sample,
  ids,
  cellBoard,
  users,
}: {
  readonly columns: readonly ColumnDto[];
  readonly sample: ItemDto | undefined;
  readonly ids: readonly string[];
  readonly cellBoard: ReturnType<typeof useTable>['cellBoard'];
  readonly users: ReturnType<typeof useTable>['users'];
}) {
  const { actions } = useTable();
  const [column, setColumn] = useState<ColumnDto | null>(null);
  const editable = columns.filter(
    (entry) => !COLUMN_TYPE_REGISTRY[entry.type].computed && entry.type !== 'files',
  );
  const scratch: ItemDto | null =
    sample && column ? { ...sample, id: `bulk-${column.key}`, values: {} } : null;

  return (
    <Popover
      open={column !== null}
      onOpenChange={(open) => {
        if (!open) setColumn(null);
      }}
    >
      <DropdownMenu>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <BarButton icon={<PenLine aria-hidden />} label="Set value" testId="bulk-set-value" />
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent side="top" align="center" className="max-h-80 w-60">
          {editable.map((entry) => (
            <DropdownMenuItem
              key={entry.id}
              icon={<ColumnTypeIcon type={entry.type} size="sm" />}
              onSelect={() => setColumn(entry)}
            >
              {entry.title}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <PopoverContent side="top" align="center" className="w-72" data-testid="bulk-set-value-popover">
        {column && scratch ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-fg-secondary">
              Set <span className="font-semibold text-fg">{column.title}</span> on {ids.length} selected
            </p>
            <div className="h-9 overflow-hidden rounded-sm border border-border-input">
              <Cell
                column={column}
                item={scratch}
                board={cellBoard}
                users={users}
                onCommit={(value) => {
                  actions.applyValue(ids, column, value);
                  setColumn(null);
                }}
              />
            </div>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
