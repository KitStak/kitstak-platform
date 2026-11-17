'use client';

/** Board activity log: who changed what, with before → after, filterable by person/text. */
import { useMemo, useRef, useState } from 'react';
import { ArrowRight, Bot, History } from 'lucide-react';
import { Avatar, Button, Drawer, DrawerContent, EmptyState, SearchInput, Skeleton } from '@/components/ui';
import { useBoardActivity } from '@/lib/hooks';
import type { ActivityDto, ColumnDto, ItemDto, UserSummaryDto } from '@/server/services/contracts/dto';
import { describeActivity, formatWhen, shouldShowValues, valueText } from '../lib/activity-format';

export interface ActivityDrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly boardId: string;
  readonly columns: readonly ColumnDto[];
  readonly items: readonly ItemDto[];
  readonly users: readonly UserSummaryDto[];
  readonly onOpenItem: (itemId: string) => void;
}

export function ActivityDrawer({ open, onOpenChange, boardId, columns, items, users, onOpenItem }: ActivityDrawerProps) {
  const activity = useBoardActivity(open ? boardId : undefined);
  const [query, setQuery] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);
  const columnsByKey = useMemo(() => new Map(columns.map((column) => [column.key, column])), [columns]);
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const entries = useMemo(() => activity.data?.pages.flatMap((page) => page.items) ?? [], [activity.data]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => {
      const item = entry.itemId ? itemsById.get(entry.itemId)?.name : '';
      const text = `${entry.actorName ?? ''} ${item ?? ''} ${describeActivity(entry, columnsByKey)}`.toLowerCase();
      return text.includes(needle);
    });
  }, [columnsByKey, entries, itemsById, query]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title="Activity log"
        width={520}
        data-testid="board-activity"
        onOpenAutoFocus={(event) => {
          // Land in the filter field (not on Close, whose tooltip would swallow the first Esc).
          event.preventDefault();
          filterRef.current?.focus();
        }}
      >
        <div className="sticky top-0 z-10 border-b border-border-subtle bg-raised px-6 py-3">
          <SearchInput ref={filterRef} value={query} onValueChange={setQuery} placeholder="Filter by person, item or column" aria-label="Filter activity" />
        </div>
        {activity.isPending ? (
          <ul aria-busy="true" className="flex flex-col gap-4 px-6 py-4" data-skeleton>
            {Array.from({ length: 8 }, (_, index) => (
              <li key={index} className="flex gap-3">
                <Skeleton width={28} height={28} rounded="full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton width="60%" height={12} rounded="full" />
                  <Skeleton width="40%" height={10} rounded="full" />
                </div>
              </li>
            ))}
          </ul>
        ) : activity.isError ? (
          <EmptyState
            illustration="error"
            size="sm"
            title="Couldn't load the activity log"
            description="Check your connection and try again."
            actions={<Button variant="secondary" onClick={() => void activity.refetch()}>Try again</Button>}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            size="sm"
            visual={<History aria-hidden className="size-8 text-icon" />}
            title={query ? 'No activity matches your filter' : 'No activity yet'}
            description={query ? 'Try a different name or column.' : 'Changes to items, columns and groups show up here.'}
          />
        ) : (
          <ol className="flex flex-col px-3 py-2">
            {visible.map((entry) => (
              <ActivityRow
                key={entry.id}
                entry={entry}
                column={entry.columnKey ? columnsByKey.get(entry.columnKey) : undefined}
                columnsByKey={columnsByKey}
                item={entry.itemId ? itemsById.get(entry.itemId) : undefined}
                usersById={usersById}
                onOpenItem={onOpenItem}
              />
            ))}
            {activity.hasNextPage ? (
              <li className="flex justify-center py-3">
                <Button variant="secondary" size="sm" loading={activity.isFetchingNextPage} onClick={() => void activity.fetchNextPage()}>
                  Load older activity
                </Button>
              </li>
            ) : null}
          </ol>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function ActivityRow({
  entry,
  column,
  columnsByKey,
  item,
  usersById,
  onOpenItem,
}: {
  readonly entry: ActivityDto;
  readonly column: ColumnDto | undefined;
  readonly columnsByKey: ReadonlyMap<string, ColumnDto>;
  readonly item: ItemDto | undefined;
  readonly usersById: ReadonlyMap<string, UserSummaryDto>;
  readonly onOpenItem: (itemId: string) => void;
}) {
  const showValues = shouldShowValues(entry);
  const before = showValues ? valueText(entry.before, column, usersById) : '';
  const after = showValues ? valueText(entry.after, column, usersById) : '';
  const actor = entry.automationId ? 'Automation' : (entry.actorName ?? 'Someone');
  return (
    <li className="flex gap-3 rounded-md px-3 py-2.5 transition-colors duration-[var(--duration-instant)] hover:bg-hover" data-testid="activity-row">
      {entry.automationId ? (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary-text">
          <Bot aria-hidden className="size-4" />
        </span>
      ) : (
        <Avatar name={actor} src={entry.actorImage} colorKey={entry.actorId ?? actor} size="sm" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-base text-fg">
          <span className="font-medium">{actor}</span> <span className="text-fg-secondary">{describeActivity(entry, columnsByKey)}</span>
          {entry.itemId ? (
            <>
              {' '}
              <button
                type="button"
                className="max-w-full truncate rounded-xs align-bottom font-medium text-fg-link hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                onClick={() => onOpenItem(entry.itemId as string)}
              >
                {item?.name ?? 'an item'}
              </button>
            </>
          ) : null}
        </p>
        {showValues && (before || after) ? (
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
            <span className="max-w-[45%] truncate rounded-xs bg-muted px-1.5 py-0.5 text-fg-secondary line-through decoration-fg-muted/60">
              {before || 'empty'}
            </span>
            <ArrowRight aria-label="changed to" className="size-3.5 text-icon" />
            <span className="max-w-[45%] truncate rounded-xs bg-primary-subtle px-1.5 py-0.5 text-primary-text">{after || 'empty'}</span>
          </p>
        ) : null}
        <p className="mt-0.5 text-xs text-fg-muted">
          <time dateTime={entry.createdAt}>{formatWhen(entry.createdAt)}</time>
        </p>
      </div>
    </li>
  );
}
