'use client';
/**
 * Read-only board surface: header + grouped grid of items rendered from the board payload.
 * This is the integration baseline for `/boards/:id`; the editable board table
 * (src/features/board-table) replaces the grid when it lands.
 */
import { useEffect, useMemo } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Avatar, Button, EmptyState, SkeletonRows, StatusPill, cn, toLabelColor } from '@/components/ui';
import { ApiClientError } from '@/lib/api';
import { useBoard, useRecordVisit } from '@/lib/hooks';
import type {
  BoardPayloadDto,
  ColumnDto,
  GroupDto,
  ItemDto,
  UserSummaryDto,
} from '@/server/services/contracts/dto';
import { cellDisplay, type CellDisplay } from './cell-display';

const MAX_VISIBLE_COLUMNS = 10;
const NAME_COLUMN_WIDTH = 320;

function Cell({ display }: { readonly display: CellDisplay }) {
  switch (display.kind) {
    case 'label':
      return (
        <StatusPill
          label={display.label}
          color={toLabelColor(display.color)}
          className="h-full w-full rounded-none"
        />
      );
    case 'labels':
      return (
        <span className="flex gap-1 overflow-hidden px-2">
          {display.labels.map((label) => (
            <StatusPill
              key={label.label}
              label={label.label}
              color={toLabelColor(label.color)}
              className="h-5 min-w-0 text-xs"
            />
          ))}
        </span>
      );
    case 'people':
      return (
        <span className="flex -space-x-1.5 px-2">
          {display.people.slice(0, 3).map((person) => (
            <Avatar key={person.id} name={person.name} src={person.image ?? undefined} size="xs" />
          ))}
        </span>
      );
    case 'check':
      return display.checked ? <Check aria-label="Checked" className="mx-auto size-4 text-success" /> : null;
    case 'text':
      return (
        <span
          className={cn(
            'block w-full truncate px-2 text-sm text-fg',
            display.align === 'end' && 'text-right',
          )}
          title={display.text}
        >
          {display.text}
        </span>
      );
    default:
      return null;
  }
}

interface GroupSectionProps {
  readonly group: GroupDto;
  readonly items: readonly ItemDto[];
  readonly columns: readonly ColumnDto[];
  readonly users: ReadonlyMap<string, UserSummaryDto>;
  readonly terminology: string;
}

