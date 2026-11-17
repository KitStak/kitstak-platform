'use client';
/** /trash: deleted boards, groups and items with restore, permanent delete and 30-day retention. */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Clock3, Layers, LayoutGrid, Rows3, RotateCcw, Trash2, X } from 'lucide-react';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  IconButton,
  SearchInput,
  Select,
  ToggleGroup,
  Tooltip,
  cn,
  toast,
} from '@/components/ui';
import { useOrg } from '@/features/shell/org-context';
import { TRASH_RETENTION_DAYS, type TrashEntryDto, type TrashType } from '@/server/services/admin-contracts';
import { daysUntil } from '@/server/services/admin-policy';
import { useTrash, useTrashAction } from '../api';
import { filterTrash, formatDateTime, pluralize, relativeTime, retentionLabel, trashBoards, trashKey } from '../format';
import { ErrorPanel, PageTitle, SettingsCard, SortableHeader, TABLE_CELL, TABLE_HEAD, TABLE_ROW, TableSkeleton, useTableSort } from '../ui';

const TYPE_ICON = { board: LayoutGrid, group: Layers, item: Rows3 } as const;
const TYPE_LABEL = { board: 'Board', group: 'Group', item: 'Item' } as const;

type Entry = { readonly type: TrashType; readonly id: string };
type TrashSortKey = 'name' | 'deleted' | 'purge';

const TRASH_SORT: Readonly<Record<TrashSortKey, (entry: TrashEntryDto) => string | number | null>> = {
  name: (entry) => entry.name,
  deleted: (entry) => Date.parse(entry.deletedAt),
  purge: (entry) => Date.parse(entry.purgeAt),
};

/** Row actions appear on hover / keyboard focus, and always on touch screens or when selected. */
const ROW_ACTIONS =
  'inline-flex gap-1 opacity-0 transition-opacity duration-[var(--duration-fast)] ease-out group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:none)]:opacity-100';

