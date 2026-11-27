'use client';
/**
 * Organization automations (`/[orgSlug]/automations`): usage meter with forecast and daily runs,
 * plus every automation the caller can see across boards (toggle, runs this month, failures,
 * last run, deep link to the board's automations center).
 */
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowUpRight, CircleAlert, Zap } from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
  SearchInput,
  Select,
  Skeleton,
  Tooltip,
  cn,
} from '@/components/ui';
import { errorMessage } from '@/lib/hooks';
import { useOrg } from '@/features/shell/org-context';
import { routes } from '@/features/shell/routes';
import { PageFrame, PageSection } from '@/features/shell/pages/page-frame';
import type {
  AutomationUsageDto,
} from '@/server/services/contracts/automations-center';
import { useAutomationUsage } from './api';
import { useAutomationToggle, useEnabledOverrides } from './hooks/use-automation-toggle';
import { formatDateTime, relativeTime } from './components/format';
import { Switch } from './components/switch';
import { UsageMeter } from './components/usage-meter';

type StatusFilter = 'all' | 'on' | 'off' | 'failing';

const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'on', 'off', 'failing'];

function isStatusFilter(value: string | null | undefined): value is StatusFilter {
  return (STATUS_FILTERS as readonly (string | null | undefined)[]).includes(value);
}

/**
 * The status filter lives in `?status=` so a headline number (and Admin > Usage) can link to the
 * filtered list. Native history keeps a change client only; Next syncs useSearchParams with it.
 */
