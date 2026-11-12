'use client';
/**
 * Run history: filterable table (status / automation / time range). Each row shows the
 * automation name with its sentence underneath (so runs match list rows), the item as a link,
 * and opens the run drawer; focus returns to the row when the drawer closes.
 */
import Link from 'next/link';
import { useCallback, useMemo, useRef, useState } from 'react';
import { History, RefreshCw } from 'lucide-react';
import { Button, EmptyState, Select, Skeleton, StatusPill, Tooltip, cn } from '@/components/ui';
import { errorMessage } from '@/lib/hooks';
import { routes } from '@/features/shell/routes';
import type { BoardRunDto, RunStatusFilter } from '@/server/services/contracts/automations-center';
import type { AutomationDto } from '@/server/services/contracts/dto';
import { useBoardRuns, type RunFilters } from '../api';
import { draftFromAutomation, draftParts, partsToText } from '../model/draft';
import { createResolver, type BuilderContext } from '../model/resolver';
import { formatDateTime, formatDuration, relativeTime } from './format';
import { RunDrawer, STATUS_META } from './run-drawer';

const RANGES = [
  { value: 'all', label: 'Any time' },
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
] as const;

/** Time · Automation · Item (widest) · Status · Duration. */
const GRID = 'md:grid-cols-[128px_minmax(0,1fr)_minmax(0,1.35fr)_104px_72px]';

function sinceFor(range: string): string | undefined {
  if (range === 'all') return undefined;
  return new Date(Date.now() - Number(range) * 86_400_000).toISOString();
}

export interface RunHistoryProps {
  readonly orgSlug: string;
  readonly context: BuilderContext;
  readonly automations: readonly AutomationDto[];
  readonly automationId: string | null;
  readonly onAutomationChange: (id: string | null) => void;
  readonly canEdit: boolean;
  readonly onEditAutomation?: (automation: AutomationDto) => void;
}