export function TrashPage() {
  const { org } = useOrg();
  const trash = useTrash();
  const restore = useTrashAction('restore');
  const purge = useTrashAction('purge');
  const [q, setQ] = useState('');
  const [type, setType] = useState<'all' | TrashType>('all');
  const [boardId, setBoardId] = useState<string>('all');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirm, setConfirm] = useState<TrashEntryDto[] | null>(null);

  // Entries past the retention window are purged server-side on the next sweep; never show them.
  const fetchedAt = trash.dataUpdatedAt;
  const all = useMemo(
    () => (trash.data ?? []).filter((entry) => Date.parse(entry.purgeAt) > fetchedAt),
    [trash.data, fetchedAt],
  );
  const filteredList = useMemo(() => filterTrash(all, { q, type, boardId }), [all, q, type, boardId]);
  const { sorted: list, sort, toggle: toggleSort } = useTableSort(filteredList, TRASH_SORT, { key: 'deleted', direction: 'desc' });
  const boards = useMemo(() => trashBoards(all), [all]);
  const counts = useMemo(
    () => ({
      all: all.length,
      board: all.filter((entry) => entry.type === 'board').length,
      group: all.filter((entry) => entry.type === 'group').length,
      item: all.filter((entry) => entry.type === 'item').length,
    }),
    [all],
  );
  const chosen = list.filter((entry) => selected.has(trashKey(entry)));
  const restorable = chosen.filter((entry) => entry.canRestore);
  const allChosen = list.length > 0 && chosen.length === list.length;
  const filtered = q !== '' || type !== 'all' || boardId !== 'all';

  const doRestore = (entries: readonly TrashEntryDto[]) => {
    const payload: Entry[] = entries.map((entry) => ({ type: entry.type, id: entry.id }));
    restore.mutate(
      { entries: payload },
      {
        onSuccess: (result) => {
          setSelected(new Set());
          if (result.done.length > 0) {
            const first = entries.find((entry) => entry.id === result.done[0]?.id);
            toast.success(
              result.done.length === 1 && first ? `“${first.name}” restored` : `${pluralize(result.done.length, 'item')} restored`,
              first ? `Back on ${first.boardName}` : undefined,
            );
          }
          if (result.failed.length > 0) {
            toast.error(`${pluralize(result.failed.length, 'entry', 'entries')} not restored`, result.failed[0]?.reason);
          }
        },
      },
    );
  };

  const doPurge = (entries: readonly TrashEntryDto[]) => {
    purge.mutate(
      { entries: entries.map((entry) => ({ type: entry.type, id: entry.id })) },
      {
        onSuccess: (result) => {
          setSelected(new Set());
          setConfirm(null);
          if (result.done.length > 0) toast.success(`${pluralize(result.done.length, 'entry', 'entries')} permanently deleted`);
          if (result.failed.length > 0) toast.error(`${pluralize(result.failed.length, 'entry', 'entries')} not deleted`, result.failed[0]?.reason);
        },
        onError: () => setConfirm(null),
      },
    );
  };

  const reset = () => {
    setQ('');
    setType('all');
    setBoardId('all');
  };

  return (
    <div className="h-full overflow-y-auto bg-app" data-testid="trash-page">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8">
        <PageTitle
          title="Trash"
          icon={<RotateCcw />}
        />

        <p className="flex items-start gap-2 rounded-lg border border-info-subtle bg-info-subtle px-4 py-3 text-sm text-info-text" data-testid="trash-retention">
          <Clock3 aria-hidden className="mt-0.5 size-4 shrink-0" />
          Items stay in the trash for {TRASH_RETENTION_DAYS} days after they’re deleted, then they’re removed permanently and
          automatically. Only board owners and admins can delete permanently.
        </p>

        <SettingsCard padded={false} testId="trash-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-3 sm:px-5">
            <SearchInput value={q} onValueChange={setQ} placeholder="Search the trash" containerClassName="w-full sm:w-64" aria-label="Search the trash" data-testid="trash-search" />
            <ToggleGroup<'all' | TrashType>
              label="Filter by type"
              size="sm"
              value={type}
              onValueChange={setType}
              options={[
                { value: 'all', label: trash.data ? `All ${counts.all}` : 'All' },
                { value: 'board', label: trash.data ? `Boards ${counts.board}` : 'Boards' },
                { value: 'group', label: trash.data ? `Groups ${counts.group}` : 'Groups' },
                { value: 'item', label: trash.data ? `Items ${counts.item}` : 'Items' },
              ]}
            />
            <Select
              aria-label="Filter by board"
              className="w-full sm:ml-auto sm:w-56"
              value={boardId}
              onValueChange={setBoardId}
              options={[{ value: 'all', label: 'All boards' }, ...boards.map((board) => ({ value: board.id, label: board.name }))]}
            />
          </div>

          {chosen.length > 0 ? (
            <div role="toolbar" aria-label="Bulk actions" data-testid="trash-bulk-bar" className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-primary-subtle px-4 py-2 animate-fade-in sm:px-5">
              <span className="text-sm font-semibold text-primary-text">{chosen.length} selected</span>
              <Tooltip
                content={
                  restorable.length === chosen.length
                    ? `Restore ${chosen.length}`
                    : `${chosen.length - restorable.length} need edit access to their board and will be skipped`
                }
              >
                <span className="inline-flex">
                  <Button
                    size="sm"
                    variant="secondary"
                    leadingIcon={<RotateCcw aria-hidden />}
                    loading={restore.isPending}
                    disabled={restorable.length === 0}
                    onClick={() => doRestore(restorable)}
                    data-testid="trash-bulk-restore"
                  >
                    {restorable.length !== chosen.length ? `Restore ${restorable.length}` : 'Restore'}
                  </Button>
                </span>
              </Tooltip>
              <Button
                size="sm"
                variant="danger-ghost"
                leadingIcon={<Trash2 aria-hidden />}
                disabled={!chosen.some((entry) => entry.canPurge)}
                onClick={() => setConfirm(chosen.filter((entry) => entry.canPurge))}
              >
                Delete forever
              </Button>
              <IconButton label="Clear selection" icon={<X aria-hidden />} size="sm" className="ml-auto" onClick={() => setSelected(new Set())} />
            </div>
          ) : null}

          {trash.isPending ? (
            <TableSkeleton rows={6} columns={3} />
          ) : trash.isError ? (
            <ErrorPanel title="Couldn't load the trash" onRetry={() => void trash.refetch()} />
          ) : all.length === 0 ? (
            <EmptyState
              illustration="board"
              title="Trash is empty"
              description="Deleted boards, groups and items show up here."
              actions={
                <Link href={`/${org.slug}`} className="text-sm font-medium text-fg-link hover:underline focus-visible:outline-2 focus-visible:outline-focus">
                  Back to home
                </Link>
              }
            />
          ) : list.length === 0 ? (
            <EmptyState
              size="sm"
              illustration="search"
              title="Nothing matches"
              description="Try another search, type or board."
              actions={filtered ? <Button variant="secondary" size="sm" onClick={reset}>Clear filters</Button> : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] table-fixed text-base" data-testid="trash-table">
                <thead className="border-b border-border-subtle bg-sunken/60">
                  <tr>
                    <th className={cn(TABLE_HEAD, 'w-12 pr-0')}>
                      <Checkbox
                        aria-label="Select all"
                        checked={allChosen ? true : chosen.length > 0 ? 'indeterminate' : false}
                        onCheckedChange={(value) => setSelected(value === true ? new Set(list.map(trashKey)) : new Set())}
                      />
                    </th>
                    <SortableHeader label="Name" sortKey="name" sort={sort} onSort={toggleSort} />
                    <th className={cn(TABLE_HEAD, 'hidden w-[24%] md:table-cell')}>Location</th>
                    <SortableHeader label="Deleted" sortKey="deleted" sort={sort} onSort={toggleSort} className="w-40" />
                    <SortableHeader label="Removed in" sortKey="purge" sort={sort} onSort={toggleSort} className="hidden w-32 sm:table-cell" />
                    <th className={cn(TABLE_HEAD, 'w-[168px] text-right')}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((entry) => (
                    <TrashRow
                      key={trashKey(entry)}
                      entry={entry}
                      selected={selected.has(trashKey(entry))}
                      onSelect={(on) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (on) next.add(trashKey(entry));
                          else next.delete(trashKey(entry));
                          return next;
                        })
                      }
                      onRestore={() => doRestore([entry])}
                      onPurge={() => setConfirm([entry])}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SettingsCard>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => (open ? undefined : setConfirm(null))}
        destructive
        loading={purge.isPending}
        title={
          confirm && confirm.length === 1
            ? `Delete “${confirm[0]?.name ?? ''}” forever?`
            : `Delete ${pluralize(confirm?.length ?? 0, 'entry', 'entries')} forever?`
        }
        description={
          confirm?.some((entry) => entry.type !== 'item')
            ? 'Everything inside (groups, items, updates and files) is erased too. This can’t be undone.'
            : 'Its updates, files and history are erased too. This can’t be undone.'
        }
        confirmLabel="Delete forever"
        onConfirm={() => confirm && doPurge(confirm)}
      />
    </div>
  );
}