function useStatusFilter(): readonly [StatusFilter, (next: StatusFilter) => void] {
  const search = useSearchParams();
  const raw = search?.get('status');
  const status = isStatusFilter(raw) ? raw : 'all';
  const setStatus = useCallback((next: StatusFilter) => {
    const params = new URLSearchParams(window.location.search);
    if (next === 'all') params.delete('status');
    else params.set('status', next);
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, []);
  return [status, setStatus] as const;
}

const TICK_DAYS = [1, 8, 15, 22, 29] as const;

function DailyBars({ usage }: { readonly usage: AutomationUsageDto }) {
  const max = Math.max(1, ...usage.daily);
  const month = new Date(usage.monthStart).toLocaleDateString(undefined, { month: 'long', timeZone: 'UTC' });
  const short = new Date(usage.monthStart).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
  const days = usage.daily.length;
  const total = usage.daily.reduce((sum, runs) => sum + runs, 0);
  const elapsed = usage.daily.slice(0, usage.dayOfMonth);
  const peak = Math.max(0, ...elapsed);
  const peakDay = elapsed.indexOf(peak) + 1;
  const todayRuns = usage.daily[usage.dayOfMonth - 1] ?? 0;
  const summary =
    total === 0
      ? `Runs per day in ${month}: no runs yet this month.`
      : `Runs per day in ${month}: ${total.toLocaleString()} total, peak ${peak.toLocaleString()} on ${month} ${peakDay}, ${todayRuns.toLocaleString()} today.`;
  return (
    <figure className="flex h-full min-h-[220px] flex-col gap-3" data-testid="daily-runs-chart">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-fg-muted ">Runs per day · {month}</span>
        <span className="text-xs text-fg-secondary tabular-nums">{total.toLocaleString()} total</span>
      </figcaption>
      <div className="relative flex min-h-[140px] flex-1 flex-col">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border-default">
          <span className="absolute -top-2.5 right-0 bg-panel pl-1.5 text-2xs leading-5 text-fg-muted tabular-nums">
            {max.toLocaleString()}
          </span>
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-border-subtle" />
        <div
          role="img"
          aria-label={summary}
          className="relative flex flex-1 items-end gap-[3px] border-b border-border-default pt-3"
        >
          {usage.daily.map((runs, index) => {
            const day = index + 1;
            const future = day > usage.dayOfMonth;
            const today = day === usage.dayOfMonth;
            const label = future
              ? `${month} ${day}: upcoming`
              : `${month} ${day}${today ? ' (today)' : ''}: ${runs.toLocaleString()} ${runs === 1 ? 'run' : 'runs'}`;
            return (
              // Bars are not interactive: one tab stop (none) for the whole chart, hover tooltips only.
              <Tooltip key={day} content={label} side="top">
                <span aria-hidden className="group/bar flex h-full min-w-0 flex-1 items-end">
                  <span
                    className={cn(
                      'block w-full rounded-t-xs transition-[background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]',
                      future
                        ? 'bg-sunken'
                        : today
                          ? 'bg-data'
                          : 'bg-data/45 group-hover/bar:bg-data/75',
                    )}
                    style={{ height: future || runs === 0 ? '3px' : `${Math.max(4, (runs / max) * 100)}%` }}
                  />
                </span>
              </Tooltip>
            );
          })}
        </div>
        <div aria-hidden className="relative mt-1.5 h-8 text-2xs text-fg-muted tabular-nums">
          {TICK_DAYS.filter((day) => day <= days).map((day) => (
            <span
              key={day}
              className="absolute -translate-x-1/2"
              style={{ left: `${((day - 0.5) / days) * 100}%` }}
            >
              {day === 1 ? `${short} 1` : day}
            </span>
          ))}
          <span
            className="absolute -translate-x-1/2 font-semibold text-fg-secondary"
            style={{ left: `${((usage.dayOfMonth - 0.5) / days) * 100}%`, top: '14px' }}
          >
            Today
          </span>
        </div>
      </div>
    </figure>
  );
}

function DailyBarsSkeleton() {
  return (
    <div aria-hidden className="flex h-full min-h-[220px] flex-col gap-3">
      <div className="flex h-4 items-center justify-between">
        <Skeleton width={160} height={10} />
        <Skeleton width={56} height={10} />
      </div>
      <div className="flex min-h-[140px] flex-1 flex-col">
        <div className="flex flex-1 items-end gap-[3px] border-b border-border-default pt-3">
          {Array.from({ length: 30 }, (_, index) => (
            <div key={index} className="min-w-0 flex-1 animate-pulse rounded-t-xs bg-sunken" style={{ height: `${20 + ((index * 37) % 60)}%` }} />
          ))}
        </div>
        <div className="mt-1.5 h-8" />
      </div>
    </div>
  );
}

/** A number in the usage card. With `href` it opens the list below, filtered to what it counts. */
function Stat({
  label,
  value,
  tone,
  href,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: 'danger';
  readonly href?: string;
}) {
  const body = (
    <>
      <span className="text-xs leading-4 text-fg-secondary">{label}</span>
      <span
        className={cn(
          'text-xl leading-7 font-semibold tabular-nums',
          tone === 'danger' ? 'text-danger-text' : 'text-fg',
        )}
      >
        {value}
      </span>
    </>
  );
  if (!href) return <div className="flex flex-col justify-end gap-0.5">{body}</div>;
  return (
    <Link
      href={href}
      scroll={false}
      className="-m-1 flex flex-col justify-end gap-0.5 rounded-sm p-1 transition-colors duration-[var(--duration-instant)] hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus active:bg-pressed"
    >
      {body}
    </Link>
  );
}

export function OrgAutomationsPage() {
  const { org, permissions } = useOrg();
  const usage = useAutomationUsage();
  const toggle = useAutomationToggle();
  const overrides = useEnabledOverrides();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useStatusFilter();
  const [boardFilter, setBoardFilter] = useState('all');
  const canWrite = permissions.includes('automation:write');

  const data = usage.data;
  const rows = useMemo(
    () =>
      (data?.automations ?? []).map((row) => {
        const override = overrides.get(row.id);
        return override === undefined ? row : { ...row, enabled: override };
      }),
    [data, overrides],
  );
  const boards = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) map.set(row.boardId, row.boardName);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);
  const q = query.trim().toLowerCase();
  const visible = rows
    .filter((row) => (boardFilter === 'all' ? true : row.boardId === boardFilter))
    .filter((row) =>
      status === 'on'
        ? row.enabled
        : status === 'off'
          ? !row.enabled
          : status === 'failing'
            ? row.failuresThisMonth > 0
            : true,
    )
    .filter((row) => !q || `${row.name} ${row.boardName}`.toLowerCase().includes(q))
    .slice()
    .sort((a, b) => b.runsThisMonth - a.runsThisMonth || a.name.localeCompare(b.name));
  const maxRuns = Math.max(1, ...rows.map((row) => row.runsThisMonth));
  const filtered = q !== '' || status !== 'all' || boardFilter !== 'all';

  return (
    <PageFrame
      title="Automations"
      icon={<Zap />}
      width="wide"
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <PageSection className="flex flex-col gap-5 p-5">
          <div>
            <h2 className="mb-3 text-md font-semibold text-fg">Runs this month</h2>
            <UsageMeter usage={data} />
          </div>
          {data ? (
            <div className="grid grid-cols-3 items-end gap-4 border-t border-border-subtle pt-4">
              <Stat
                label="Active automations"
                value={rows.filter((row) => row.enabled).length.toLocaleString()}
                href={routes.automations(org.slug, 'on')}
              />
              <Stat label="Boards" value={boards.length.toLocaleString()} />
              <Stat
                label="Failed runs"
                value={data.failuresThisMonth.toLocaleString()}
                tone={data.failuresThisMonth > 0 ? 'danger' : undefined}
                href={routes.automations(org.slug, 'failing')}
              />
            </div>
          ) : (
            <div
              aria-hidden
              className="grid grid-cols-3 items-end gap-4 border-t border-border-subtle pt-4"
            >
              {[0, 1, 2].map((index) => (
                <div key={index} className="flex flex-col gap-0.5">
                  <div className="flex h-4 items-center">
                    <Skeleton width="70%" height={10} />
                  </div>
                  <div className="flex h-7 items-center">
                    <Skeleton width={40} height={20} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-fg-muted">
            The allowance is informational in this workspace: automations keep running past it.
          </p>
        </PageSection>
        <PageSection className="flex flex-col p-5">
          {data ? <DailyBars usage={data} /> : <DailyBarsSkeleton />}
        </PageSection>
      </div>

      <PageSection>
        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-3">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search automations or boards"
            aria-label="Search automations"
            containerClassName="w-full sm:w-72"
          />
          <Select
            aria-label="Filter by status"
            value={status}
            onValueChange={(value) => setStatus(value as StatusFilter)}
            options={[
              { value: 'all', label: 'All statuses' },
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
              { value: 'failing', label: 'Failing this month' },
            ]}
            className="w-44"
          />
          <Select
            aria-label="Filter by board"
            value={boardFilter}
            onValueChange={setBoardFilter}
            options={[
              { value: 'all', label: 'All boards' },
              ...boards.map(([id, name]) => ({ value: id, label: name })),
            ]}
            className="w-52"
          />
        </div>
        <div
          aria-hidden
          className="hidden grid-cols-[48px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)_96px_120px_40px] items-center gap-3 border-b border-border-subtle bg-sunken px-4 py-2 text-xs font-semibold text-fg-secondary md:grid"
        >
          <span>On</span>
          <span>Automation</span>
          <span>Board</span>
          <span>Runs this month</span>
          <span className="text-right">Failures</span>
          <span>Last run</span>
          <span />
        </div>
        {usage.isPending ? (
          <div className="flex flex-col" aria-busy="true">
            {Array.from({ length: 6 }, (_, index) => (
              <div
                key={index}
                className="flex items-center gap-4 border-b border-border-subtle px-4 py-3.5 last:border-0"
              >
                <Skeleton width={40} height={22} rounded="full" />
                <Skeleton width="35%" height={14} />
                <Skeleton width="15%" height={14} />
              </div>
            ))}
          </div>
        ) : usage.isError ? (
          <EmptyState
            illustration="error"
            size="sm"
            title="Automations couldn’t load"
            description={errorMessage(usage.error)}
            actions={<Button onClick={() => void usage.refetch()}>Try again</Button>}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            illustration={filtered ? 'search' : 'board'}
            size="sm"
            title={filtered ? 'No automations match' : 'No automations yet'}
            description={
              filtered
                ? 'Try clearing the search or filters.'
                : 'Open any board and choose Automate to add your first recipe.'
            }
            actions={
              filtered ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQuery('');
                    setStatus('all');
                    setBoardFilter('all');
                  }}
                >
                  Clear filters
                </Button>
              ) : null
            }
          />
        ) : (
          <ul aria-label="Automations across boards" data-testid="org-automation-list">
            {visible.map((row) => {
              const href = `/${org.slug}/boards/${row.boardId}/automations?tab=automations`;
              return (
                <li
                  key={row.id}
                  data-testid="org-automation-row"
                  className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b border-border-subtle px-4 py-3 transition-colors duration-[var(--duration-instant)] last:border-0 hover:bg-hover md:grid-cols-[48px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)_96px_120px_40px]"
                >
                  <Switch
                    checked={row.enabled}
                    onCheckedChange={(enabled) => toggle(row, enabled)}
                    label={`${row.enabled ? 'Turn off' : 'Turn on'} ${row.name}`}
                    disabled={!canWrite}
                  />
                  <Link
                    href={href}
                    className="min-w-0 truncate rounded-xs font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                    title={row.name}
                  >
                    {row.name}
                  </Link>
                  <Link
                    href={`/${org.slug}/boards/${row.boardId}`}
                    className="col-start-2 min-w-0 truncate rounded-xs text-sm text-fg-secondary hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-focus md:col-start-auto"
                  >
                    {row.boardName}
                  </Link>
                  <span className="col-start-2 flex items-center gap-2 md:col-start-auto">
                    <span className="w-12 text-sm text-fg tabular-nums">
                      {row.runsThisMonth.toLocaleString()}
                    </span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
                      <span
                        className="block h-full rounded-full bg-data"
                        style={{ width: `${(row.runsThisMonth / maxRuns) * 100}%` }}
                      />
                    </span>
                  </span>
                  <span className="col-start-2 text-sm md:col-start-auto md:text-right">
                    {row.failuresThisMonth > 0 ? (
                      <Badge tone="danger" icon={<CircleAlert aria-hidden />}>
                        {row.failuresThisMonth} failed
                      </Badge>
                    ) : (
                      <span className="text-fg-muted">None</span>
                    )}
                  </span>
                  <span
                    className="col-start-2 text-sm text-fg-secondary md:col-start-auto"
                    title={row.lastRunAt ? formatDateTime(row.lastRunAt) : undefined}
                  >
                    {row.lastRunAt ? relativeTime(row.lastRunAt) : 'Never'}
                  </span>
                  <Link
                    href={href}
                    aria-label={`Open ${row.name}`}
                    className="col-start-3 row-start-1 inline-flex size-8 items-center justify-center rounded-sm text-icon transition-colors hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus active:bg-pressed md:col-start-auto md:row-start-auto"
                  >
                    <ArrowUpRight aria-hidden className="size-4" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </PageSection>
    </PageFrame>
  );
}
