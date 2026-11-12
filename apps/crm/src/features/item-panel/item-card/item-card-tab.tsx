'use client';

/**
 * Item card: every column value as an editable form using the same cell editors as the
 * table (edits are optimistic and shared with the board caches, so both stay in sync), plus
 * subitems with an add row and connected records.
 */
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUpRight, ChevronRight, EyeOff, Info, Link2, Plus } from 'lucide-react';
import { Button, Skeleton, Tooltip, cn } from '@/components/ui';
import { Cell, ColumnTypeIcon, type CellBoard, type CellCommitValue } from '@/features/cells';
import { useCreateItem, useSubitems, useUpdateCell } from '@/lib/hooks';
import type { ColumnDto, ItemDetailDto, ItemDto, UserSummaryDto } from '@/server/services/contracts/dto';

export interface ItemCardTabProps {
  readonly item: ItemDto;
  readonly detail: ItemDetailDto | undefined;
  readonly columns: readonly ColumnDto[];
  readonly board: CellBoard;
  readonly users: readonly UserSummaryDto[];
  readonly term: string;
  readonly canEdit: boolean;
  readonly onOpenItem: (itemId: string) => void;
}

function FieldRow({
  column,
  item,
  board,
  users,
  canEdit,
  onCommit,
}: {
  readonly column: ColumnDto;
  readonly item: ItemDto;
  readonly board: CellBoard;
  readonly users: readonly UserSummaryDto[];
  readonly canEdit: boolean;
  readonly onCommit: (value: CellCommitValue) => void;
}) {
  return (
    <div role="row" className="grid grid-cols-1 gap-1 py-1 @min-[480px]:grid-cols-[minmax(112px,34%)_1fr] @min-[480px]:items-center @min-[480px]:gap-3 @min-[640px]:grid-cols-[180px_1fr]" data-testid="item-card-field">
      <div role="rowheader" className="flex min-w-0 items-center gap-2 text-sm text-fg-secondary">
        <ColumnTypeIcon type={column.type} size="sm" />
        <span className="truncate">{column.title}</span>
        {column.description ? (
          <Tooltip content={column.description} side="top">
            <span tabIndex={0} className="inline-flex rounded-full text-icon outline-none focus-visible:outline-2 focus-visible:outline-focus">
              <Info aria-label="About this column" className="size-3.5" />
            </span>
          </Tooltip>
        ) : null}
        {column.hidden ? (
          <Tooltip content="Hidden in the table view" side="top">
            <span tabIndex={0} className="inline-flex rounded-full text-icon outline-none focus-visible:outline-2 focus-visible:outline-focus">
              <EyeOff aria-label="Hidden column" className="size-3.5" />
            </span>
          </Tooltip>
        ) : null}
      </div>
      <div className="min-w-0 overflow-hidden rounded-md border border-border-subtle bg-panel transition-[border-color] duration-[var(--duration-fast)] focus-within:border-primary hover:border-border-default">
        <Cell column={column} item={item} board={board} users={users} onCommit={onCommit} readOnly={!canEdit} />
      </div>
    </div>
  );
}