function TrashRow({
  entry,
  selected,
  onSelect,
  onRestore,
  onPurge,
}: {
  readonly entry: TrashEntryDto;
  readonly selected: boolean;
  readonly onSelect: (on: boolean) => void;
  readonly onRestore: () => void;
  readonly onPurge: () => void;
}) {
  const Icon = TYPE_ICON[entry.type];
  const left = daysUntil(entry.purgeAt);
  const location = [entry.workspaceName, entry.type !== 'board' ? entry.boardName : null, entry.type === 'item' ? entry.groupName : null]
    .filter(Boolean)
    .join(' › ');
  return (
    <tr className={cn(TABLE_ROW, 'group/row', selected && 'bg-selected hover:bg-selected-hover')} data-testid="trash-row" data-type={entry.type}>
      <td className={cn(TABLE_CELL, 'w-10 pr-0')}>
        <Checkbox aria-label={`Select ${entry.name}`} checked={selected} onCheckedChange={(value) => onSelect(value === true)} />
      </td>
      <td className={TABLE_CELL}>
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sunken text-icon">
            <Icon aria-hidden className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-fg" title={entry.name}>{entry.name}</span>
            <span className="block text-xs text-fg-muted">
              {TYPE_LABEL[entry.type]}
              {entry.itemCount !== null ? ` · ${pluralize(entry.itemCount, 'item')}` : ''}
            </span>
          </span>
        </span>
      </td>
      <td className={cn(TABLE_CELL, 'hidden max-w-[260px] text-sm text-fg-secondary md:table-cell')}>
        <span className="block truncate">{location || 'None'}</span>
      </td>
      <td className={cn(TABLE_CELL, 'text-sm whitespace-nowrap text-fg-secondary')} title={formatDateTime(entry.deletedAt)}>
        <span className="block text-fg">{relativeTime(entry.deletedAt)}</span>
        <span className="block text-xs text-fg-muted">{entry.deletedBy ? `by ${entry.deletedBy.name}` : 'Deleted'}</span>
      </td>
      <td className={cn(TABLE_CELL, 'hidden text-sm whitespace-nowrap sm:table-cell', left <= 3 ? 'font-medium text-danger-text' : 'text-fg-secondary')}>
        {retentionLabel(left)}
      </td>
      <td className={cn(TABLE_CELL, 'text-right whitespace-nowrap')}>
        <span className={cn(ROW_ACTIONS, selected && 'opacity-100')} data-testid="trash-row-actions">
          {entry.canRestore ? (
            <Button size="sm" variant="ghost" leadingIcon={<RotateCcw aria-hidden />} onClick={onRestore} data-testid="trash-restore">
              Restore
            </Button>
          ) : (
            <Tooltip content="You need edit access to this board to restore it">
              <span className="inline-flex rounded-sm focus-visible:outline-2 focus-visible:outline-focus" tabIndex={0}>
                <Button size="sm" variant="ghost" leadingIcon={<RotateCcw aria-hidden />} disabled data-testid="trash-restore">
                  Restore
                </Button>
              </span>
            </Tooltip>
          )}
          <Tooltip content={entry.canPurge ? 'Delete forever' : 'Only board owners and admins can delete permanently'}>
            <span className="inline-flex">
              <IconButton
                label={`Delete ${entry.name} forever`}
                icon={<Trash2 aria-hidden />}
                size="sm"
                hideTooltip
                disabled={!entry.canPurge}
                onClick={onPurge}
                className="text-icon hover:bg-danger-subtle hover:text-danger-text focus-visible:text-danger-text"
                data-testid="trash-purge"
              />
            </span>
          </Tooltip>
        </span>
      </td>
    </tr>
  );
}
