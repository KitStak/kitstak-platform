'use client';

/**
 * Activity log: who changed what, grouped by day, with value changes rendered before → after
 * using the real cell displays (a status pill becomes a status pill). Filter by column or person.
 */
import { useMemo, useState } from 'react';
import { ArrowRight, Bot, ChevronDown, Columns3, RotateCw, UserRound, X } from 'lucide-react';
import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Skeleton,
  cn,
} from '@/components/ui';
import { Cell, ColumnTypeIcon, type CellBoard } from '@/features/cells';
import { errorMessage, useItemActivity } from '@/lib/hooks';
import type { ActivityDto, ColumnDto, ItemDto, UserSummaryDto } from '@/server/services/contracts/dto';
import {
  NO_FILTER,
  activityPreview,
  describeActivity,
  distinctActors,
  groupByDay,
  isValueChange,
  matchesFilter,
  type ActivityFilter,
} from '../lib/activity';
import { dayLabel, formatClock, formatExact } from '../lib/format';
import { ActivityArt } from '../parts/illustrations';
import { useNow } from '../parts/common';

export interface ActivityTabProps {
  readonly item: ItemDto;
  readonly columns: readonly ColumnDto[];
  readonly board: CellBoard;
  readonly users: readonly UserSummaryDto[];
  readonly term: string;
}

const noop = () => undefined;

function ValueBox({
  column,
  item,
  value,
  board,
  users,
}: {
  readonly column: ColumnDto;
  readonly item: ItemDto;
  readonly value: unknown;
  readonly board: CellBoard;
  readonly users: readonly UserSummaryDto[];
}) {
  const empty = value === null || value === undefined || value === '';
  const ghost = useMemo<ItemDto>(
    () => ({
      ...item,
      name: column.type === 'name' && typeof value === 'string' ? value : item.name,
      values: empty || column.type === 'name' ? {} : ({ [column.key]: value } as ItemDto['values']),
      computed: {},
    }),
    [column.key, column.type, empty, item, value],
  );
  if (empty) {
    return (
      <div role="gridcell" className="flex h-8 w-[136px] shrink-0 items-center justify-center rounded-sm border border-dashed border-border-default text-xs text-fg-muted">
        Empty
      </div>
    );
  }
  return (
    <div className="h-8 w-[136px] shrink-0 overflow-hidden rounded-sm border border-border-subtle bg-panel">
      <Cell column={column} item={ghost} board={{ ...board, canEdit: false }} users={users} onCommit={noop} readOnly density="compact" tabIndex={-1} />
    </div>
  );
}

