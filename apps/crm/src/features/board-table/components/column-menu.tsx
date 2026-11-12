'use client';
import { useState } from 'react';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Columns3,
  CopyPlus,
  EyeOff,
  Filter,
  Info,
  MoreHorizontal,
  MoveHorizontal,
  Pencil,
  Plus,
  Settings2,
  Shrink,
  Tags,
  Trash2,
  Shuffle,
} from 'lucide-react';
import {
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  cn,
} from '@/components/ui';
import { ColumnTypeIcon } from '@/features/cells';
import type { ColumnType } from '@/server/db/schema/cell-values';
import { COLUMN_TYPE_REGISTRY } from '@/server/db/schema/column-types';
import type { ColumnDto } from '@/server/services/contracts/dto';
import { useTableStore } from '../state/table-store';
import { useTable } from '../table-context';
import { QUICK_COLUMN_TYPES } from './column-center';

export type ColumnDialog = 'settings' | 'labels' | 'filter';

export interface ColumnMenuProps {
  readonly column: ColumnDto;
  readonly onOpenChange?: (open: boolean) => void;
  readonly onDialog: (dialog: ColumnDialog) => void;
}

/** Types a column can be converted to (excludes unique / computed-only types). */
function convertibleTypes(current: ColumnType): ColumnType[] {
  return (Object.keys(COLUMN_TYPE_REGISTRY) as ColumnType[]).filter((type) => {
    const definition = COLUMN_TYPE_REGISTRY[type];
    return type !== current && !definition.unique && type !== 'mirror' && type !== 'button';
  });
}

/** Column header "…" menu. The name column only offers what applies to it. */
export function ColumnMenu({ column, onOpenChange, onDialog }: ColumnMenuProps) {
  const { actions, canEdit, view, allItems, autoFit, autoFitAll, openColumnCenter, addColumn } = useTable();
  const setRenameColumn = useTableStore((state) => state.setRenameColumn);
  const [pendingType, setPendingType] = useState<ColumnType | null>(null);
  const isName = column.type === 'name';
  const definition = COLUMN_TYPE_REGISTRY[column.type];
  const hasLabels = column.type === 'status' || column.type === 'dropdown';
  const sorted = view.state.sort.find((rule) => rule.columnKey === column.key);

  return (
    <>
      <DropdownMenu onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${column.title} column actions`}
            data-testid="column-menu"
            className="bt-reveal inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-icon hover:bg-hover hover:text-icon-strong focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus active:bg-pressed data-[state=open]:bg-hover"
          >
            <MoreHorizontal aria-hidden className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="flex items-center gap-1.5">
            <ColumnTypeIcon type={column.type} size="sm" />
            {definition.label} column
          </DropdownMenuLabel>
          {canEdit && !isName ? (
            <DropdownMenuItem icon={<Settings2 aria-hidden />} onSelect={() => onDialog('settings')}>
              Column settings
            </DropdownMenuItem>
          ) : null}
          {canEdit && hasLabels ? (
            <DropdownMenuItem icon={<Tags aria-hidden />} onSelect={() => onDialog('labels')}>
              Edit labels
            </DropdownMenuItem>
          ) : null}
          {definition.filterable ? (
            <DropdownMenuItem icon={<Filter aria-hidden />} onSelect={() => onDialog('filter')}>
              Filter by this column
            </DropdownMenuItem>
          ) : null}
          {definition.sortable ? (
            <>
              <DropdownMenuItem
                icon={<ArrowUpNarrowWide aria-hidden />}
                onSelect={() => view.sortColumn(column.key, 'asc')}
                className={cn(sorted?.direction === 'asc' && 'text-primary-text')}
              >
                Sort ascending
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={<ArrowDownWideNarrow aria-hidden />}
                onSelect={() => view.sortColumn(column.key, 'desc')}
                className={cn(sorted?.direction === 'desc' && 'text-primary-text')}
              >
                Sort descending
              </DropdownMenuItem>
              {sorted ? (
                <DropdownMenuItem icon={<Shuffle aria-hidden />} onSelect={() => view.setSort([])}>
                  Clear sort
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem icon={<MoveHorizontal aria-hidden />} onSelect={() => autoFit(column)}>
            Autofit width
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Columns3 aria-hidden />} onSelect={autoFitAll}>
            Autofit all columns
          </DropdownMenuItem>
          {!isName ? (
            <DropdownMenuItem
              icon={<Shrink aria-hidden />}
              onSelect={() => view.toggleCollapsedColumn(column.key)}
            >
              Collapse column
            </DropdownMenuItem>
          ) : null}
          {canEdit ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem icon={<Pencil aria-hidden />} onSelect={() => setRenameColumn(column.id)}>
                Rename
              </DropdownMenuItem>
              {!isName ? (
                <DropdownMenuItem icon={<Info aria-hidden />} onSelect={() => onDialog('settings')}>
                  {column.description ? 'Edit description' : 'Add description'}
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
          {canEdit && !isName ? (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger icon={<CopyPlus aria-hidden />}>
                  Duplicate column
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-52">
                  <DropdownMenuItem onSelect={() => void actions.duplicateColumn(column, false, allItems)}>
                    Structure only
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={definition.computed}
                    onSelect={() => void actions.duplicateColumn(column, true, allItems)}
                  >
                    With values
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger icon={<Plus aria-hidden />}>
                  Add column to the right
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  {QUICK_COLUMN_TYPES.slice(0, 8).map((type) => (
                    <DropdownMenuItem
                      key={type}
                      icon={<ColumnTypeIcon type={type} variant="tile" size="sm" />}
                      onSelect={() => addColumn(type, { afterId: column.id, scope: column.scope })}
                    >
                      {COLUMN_TYPE_REGISTRY[type].label}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => openColumnCenter({ afterId: column.id, scope: column.scope })}
                  >
                    More columns…
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger icon={<Shuffle aria-hidden />}>
                  Change column type
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-80 w-56">
                  {convertibleTypes(column.type).map((type) => (
                    <DropdownMenuItem
                      key={type}
                      icon={<ColumnTypeIcon type={type} size="sm" />}
                      onSelect={() => setPendingType(type)}
                    >
                      {COLUMN_TYPE_REGISTRY[type].label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem
                icon={<EyeOff aria-hidden />}
                onSelect={() => view.toggleHiddenColumn(column.key)}
              >
                Hide column
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="danger"
                icon={<Trash2 aria-hidden />}
                onSelect={() => actions.deleteColumn(column)}
              >
                Delete column
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={pendingType !== null}
        onOpenChange={(open) => {
          if (!open) setPendingType(null);
        }}
        title={`Change “${column.title}” to ${pendingType ? COLUMN_TYPE_REGISTRY[pendingType].label : ''}?`}
        description="Values that can be converted are kept. Values that don't fit the new type are cleared, and this can't be undone."
        confirmLabel="Change type"
        destructive
        onConfirm={() => {
          if (pendingType) void actions.updateColumn(column, { type: pendingType });
          setPendingType(null);
        }}
      />
    </>
  );
}