function Subitems({ item, term, canEdit, onOpenItem }: { readonly item: ItemDto; readonly term: string; readonly canEdit: boolean; readonly onOpenItem: (id: string) => void }) {
  const query = useSubitems(item.id);
  const create = useCreateItem(item.boardId);
  const [name, setName] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const add = () => {
    const value = name.trim();
    if (!value) return;
    setName('');
    create.mutate({ name: value, parentItemId: item.id, groupId: item.groupId });
  };
  const subitems = query.data ?? [];
  return (
    <section aria-labelledby="ip-subitems" className="flex flex-col gap-2">
      <h3 id="ip-subitems" className="flex items-center gap-2 text-sm font-semibold text-fg">
        Subitems
        {query.isLoading ? null : (
          <span className="rounded-full bg-muted px-1.5 text-xs font-semibold text-fg-secondary tabular-nums">{subitems.length}</span>
        )}
      </h3>
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-panel">
        {query.isLoading ? (
          <div role="status" aria-busy="true" aria-label="Loading subitems" className="flex flex-col gap-2 p-3">
            <Skeleton width="70%" height={10} rounded="full" />
            <Skeleton width="50%" height={10} rounded="full" />
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {subitems.map((subitem) => (
              <li key={subitem.id}>
                <button
                  type="button"
                  disabled={subitem.id.startsWith('temp-')}
                  onClick={() => onOpenItem(subitem.id)}
                  className="group flex h-9 w-full items-center gap-2 px-3 text-left text-base transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus disabled:opacity-60"
                >
                  <ChevronRight aria-hidden className="size-3.5 text-icon transition-transform group-hover:translate-x-0.5" />
                  <span className="truncate">{subitem.name}</span>
                  <ArrowUpRight aria-hidden className="ml-auto size-3.5 text-icon opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          <form
            className={cn('flex h-9 items-center gap-2 px-3', subitems.length > 0 && 'border-t border-border-subtle')}
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
          >
            <Plus aria-hidden className="size-3.5 shrink-0 text-icon" />
            <input
              ref={input}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Add subitem"
              aria-label={`Add a subitem to this ${term.toLowerCase()}`}
              maxLength={2000}
              className="h-full min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-placeholder"
            />
            {name.trim() ? (
              <Button type="submit" size="xs" loading={create.isPending}>
                Add
              </Button>
            ) : null}
          </form>
        ) : null}
      </div>
    </section>
  );
}

function Connected({ detail, onOpenItem, columns }: { readonly detail: ItemDetailDto; readonly onOpenItem: (id: string) => void; readonly columns: readonly ColumnDto[] }) {
  const linked = detail.linkedItems;
  const groups = useMemo(() => {
    const map = new Map<string, typeof linked>();
    for (const link of linked) map.set(link.boardName, [...(map.get(link.boardName) ?? []), link]);
    return [...map.entries()];
  }, [linked]);
  if (groups.length === 0) return null;
  const columnTitle = (key: string) => columns.find((column) => column.key === key)?.title;
  return (
    <section aria-labelledby="ip-connected" className="flex flex-col gap-2">
      <h3 id="ip-connected" className="flex items-center gap-2 text-sm font-semibold text-fg">
        <Link2 aria-hidden className="size-4 text-icon" />
        Connected records
      </h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {groups.map(([boardName, links]) => (
          <div key={boardName} className="rounded-lg border border-border-subtle bg-panel p-2">
            <p className="px-1.5 pb-1 text-xs font-semibold text-fg-muted">
              {boardName} · {links.length}
            </p>
            <ul>
              {links.map((link) => (
                <li key={`${link.id}-${link.columnKey}-${link.direction}`}>
                  <button
                    type="button"
                    onClick={() => onOpenItem(link.id)}
                    className="group flex w-full items-center gap-2 rounded-sm px-1.5 py-1.5 text-left text-sm transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium text-fg">{link.name}</span>
                    <span className="shrink-0 truncate text-xs text-fg-muted">{columnTitle(link.columnKey) ?? (link.direction === 'incoming' ? 'Linked here' : '')}</span>
                    <ArrowUpRight aria-hidden className="size-3.5 shrink-0 text-icon opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ItemCardTab({ item, detail, columns, board, users, term, canEdit, onOpenItem }: ItemCardTabProps) {
  const updateCell = useUpdateCell();
  const fields = useMemo(() => columns.filter((column) => column.type !== 'name'), [columns]);
  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.hasAttribute('data-ks-cell')) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const cells = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-ks-cell]')];
      const index = cells.indexOf(target);
      cells[index + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
    }
  };
  return (
    <div className="flex flex-col gap-6">
      {fields.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-default bg-sunken px-4 py-6 text-center text-sm text-fg-secondary">
          This board has no columns yet. Add columns on the board to capture {term.toLowerCase()} details.
        </p>
      ) : (
        <div role="grid" aria-label={`${term} fields`} className="flex flex-col" onKeyDown={onGridKey} data-testid="item-card-fields">
          {fields.map((column) => (
            <FieldRow
              key={column.id}
              column={column}
              item={item}
              board={board}
              users={users}
              canEdit={canEdit}
              onCommit={(value) => {
                updateCell.mutate({ itemId: item.id, boardId: item.boardId, columnKey: column.key, value });
              }}
            />
          ))}
        </div>
      )}
      {!item.parentItemId ? <Subitems item={item} term={term} canEdit={canEdit} onOpenItem={onOpenItem} /> : null}
      {detail ? <Connected detail={detail} onOpenItem={onOpenItem} columns={columns} /> : null}
    </div>
  );
}