function Entry({
  entry,
  item,
  columnsByKey,
  board,
  users,
  term,
}: {
  readonly entry: ActivityDto;
  readonly item: ItemDto;
  readonly columnsByKey: ReadonlyMap<string, ColumnDto>;
  readonly board: CellBoard;
  readonly users: readonly UserSummaryDto[];
  readonly term: string;
}) {
  const column = entry.columnKey ? columnsByKey.get(entry.columnKey) : undefined;
  const automated = entry.automationId !== null;
  const actor = automated ? 'Automation' : (entry.actorName ?? 'Someone');
  const preview = activityPreview(entry);
  const renamed = entry.action === 'item.renamed';
  return (
    <li data-testid="activity-entry" className="flex gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-hover">
      {automated ? (
        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary-text">
          <Bot className="size-4" />
        </span>
      ) : (
        <Avatar name={actor} src={entry.actorImage} colorKey={entry.actorId ?? actor} size="md" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-base text-fg">
          <span className="font-semibold">{actor}</span>{' '}
          <span className="text-fg-secondary">{describeActivity(entry, columnsByKey, term)}</span>
          <time dateTime={entry.createdAt} title={formatExact(entry.createdAt)} className="ml-2 text-xs text-fg-muted tabular-nums">
            {formatClock(entry.createdAt)}
          </time>
        </p>
        {preview ? <p className="mt-1 line-clamp-2 border-l-2 border-border-strong pl-2 text-sm text-fg-secondary">{preview}</p> : null}
        {renamed ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-fg-muted line-through">{String(entry.before ?? '')}</span>
            <ArrowRight aria-label="changed to" className="size-3.5 text-icon" />
            <span className="font-medium text-fg">{String(entry.after ?? '')}</span>
          </p>
        ) : null}
        {isValueChange(entry) && column ? (
          <div role="grid" aria-readonly="true" aria-label={`${column.title} change`} className="mt-1.5">
            <div role="row" className="flex flex-wrap items-center gap-2">
              <ValueBox column={column} item={item} value={entry.before} board={board} users={users} />
              <div role="gridcell" className="flex items-center">
                <ArrowRight aria-label="changed to" className="size-4 text-icon" />
              </div>
              <ValueBox column={column} item={item} value={entry.after} board={board} users={users} />
            </div>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function MenuSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading options" className="flex flex-col gap-1 px-2.5 py-1.5">
      {[72, 56, 64].map((width) => (
        <div key={width} className="flex h-7 items-center gap-2">
          <Skeleton width={16} height={16} rounded="sm" />
          <Skeleton width={`${width}%`} height={10} rounded="full" />
        </div>
      ))}
    </div>
  );
}

export function ActivityTab({ item, columns, board, users, term }: ActivityTabProps) {
  const query = useItemActivity(item.id);
  const now = useNow();
  const [filter, setFilter] = useState<ActivityFilter>(NO_FILTER);
  const columnsByKey = useMemo(() => new Map(columns.map((column) => [column.key, column])), [columns]);
  const entries = useMemo(() => (query.data?.pages ?? []).flatMap((page) => page.items), [query.data]);
  const actors = useMemo(() => distinctActors(entries), [entries]);
  const filtered = useMemo(() => entries.filter((entry) => matchesFilter(entry, filter)), [entries, filter]);
  const days = useMemo(() => groupByDay(filtered), [filtered]);
  const changedColumns = useMemo(() => {
    const keys = new Set(entries.map((entry) => entry.columnKey).filter((key): key is string => key !== null));
    return columns.filter((column) => keys.has(column.key));
  }, [columns, entries]);
  const hasAutomation = entries.some((entry) => entry.automationId !== null);
  const activeColumn = filter.columnKey ? columnsByKey.get(filter.columnKey) : undefined;
  const activeActor = filter.actorId === 'automation' ? 'Automations' : actors.find((actor) => actor.id === filter.actorId)?.name;
  const filtering = filter.columnKey !== null || filter.actorId !== null;

  const triggerClass = (active: boolean) =>
    cn(
      'inline-flex h-7 items-center gap-1.5 rounded-sm border px-2.5 text-sm transition-[background-color,border-color,color] duration-[var(--duration-instant)] ease-out',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [&_svg]:size-3.5',
      active
        ? 'border-primary bg-primary-subtle font-medium text-primary-text hover:bg-primary-selected'
        : 'border-border-input bg-panel text-fg-secondary hover:border-border-input-hover hover:bg-muted hover:text-fg data-[state=open]:bg-muted',
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger className={triggerClass(Boolean(activeColumn))} data-testid="activity-filter-column">
            <Columns3 aria-hidden />
            {activeColumn ? activeColumn.title : 'Column'}
            <ChevronDown aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            <DropdownMenuLabel>Filter by column</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={filter.columnKey ?? ''} onValueChange={(value) => setFilter((current) => ({ ...current, columnKey: value || null }))}>
              <DropdownMenuRadioItem value="">All columns</DropdownMenuRadioItem>
              <DropdownMenuSeparator />
              {query.isLoading ? (
                <MenuSkeleton />
              ) : changedColumns.length === 0 ? (
                <p className="px-2.5 py-2 text-sm text-fg-muted">No column changes yet</p>
              ) : (
                changedColumns.map((column) => (
                  <DropdownMenuRadioItem key={column.key} value={column.key} icon={<ColumnTypeIcon type={column.type} size="sm" />}>
                    {column.title}
                  </DropdownMenuRadioItem>
                ))
              )}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger className={triggerClass(Boolean(activeActor))} data-testid="activity-filter-person">
            <UserRound aria-hidden />
            {activeActor ?? 'Person'}
            <ChevronDown aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            <DropdownMenuLabel>Filter by person</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={filter.actorId ?? ''} onValueChange={(value) => setFilter((current) => ({ ...current, actorId: value || null }))}>
              <DropdownMenuRadioItem value="">Everyone</DropdownMenuRadioItem>
              <DropdownMenuSeparator />
              {query.isLoading ? <MenuSkeleton /> : null}
              {actors.map((actor) => (
                <DropdownMenuRadioItem key={actor.id} value={actor.id} icon={<Avatar name={actor.name} src={actor.image} colorKey={actor.id} size="xs" />}>
                  {actor.name}
                </DropdownMenuRadioItem>
              ))}
              {hasAutomation ? (
                <DropdownMenuRadioItem value="automation" icon={<Bot aria-hidden />}>
                  Automations
                </DropdownMenuRadioItem>
              ) : null}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {filtering ? (
          <Button variant="ghost" size="sm" leadingIcon={<X aria-hidden />} onClick={() => setFilter(NO_FILTER)}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {query.isLoading ? (
        <div role="status" aria-busy="true" aria-label="Loading activity" data-skeleton className="flex flex-col gap-1">
          <Skeleton width={90} height={10} rounded="full" className="mb-2" />
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="flex gap-3 px-2 py-2.5">
              <Skeleton width={32} height={32} rounded="full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton width="55%" height={10} rounded="full" />
                <div className="flex gap-2">
                  <Skeleton width={136} height={32} />
                  <Skeleton width={136} height={32} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : query.isError ? (
        <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-border-subtle bg-panel px-6 py-8 text-center">
          <p className="font-medium">Couldn’t load the activity log</p>
          <p className="text-sm text-fg-secondary">{errorMessage(query.error)}</p>
          <Button variant="secondary" size="sm" leadingIcon={<RotateCw aria-hidden />} onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      ) : entries.length === 0 ? (
        <EmptyState visual={<ActivityArt />} size="sm" title="No activity yet" description={`Changes to this ${term.toLowerCase()} will be logged here.`} />
      ) : days.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="font-medium">No activity matches these filters</p>
          <Button variant="secondary" size="sm" onClick={() => setFilter(NO_FILTER)}>
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4" data-testid="activity-log">
          {days.map((day) => (
            <section key={day.key} aria-labelledby={`activity-day-${day.key}`}>
              <h3 id={`activity-day-${day.key}`} className="sticky top-0 z-[1] bg-raised/95 px-2 py-1.5 text-xs font-semibold text-fg-muted backdrop-blur-sm">
                {dayLabel(day.key, now)}
              </h3>
              <ol className="flex flex-col">
                {day.entries.map((entry) => (
                  <Entry key={entry.id} entry={entry} item={item} columnsByKey={columnsByKey} board={board} users={users} term={term} />
                ))}
              </ol>
            </section>
          ))}
          {query.hasNextPage ? (
            <Button variant="secondary" size="sm" className="self-center" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
              Load older activity
            </Button>
          ) : (
            <p className="text-center text-xs text-fg-muted">That’s everything since this {term.toLowerCase()} was created.</p>
          )}
        </div>
      )}
    </div>
  );
}