function GroupSection({ group, items, columns, users, terminology }: GroupSectionProps) {
  const color = `var(--label-${toLabelColor(group.color, 'blue')})`;
  return (
    <div role="rowgroup" className="mb-8" aria-label={group.title}>
      <div role="row" className="sticky left-0 flex items-center gap-2 py-2">
        <span
          role="rowheader"
          className="flex items-center gap-1.5 font-heading text-base font-semibold"
          style={{ color }}
        >
          <ChevronDown aria-hidden className="size-4" />
          {group.title}
        </span>
        <span className="text-sm text-fg-muted">
          {items.length} {items.length === 1 ? terminology.toLowerCase() : `${terminology.toLowerCase()}s`}
        </span>
      </div>
      <div
        role="row"
        className="flex h-9 border-y border-border-subtle text-xs font-semibold text-fg-secondary"
      >
        <span
          role="columnheader"
          className="flex shrink-0 items-center border-l-[6px] px-3"
          style={{ width: NAME_COLUMN_WIDTH, borderLeftColor: color }}
        >
          {terminology}
        </span>
        {columns.map((column) => (
          <span
            role="columnheader"
            key={column.id}
            className="flex shrink-0 items-center justify-center truncate border-l border-border-subtle px-2"
            style={{ width: column.width }}
          >
            {column.title}
          </span>
        ))}
      </div>
      {items.map((item) => (
        <div role="row" key={item.id} className="flex h-9 border-b border-border-subtle hover:bg-hover">
          <span
            role="gridcell"
            className="flex shrink-0 items-center truncate border-l-[6px] px-3 text-sm text-fg"
            style={{ width: NAME_COLUMN_WIDTH, borderLeftColor: color }}
            title={item.name}
          >
            <span className="truncate">{item.name}</span>
          </span>
          {columns.map((column) => (
            <span
              role="gridcell"
              key={column.id}
              className="flex shrink-0 items-center overflow-hidden border-l border-border-subtle"
              style={{ width: column.width }}
            >
              <Cell display={cellDisplay(column, item, users)} />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function BoardGrid({ payload }: { readonly payload: BoardPayloadDto }) {
  const { board, groups, items } = payload;
  const columns = useMemo(
    () =>
      payload.columns
        .filter((column) => !column.hidden && column.scope === 'item' && column.type !== 'name')
        .slice(0, MAX_VISIBLE_COLUMNS),
    [payload.columns],
  );
  const users = useMemo(() => new Map(payload.users.map((user) => [user.id, user])), [payload.users]);
  const itemsByGroup = useMemo(() => {
    const map = new Map<string, ItemDto[]>();
    for (const item of items) {
      if (item.parentItemId) continue;
      map.set(item.groupId, [...(map.get(item.groupId) ?? []), item]);
    }
    return map;
  }, [items]);
  const visibleGroups = groups.filter((group) => !group.archivedAt);

  if (visibleGroups.length === 0) {
    return (
      <EmptyState title="This board has no groups yet" description="Groups organize items into sections." />
    );
  }
  return (
    <div
      role="grid"
      data-testid="board-table"
      aria-label={`${board.name} table`}
      aria-rowcount={payload.totalItems}
      className="min-w-max px-8 pb-8"
    >
      {visibleGroups.map((group) => (
        <GroupSection
          key={group.id}
          group={group}
          items={itemsByGroup.get(group.id) ?? []}
          columns={columns}
          users={users}
          terminology={board.itemTerminology || 'Item'}
        />
      ))}
    </div>
  );
}

export function BoardOverview({ boardId }: { readonly boardId: string }) {
  const board = useBoard(boardId);
  const { mutate: recordVisit } = useRecordVisit();

  useEffect(() => {
    recordVisit({ entityType: 'board', entityId: boardId });
  }, [boardId, recordVisit]);

  useEffect(() => {
    if (board.data) document.title = `${board.data.board.name} · KitStak`;
  }, [board.data]);

  if (board.isPending) {
    return (
      <div className="flex flex-col gap-4 px-8 py-6" aria-busy="true" data-skeleton>
        <div className="h-8 w-64 rounded-sm bg-skeleton" />
        <SkeletonRows rows={10} />
      </div>
    );
  }
  if (board.isError) {
    const notFound =
      board.error instanceof ApiClientError && (board.error.status === 404 || board.error.status === 403);
    return (
      <EmptyState
        illustration={notFound ? 'search' : 'error'}
        title={notFound ? "This board doesn't exist or you don't have access" : "We couldn't load this board"}
        description={
          notFound ? 'Ask a board owner to share it with you.' : 'Check your connection and try again.'
        }
        actions={
          notFound ? undefined : (
            <Button variant="secondary" onClick={() => void board.refetch()}>
              Try again
            </Button>
          )
        }
      />
    );
  }

  const { board: info } = board.data;
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-col gap-1 px-8 pt-6 pb-4">
        <h1 className="font-heading text-2xl font-semibold text-fg">{info.name}</h1>
        {info.description ? <p className="max-w-3xl text-sm text-fg-secondary">{info.description}</p> : null}
        <p className="text-xs text-fg-muted">
          {board.data.totalItems.toLocaleString('en-US')} {info.itemTerminology.toLowerCase()}s
          {board.data.nextCursor ? ` · showing first ${board.data.items.length}` : ''}
        </p>
      </header>
      <BoardGrid payload={board.data} />
    </div>
  );
}