export function RunHistory({
  orgSlug,
  context,
  automations,
  automationId,
  onAutomationChange,
  canEdit,
  onEditAutomation,
}: RunHistoryProps) {
  const [status, setStatus] = useState<RunStatusFilter | 'all'>('all');
  const [range, setRange] = useState<string>('all');
  const [selected, setSelected] = useState<BoardRunDto | null>(null);
  // `since` is derived once per range choice so the query key stays stable between renders.
  const since = useMemo(() => sinceFor(range), [range]);
  const filters: RunFilters = {
    ...(status !== 'all' && { status }),
    ...(automationId && { automationId }),
    ...(since && { since }),
  };
  const runs = useBoardRuns(context.boardId, filters);
  const rows = runs.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = status !== 'all' || automationId !== null || range !== 'all';
  const isTable = !runs.isPending && !runs.isError && rows.length > 0;
  const resolver = useMemo(() => createResolver(context), [context]);
  const sentences = useMemo(
    () =>
      new Map(
        automations.map((automation) => [
          automation.id,
          partsToText(draftParts(draftFromAutomation(automation), resolver), context.term),
        ]),
      ),
    [automations, resolver, context.term],
  );

  const listRef = useRef<HTMLDivElement>(null);
  const lastOpened = useRef<string | null>(null);
  const openRun = (run: BoardRunDto) => {
    lastOpened.current = run.id;
    setSelected(run);
  };
  const returnFocus = useCallback(() => {
    const id = lastOpened.current;
    // Rows are keyed by run id, so the row survives the 30 s background refetch.
    const row = id
      ? listRef.current?.querySelector<HTMLElement>(`[data-run-id="${CSS.escape(id)}"]`)
      : null;
    row?.focus();
  }, []);

  return (
    <div className="flex flex-col gap-4" data-testid="run-history">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Filter by status"
          size="md"
          value={status}
          onValueChange={(value) => setStatus(value as RunStatusFilter | 'all')}
          options={[
            { value: 'all', label: 'All statuses' },
            { value: 'succeeded', label: 'Success' },
            { value: 'failed', label: 'Failed' },
            { value: 'skipped', label: 'Skipped' },
            { value: 'pending', label: 'Pending' },
          ]}
          className="w-40"
        />
        <Select
          aria-label="Filter by automation"
          value={automationId ?? 'all'}
          onValueChange={(value) => onAutomationChange(value === 'all' ? null : value)}
          options={[
            { value: 'all', label: 'All automations' },
            ...automations.map((automation) => ({
              value: automation.id,
              label: automation.name,
              description: sentences.get(automation.id),
            })),
          ]}
          className="w-full max-w-72 sm:w-64"
        />
        <Select
          aria-label="Filter by time"
          value={range}
          onValueChange={setRange}
          options={RANGES.map((entry) => ({ value: entry.value, label: entry.label }))}
          className="w-40"
        />
        {filtered ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatus('all');
              setRange('all');
              onAutomationChange(null);
            }}
          >
            Clear filters
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          leadingIcon={<RefreshCw aria-hidden className={cn(runs.isFetching && 'animate-spin')} />}
          onClick={() => void runs.refetch()}
          disabled={runs.isFetching}
        >
          Refresh
        </Button>
      </div>

      <div
        role={isTable ? 'table' : undefined}
        aria-label={isTable ? 'Automation runs' : undefined}
        className="overflow-hidden rounded-lg border border-border-subtle bg-panel shadow-xs"
      >
        {/* Header row is visually hidden below md (rows stack), but always exposed to assistive tech. */}
        {/* Only a table when there are rows; skeleton / empty / error states hide the header. */}
        <div role={isTable ? 'rowgroup' : undefined} aria-hidden={isTable ? undefined : true}>
          <div
            role="row"
            className={cn(
              'sr-only items-center gap-3 border-b border-border-subtle bg-sunken px-4 py-2 text-xs font-semibold text-fg-secondary md:not-sr-only md:grid',
              GRID,
            )}
          >
            <span role="columnheader">Time</span>
            <span role="columnheader">Automation</span>
            <span role="columnheader">{context.term}</span>
            <span role="columnheader">Status</span>
            <span role="columnheader" className="text-right">
              Duration
            </span>
          </div>
        </div>
        {runs.isPending ? (
          <RunRowsSkeleton />
        ) : runs.isError ? (
          <EmptyState
            illustration="error"
            size="sm"
            title="Run history couldn’t load"
            description={errorMessage(runs.error)}
            actions={
              <Button variant="secondary" onClick={() => void runs.refetch()}>
                Try again
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            visual={
              <span className="flex size-12 items-center justify-center rounded-full bg-primary-subtle text-primary-text">
                <History aria-hidden className="size-6" />
              </span>
            }
            size="sm"
            title={filtered ? 'No runs match these filters' : 'No runs yet'}
            description={
              filtered
                ? 'Try a wider time range or another status.'
                : 'Each time an automation fires it appears here, with what it did.'
            }
          />
        ) : (
          <div role="rowgroup" ref={listRef}>
            {rows.map((run) => {
              const meta = STATUS_META[run.status];
              const sentence = sentences.get(run.automationId);
              return (
                <div
                  key={run.id}
                  role="row"
                  className={cn(
                    'relative flex flex-col gap-1 border-b border-border-subtle px-4 py-3 text-sm transition-colors duration-[var(--duration-instant)] last:border-0 hover:bg-hover md:grid md:items-center md:gap-3 md:py-2.5',
                    GRID,
                  )}
                >
                  <span
                    role="cell"
                    className="sr-only text-fg-secondary tabular-nums md:not-sr-only md:block"
                    title={formatDateTime(run.createdAt)}
                  >
                    {relativeTime(run.createdAt)}
                  </span>
                  <span role="cell" className="min-w-0">
                    {/* Stretched button: the whole row opens the drawer; the item link sits above it. */}
                    <button
                      type="button"
                      onClick={() => openRun(run)}
                      data-testid="run-row"
                      data-status={run.status}
                      data-run-id={run.id}
                      aria-label={`${run.automationName}, ${meta.label}, ${relativeTime(run.createdAt)}. Show details`}
                      className="block w-full min-w-0 truncate rounded-xs text-left font-medium text-fg outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus active:after:bg-pressed"
                    >
                      {run.automationName}
                    </button>
                    {sentence ? (
                      <Tooltip content={sentence} side="top">
                        <span className="relative z-[1] block truncate text-xs text-fg-muted">{sentence}</span>
                      </Tooltip>
                    ) : null}
                  </span>
                  <span role="cell" className="min-w-0 truncate">
                    {run.itemId && run.itemName ? (
                      <Link
                        href={`${routes.board(orgSlug, context.boardId)}?item=${run.itemId}`}
                        title={run.itemName}
                        className="relative z-[1] rounded-xs text-fg-link underline-offset-2 transition-colors duration-[var(--duration-fast)] hover:text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                      >
                        {run.itemName}
                      </Link>
                    ) : (
                      <em className="text-fg-muted not-italic">Deleted {context.term.toLowerCase()}</em>
                    )}
                  </span>
                  <span role="cell" className="mt-1 flex items-center justify-between gap-3 md:mt-0 md:block">
                    <StatusPill label={meta.label} color={meta.color} />
                    <span
                      aria-hidden
                      className="text-xs text-fg-secondary tabular-nums md:hidden"
                      title={formatDateTime(run.createdAt)}
                    >
                      {relativeTime(run.createdAt)}
                    </span>
                  </span>
                  <span
                    role="cell"
                    className="sr-only text-right text-fg-secondary tabular-nums md:not-sr-only md:block"
                  >
                    {formatDuration(run.durationMs)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {runs.hasNextPage ? (
        <Button
          variant="secondary"
          className="self-center"
          onClick={() => void runs.fetchNextPage()}
          loading={runs.isFetchingNextPage}
        >
          Load older runs
        </Button>
      ) : null}
      <RunDrawer
        run={selected}
        orgSlug={orgSlug}
        context={context}
        canEdit={canEdit}
        onClose={() => setSelected(null)}
        returnFocus={returnFocus}
        automation={selected ? automations.find((entry) => entry.id === selected.automationId) : undefined}
        onEditAutomation={onEditAutomation}
        onFilterAutomation={(id) => onAutomationChange(id)}
      />
    </div>
  );
}

/** Table-shaped skeleton (same row rhythm as the loaded table, so nothing jumps). */
export function RunRowsSkeleton({ rows = 6 }: { readonly rows?: number }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="flex flex-col">
      <span className="sr-only">Loading runs</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={cn(
            'flex flex-col gap-2 border-b border-border-subtle px-4 py-3 last:border-0 md:grid md:items-center md:gap-3',
            GRID,
          )}
        >
          <Skeleton width={84} height={14} className="hidden md:block" />
          <span className="flex flex-col gap-1.5">
            <Skeleton width="70%" height={14} />
            <Skeleton width="90%" height={10} />
          </span>
          <Skeleton width="60%" height={14} />
          <Skeleton width={84} height={24} rounded="full" />
          <Skeleton width={40} height={14} className="hidden justify-self-end md:block" />
        </div>
      ))}
    </div>
  );
}
