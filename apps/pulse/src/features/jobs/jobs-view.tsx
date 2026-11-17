'use client';
/**
 * The jobs list: the product's front door. Jobs losing money and at risk come first, each with
 * its reason in plain words. Search, filters, sort, grouping, a column chooser, saved views,
 * bulk actions, a board by status and a CSV export of exactly what is on screen.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, ArrowDown, ArrowUp, CalendarClock, CheckCircle2, Columns3, Copy, Download, FileSpreadsheet, Filter, LayoutGrid, List, MoreHorizontal, Package, PackagePlus, SearchX, Trash2, UserRound, X, type LucideIcon } from 'lucide-react';
import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Field,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SearchInput,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  ToggleGroup,
  toast,
} from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { MarginPill } from '@/components/charts/stats';
import { Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { useShell } from '@/features/shell/shell-context';
import { JOB_STATUS_LABELS, PULSE_STATUSES, PULSE_STATUS_LABELS, type JobStatusValue, type JobTab, type PulseStatus } from '@/lib/constants';
import { toCsv } from '@/lib/csv/write';
import { formatMoney, formatPercentBp } from '@/lib/format';
import { useJobs, usePeople, useProfit } from '@/lib/hooks/use-data';
import { centsToNumber, sumCents } from '@/lib/money';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { routes } from '@/lib/routes';
import type { ClientDTO, JobListItemDTO, JobTypeDTO, SiteDTO } from '@/lib/types';
import { shiftDate, singularUnit } from './job-math';
import { JobStatusBadge, LoadError, RiskPill, UnitsProgress } from './job-ui';
import { DEFAULT_COLUMNS, JOB_COLUMNS, SORT_OPTIONS, jobsCsv, sortJobs, type ColumnContext, type SortKey } from './jobs-columns';
import { JobsBoard } from './jobs-board';
import { DEFAULT_VIEW, GROUP_OPTIONS, type GroupKey, type JobsViewConfig } from './jobs-config';
import { JobsViewsBar } from './jobs-views-bar';
import { QuickAddJob } from './quick-add';
import { STATUS_MOVES, statusMoveLabel, useJobActions } from './use-job-actions';

const EMPTY: Readonly<Record<JobTab, { icon: LucideIcon; title: string; why: string; points?: readonly string[] }>> = {
  open: {
    icon: Package,
    title: 'No open jobs',
    why: 'A job is one piece of work for one client, like building 5,000 gift kits. Add one and Pulse tracks its revenue, cost and margin as the work gets logged.',
    points: ['Jobs at risk or losing money come first, with the reason', 'How much is done, and what profit the job is heading for', 'One click from a job to its plan, work log and costs'],
  },
  all: { icon: Package, title: 'No jobs yet', why: 'Every job you add shows up here, whatever its stage. Type one in, or bring a whole list in from a spreadsheet.' },
  completed: { icon: CheckCircle2, title: 'No completed jobs yet', why: 'When a job is finished, mark it complete. It moves here with its final revenue, cost and margin, so you can price the next one better.' },
  planned: { icon: CalendarClock, title: 'No planned jobs', why: 'Planned jobs are quoted or booked but not started. Add one early to see the margin you expect before any work begins.' },
};

const STORAGE_KEY = 'pulse.jobs.view.v1';

function readStored(): Partial<JobsViewConfig> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<JobsViewConfig>;
    const known = new Set<string>(JOB_COLUMNS.map((column) => column.id));
    return {
      columns: Array.isArray(parsed.columns) ? parsed.columns.filter((id) => known.has(id)) : undefined,
      group: GROUP_OPTIONS.some((option) => option.value === parsed.group) ? parsed.group : undefined,
      layout: parsed.layout === 'board' || parsed.layout === 'list' ? parsed.layout : undefined,
    };
  } catch {
    return {};
  }
}

function download(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export interface JobsViewProps {
  readonly tab: JobTab;
  readonly initialJobs?: readonly JobListItemDTO[];
  readonly initialRisk: readonly PulseStatus[];
  readonly initialQuery: string;
  readonly clients: readonly ClientDTO[];
  readonly jobTypes: readonly JobTypeDTO[];
  readonly sites: readonly SiteDTO[];
  readonly today: string;
  readonly initialViewId?: string | null;
}

export function JobsView({ tab, initialJobs, initialRisk, initialQuery, clients, jobTypes, sites, today, initialViewId }: JobsViewProps) {
  const shell = useShell();
  const router = useRouter();
  const canManage = shell.can('job:manage');
  const canExport = shell.can('export:run');
  const [view, setView] = useState<JobsViewConfig>({ ...DEFAULT_VIEW, risk: initialRisk, q: initialQuery });
  const [search, setSearch] = useState(initialQuery);
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [statusOverride, setStatusOverride] = useState<ReadonlyMap<string, JobStatusValue>>(new Map());
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search, 150);

  // Columns, grouping and layout are remembered on this device between visits.
  useEffect(() => {
    const stored = readStored();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one time read of this device's saved layout after hydration
    setView((current) => ({ ...current, columns: stored.columns && stored.columns.length > 0 ? stored.columns : current.columns, group: stored.group ?? current.group, layout: stored.layout ?? current.layout }));
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ columns: view.columns, group: view.group, layout: view.layout }));
    } catch {
      // Private mode: the layout just does not stick.
    }
  }, [view.columns, view.group, view.layout]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the search box settles before the list filters
    setView((current) => (current.q === debouncedSearch ? current : { ...current, q: debouncedSearch }));
  }, [debouncedSearch]);

  // Keep the address bar in step, so a filtered list can be shared as a link.
  useEffect(() => {
    const url = new URL(window.location.href);
    const set = (key: string, value: string | null) => (value ? url.searchParams.set(key, value) : url.searchParams.delete(key));
    set('risk', view.risk.join(',') || null);
    set('q', view.q || null);
    window.history.replaceState(window.history.state, '', url);
  }, [view.risk, view.q]);

  const jobsQuery = useJobs({ tab, includeArchived: showArchived || undefined }, { initialData: !showArchived && initialJobs ? [...initialJobs] : undefined });
  const trendQuery = useProfit('job', { from: shiftDate(today, -83), to: today, trend: true });
  const people = usePeople();
  const peopleName = useCallback((id: string | null) => (id ? (people.data?.find((person) => person.id === id)?.name ?? '') : ''), [people.data]);

  const trends = useMemo(() => {
    const map = new Map<string, readonly number[]>();
    for (const row of trendQuery.data?.rows ?? []) if (row.trend) map.set(row.key, row.trend);
    return map;
  }, [trendQuery.data]);
  const columnContext: ColumnContext = useMemo(() => ({ trends, peopleName, seesMoney: shell.seesMoney }), [trends, peopleName, shell.seesMoney]);

  const actions = useJobActions({
    onHide: (id) => setHidden((current) => new Set(current).add(id)),
    onShow: (id) =>
      setHidden((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      }),
    onStatus: (id, status) =>
      setStatusOverride((current) => {
        const next = new Map(current);
        if (status) next.set(id, status);
        else next.delete(id);
        return next;
      }),
  });

  const all = useMemo(() => {
    const list = (jobsQuery.data ?? []).filter((job) => !hidden.has(job.id));
    return list.map((job) => {
      const status = statusOverride.get(job.id);
      return status && status !== job.status ? { ...job, status } : job;
    });
  }, [jobsQuery.data, hidden, statusOverride]);

  // Every filter but the status chips, so the chips can show how many jobs each one would leave.
  const beforeRisk = useMemo(() => {
    const q = view.q.trim().toLowerCase();
    return all.filter((job) => {
      if (q && !(job.number.toLowerCase().includes(q) || job.name.toLowerCase().includes(q) || job.clientName.toLowerCase().includes(q) || (job.poNumber ?? '').toLowerCase().includes(q))) return false;
      if (view.clientId && job.clientId !== view.clientId) return false;
      if (view.jobTypeId && job.jobTypeId !== view.jobTypeId) return false;
      if (view.siteId && job.siteId !== view.siteId) return false;
      if (view.ownerId && job.ownerId !== view.ownerId) return false;
      if (view.dueFrom && (!job.dueDate || job.dueDate < view.dueFrom)) return false;
      if (view.dueTo && (!job.dueDate || job.dueDate > view.dueTo)) return false;
      return true;
    });
  }, [all, view.q, view.clientId, view.jobTypeId, view.siteId, view.ownerId, view.dueFrom, view.dueTo]);

  const riskCounts = useMemo(() => {
    const counts: Record<PulseStatus, number> = { losing: 0, at_risk: 0, no_data: 0, heads_up: 0, on_track: 0 };
    for (const job of beforeRisk) if (job.stats.riskStatus) counts[job.stats.riskStatus] += 1;
    return counts;
  }, [beforeRisk]);

  const filtered = useMemo(() => (view.risk.length === 0 ? beforeRisk : beforeRisk.filter((job) => job.stats.riskStatus !== null && view.risk.includes(job.stats.riskStatus))), [beforeRisk, view.risk]);
  const sorted = useMemo(() => sortJobs(filtered, view.sort, view.dir), [filtered, view.sort, view.dir]);

  const groups = useMemo(() => {
    if (view.group === 'none') return [{ key: 'all', label: '', jobs: sorted }];
    const map = new Map<string, { key: string; label: string; jobs: JobListItemDTO[] }>();
    for (const job of sorted) {
      const [key, label] =
        view.group === 'client'
          ? [job.clientId, job.clientName]
          : view.group === 'type'
            ? [job.jobTypeId, job.jobTypeName]
            : view.group === 'site'
              ? [job.siteId, job.siteName]
              : view.group === 'owner'
                ? [job.ownerId ?? 'none', peopleName(job.ownerId) || 'No owner']
                : view.group === 'status'
                  ? [job.status, JOB_STATUS_LABELS[job.status]]
                  : [job.stats.riskStatus ?? 'none', job.stats.riskStatus ? PULSE_STATUS_LABELS[job.stats.riskStatus] : 'No status yet'];
      const group = map.get(key) ?? { key, label, jobs: [] };
      group.jobs.push(job);
      map.set(key, group);
    }
    return [...map.values()];
  }, [sorted, view.group, peopleName]);

  const columns = useMemo(() => JOB_COLUMNS.filter((column) => view.columns.includes(column.id) && (shell.seesMoney || !column.money)), [view.columns, shell.seesMoney]);
  const selectedJobs = useMemo(() => sorted.filter((job) => selected.has(job.id)), [sorted, selected]);
  const allSelected = sorted.length > 0 && selectedJobs.length === sorted.length;

  const patch = useCallback((change: Partial<JobsViewConfig>) => {
    setView((current) => ({ ...current, ...change }));
    setActiveViewId(null);
  }, []);
  const applyView = useCallback((config: JobsViewConfig, id: string | null) => {
    setView(config);
    setSearch(config.q);
    setActiveViewId(id);
    setSelected(new Set());
  }, []);

  const filterCount = [view.clientId, view.jobTypeId, view.siteId, view.ownerId, view.dueFrom, view.dueTo].filter(Boolean).length;
  const anyFilter = filterCount > 0 || view.risk.length > 0 || view.q.trim() !== '';
  const clearFilters = () => {
    setSearch('');
    patch({ q: '', risk: [], clientId: null, jobTypeId: null, siteId: null, ownerId: null, dueFrom: null, dueTo: null });
  };

  const toggleRisk = (status: PulseStatus) => patch({ risk: view.risk.includes(status) ? view.risk.filter((item) => item !== status) : [...view.risk, status] });
  const toggleSelect = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const setSort = (key: SortKey) => patch(view.sort === key ? { dir: view.dir === 'asc' ? 'desc' : 'asc' } : { sort: key, dir: 'asc' });

  const exportCsv = (jobs: readonly JobListItemDTO[]) => {
    const { headers, rows } = jobsCsv(jobs, view.columns, columnContext);
    download(`pulse-jobs-${tab}-${today}.csv`, toCsv(headers, rows));
    toast.success(`Exported ${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'}`, 'The file holds the rows and columns on screen.');
  };

  const peopleOptions = useMemo(() => (people.data ?? []).map((person) => ({ value: person.id, label: person.name })), [people.data]);

  if (jobsQuery.isError && !jobsQuery.data) {
    return <LoadError what="your jobs" message={jobsQuery.error instanceof Error ? jobsQuery.error.message : undefined} onRetry={() => void jobsQuery.refetch()} />;
  }
  if (jobsQuery.isPending && !jobsQuery.data) return <JobsSkeleton />;

  const empty = EMPTY[tab];
  if (all.length === 0 && !showArchived) {
    return (
      <div className="flex flex-col gap-4">
        {canManage && (tab === 'open' || tab === 'all') ? <QuickAddJob clients={clients} onAdded={() => void actions.refresh()} /> : null}
        <Panel>
          <Teach
            testId="jobs-empty"
            icon={empty.icon}
            title={empty.title}
            why={empty.why}
            points={empty.points}
            actions={
              canManage ? (
                <>
                  <ButtonLink href={routes.newJob()} icon={<PackagePlus aria-hidden />}>
                    Add a job
                  </ButtonLink>
                  <ButtonLink href={routes.newImport('jobs')} variant="secondary" icon={<FileSpreadsheet aria-hidden />}>
                    Import from a spreadsheet
                  </ButtonLink>
                </>
              ) : (
                <ButtonLink href={routes.jobs({ tab: 'all' })} variant="secondary">
                  See all jobs
                </ButtonLink>
              )
            }
            footnote={canManage ? undefined : 'Your role can read jobs but not add them. Ask a manager to add the first one.'}
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="jobs-view">
      <JobsViewsBar tab={tab} current={view} activeId={activeViewId} onApply={applyView} canShare={canManage} clients={clients} initialViewId={initialViewId} />

      <div role="group" aria-label="Filter by status" className="flex flex-wrap items-center gap-2">
        {(['losing', 'at_risk', 'no_data', 'heads_up', 'on_track'] as const).map((status) => {
          const on = view.risk.includes(status);
          return (
            <button
              key={status}
              type="button"
              aria-pressed={on}
              data-testid={`risk-chip-${status}`}
              onClick={() => toggleRisk(status)}
              className={cn(
                'inline-flex h-8 items-center gap-2 rounded-full border px-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                on ? 'border-primary bg-primary-subtle text-fg' : 'border-border-subtle bg-panel text-fg-secondary hover:bg-hover',
                riskCounts[status] === 0 && !on && 'opacity-60',
              )}
            >
              <MarginPill status={status} size="sm" />
              <span className="font-semibold text-fg tabular-nums">{riskCounts[status]}</span>
            </button>
          );
        })}
        {anyFilter ? (
          <Button variant="ghost" size="sm" leadingIcon={<X aria-hidden />} onClick={clearFilters} data-testid="jobs-clear-filters">
            Clear filters
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onValueChange={setSearch} placeholder="Search by job, client or PO" aria-label="Search jobs" containerClassName="w-full sm:w-64" data-testid="jobs-search" />
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary" leadingIcon={<Filter aria-hidden />} data-testid="jobs-filters">
              Filters{filterCount > 0 ? ` (${filterCount})` : ''}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[320px] max-w-[calc(100vw-24px)]">
            <div className="flex flex-col gap-3">
              <Field label="Client">{({ inputId }) => <Select id={inputId} aria-label="Client" value={view.clientId ?? 'any'} onValueChange={(value) => patch({ clientId: value === 'any' ? null : value })} options={[{ value: 'any', label: 'Any client' }, ...clients.map((client) => ({ value: client.id, label: client.name }))]} />}</Field>
              <Field label="Job type">{({ inputId }) => <Select id={inputId} aria-label="Job type" value={view.jobTypeId ?? 'any'} onValueChange={(value) => patch({ jobTypeId: value === 'any' ? null : value })} options={[{ value: 'any', label: 'Any job type' }, ...jobTypes.map((type) => ({ value: type.id, label: type.name }))]} />}</Field>
              {sites.length > 1 ? (
                <Field label="Site">{({ inputId }) => <Select id={inputId} aria-label="Site" value={view.siteId ?? 'any'} onValueChange={(value) => patch({ siteId: value === 'any' ? null : value })} options={[{ value: 'any', label: 'Any site' }, ...sites.map((site) => ({ value: site.id, label: site.name }))]} />}</Field>
              ) : null}
              <Field label="Owner">{({ inputId }) => <Select id={inputId} aria-label="Owner" value={view.ownerId ?? 'any'} onValueChange={(value) => patch({ ownerId: value === 'any' ? null : value })} options={[{ value: 'any', label: 'Anyone' }, ...peopleOptions]} />}</Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Due from">{({ inputId }) => <Input id={inputId} type="date" value={view.dueFrom ?? ''} onChange={(event) => patch({ dueFrom: event.target.value || null })} />}</Field>
                <Field label="Due to">{({ inputId }) => <Input id={inputId} type="date" value={view.dueTo ?? ''} onChange={(event) => patch({ dueTo: event.target.value || null })} />}</Field>
              </div>
              {tab !== 'all' ? <Checkbox checked={showArchived} onCheckedChange={(value) => setShowArchived(value === true)} label="Show archived jobs" /> : null}
              {filterCount > 0 ? (
                <Button variant="ghost" size="sm" className="self-start" onClick={() => patch({ clientId: null, jobTypeId: null, siteId: null, ownerId: null, dueFrom: null, dueTo: null })}>
                  Clear these filters
                </Button>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" leadingIcon={view.dir === 'asc' ? <ArrowUp aria-hidden /> : <ArrowDown aria-hidden />} data-testid="jobs-sort">
              <span className="hidden sm:inline">Sort: </span>
              {SORT_OPTIONS.find((option) => option.value === view.sort)?.label ?? JOB_COLUMNS.find((column) => column.id === view.sort)?.label ?? 'Worst first'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={view.sort} onValueChange={(value) => patch({ sort: value as SortKey, dir: 'asc' })}>
              {SORT_OPTIONS.filter((option) => shell.seesMoney || !['projProfit', 'margin'].includes(option.value)).map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={view.dir} onValueChange={(value) => patch({ dir: value === 'desc' ? 'desc' : 'asc' })}>
              <DropdownMenuRadioItem value="asc">{view.sort === 'worst' ? 'Worst at the top' : 'Low to high'}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="desc">{view.sort === 'worst' ? 'Best at the top' : 'High to low'}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {view.layout === 'list' ? (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" data-testid="jobs-group">
                  Group: {GROUP_OPTIONS.find((option) => option.value === view.group)?.label}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Group rows by</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={view.group} onValueChange={(value) => patch({ group: value as GroupKey })}>
                  {GROUP_OPTIONS.map((option) => (
                    <DropdownMenuRadioItem key={option.value} value={option.value}>
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" leadingIcon={<Columns3 aria-hidden />} data-testid="jobs-columns" className="hidden md:inline-flex">
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                {JOB_COLUMNS.filter((column) => shell.seesMoney || !column.money).map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={view.columns.includes(column.id)}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={(checked) => patch({ columns: checked ? JOB_COLUMNS.map((item) => item.id).filter((id) => id === column.id || view.columns.includes(id)) : view.columns.filter((id) => id !== column.id) })}
                  >
                    {column.longLabel ?? column.label}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => patch({ columns: DEFAULT_COLUMNS })}>Back to the usual columns</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <ToggleGroup
            label="Layout"
            value={view.layout}
            onValueChange={(value) => patch({ layout: value })}
            options={[
              { value: 'list', label: 'List', icon: <List aria-hidden />, iconOnly: true },
              { value: 'board', label: 'Board', icon: <LayoutGrid aria-hidden />, iconOnly: true },
            ]}
          />
          {canExport ? (
            <Button variant="secondary" leadingIcon={<Download aria-hidden />} onClick={() => exportCsv(sorted)} disabled={sorted.length === 0} data-testid="jobs-export">
              <span className="hidden sm:inline">Export CSV</span>
              <span className="sm:hidden">CSV</span>
            </Button>
          ) : null}
        </div>
      </div>

      {canManage && tab === 'open' ? <QuickAddJob clients={clients} onAdded={() => void actions.refresh()} /> : null}

      {selectedJobs.length > 0 ? (
        <div role="region" aria-label="Bulk actions" data-testid="jobs-bulk" className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-primary bg-raised px-3 py-2 shadow-md">
          <span className="text-sm font-medium text-fg">{selectedJobs.length} selected</span>
          {canManage ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="sm" data-testid="bulk-status">
                    Set stage
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {(['active', 'on_hold', 'completed', 'planned', 'cancelled'] as const).map((status) => (
                    <DropdownMenuItem key={status} onSelect={() => void actions.bulk(selectedJobs, { status }, `Moved to ${JOB_STATUS_LABELS[status].toLowerCase()}`).then(() => setSelected(new Set()))}>
                      {JOB_STATUS_LABELS[status]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="sm" leadingIcon={<UserRound aria-hidden />} data-testid="bulk-owner">
                    Set owner
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                  <DropdownMenuItem onSelect={() => void actions.bulk(selectedJobs, { ownerId: null }, 'Owner cleared').then(() => setSelected(new Set()))}>No owner</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {peopleOptions.map((person) => (
                    <DropdownMenuItem key={person.value} onSelect={() => void actions.bulk(selectedJobs, { ownerId: person.value }, `Owner set to ${person.label}`).then(() => setSelected(new Set()))}>
                      {person.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="secondary" size="sm" leadingIcon={<Archive aria-hidden />} data-testid="bulk-archive" onClick={() => void actions.bulk(selectedJobs, { archived: true }, 'Archived').then(() => setSelected(new Set()))}>
                Archive
              </Button>
            </>
          ) : null}
          {canExport ? (
            <Button variant="secondary" size="sm" leadingIcon={<Download aria-hidden />} onClick={() => exportCsv(selectedJobs)}>
              Export these
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      ) : null}

      {sorted.length === 0 ? (
        <Panel>
          <Teach
            testId="jobs-no-match"
            size="sm"
            icon={SearchX}
            title="No jobs match"
            why="Nothing in this list fits the search and filters you picked. Clear them to see every job again."
            actions={
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        </Panel>
      ) : view.layout === 'board' ? (
        <JobsBoard jobs={sorted} seesMoney={shell.seesMoney} />
      ) : (
        <>
          {/* Wide screens: the table. */}
          <div className="hidden overflow-x-auto rounded-xl border border-border-subtle bg-panel shadow-xs md:block">
            <Table aria-label="Jobs" data-testid="jobs-table" aria-busy={jobsQuery.isFetching}>
              <TableHead>
                <TableRow className="hover:bg-transparent">
                  <TableHeaderCell className="w-9 pr-0">
                    <Checkbox aria-label="Select every job in this list" checked={allSelected ? true : selectedJobs.length > 0 ? 'indeterminate' : false} onCheckedChange={(value) => setSelected(value === true ? new Set(sorted.map((job) => job.id)) : new Set())} />
                  </TableHeaderCell>
                  <SortHeader label="Job" active={view.sort === 'number' || view.sort === 'name'} dir={view.dir} onSort={() => setSort('number')} />
                  {columns.map((column) =>
                    column.sort ? (
                      <SortHeader key={column.id} label={column.label} numeric={column.numeric} active={view.sort === column.id || (column.id === 'risk' && view.sort === 'worst')} dir={view.dir} onSort={() => setSort(column.id === 'risk' ? 'worst' : column.id)} />
                    ) : (
                      <TableHeaderCell key={column.id} numeric={column.numeric}>
                        {column.label}
                      </TableHeaderCell>
                    ),
                  )}
                  <TableHeaderCell className="w-10">
                    <span className="sr-only">Actions</span>
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              {groups.map((group) => (
                <TableBody key={group.key}>
                  {view.group !== 'none' ? (
                    <TableRow className="bg-sunken hover:bg-sunken">
                      <TableCell colSpan={columns.length + 3} className="py-1.5">
                        <GroupSummary label={group.label} jobs={group.jobs} seesMoney={shell.seesMoney} />
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {group.jobs.map((job) => (
                    <TableRow key={job.id} data-selected={selected.has(job.id)} data-testid={`job-row-${job.number}`} className="h-auto cursor-pointer" onClick={() => router.push(routes.job(job.number))}>
                      <TableCell className="pr-0" onClick={(event) => event.stopPropagation()}>
                        <Checkbox aria-label={`Select ${job.number}`} checked={selected.has(job.id)} onCheckedChange={(value) => toggleSelect(job.id, value === true)} />
                      </TableCell>
                      <TableCell className="max-w-[300px]">
                        <Link href={routes.job(job.number)} onClick={(event) => event.stopPropagation()} className="group flex min-w-0 flex-col rounded-sm py-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                          <span className="truncate font-medium text-fg group-hover:underline">{job.name}</span>
                          <span className="flex items-center gap-1.5 text-xs text-fg-muted">
                            {job.number}
                            {job.archivedAt ? <span className="rounded-sm bg-muted px-1 text-2xs font-medium text-fg-secondary">Archived</span> : null}
                            {tab !== 'open' || job.status === 'on_hold' ? <span>· {JOB_STATUS_LABELS[job.status]}</span> : null}
                          </span>
                        </Link>
                      </TableCell>
                      {columns.map((column) => (
                        <TableCell key={column.id} numeric={column.numeric} className={column.className}>
                          {column.cell(job, columnContext)}
                        </TableCell>
                      ))}
                      <TableCell className="pl-0" onClick={(event) => event.stopPropagation()}>
                        <RowMenu job={job} canManage={canManage} actions={actions} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              ))}
            </Table>
          </div>

          {/* Phones: one card per job. */}
          <ul className="flex flex-col gap-2 md:hidden" aria-label="Jobs" data-testid="jobs-cards">
            {groups.map((group) => (
              <li key={group.key} className="flex flex-col gap-2">
                {view.group !== 'none' ? (
                  <div className="rounded-lg bg-sunken px-3 py-1.5">
                    <GroupSummary label={group.label} jobs={group.jobs} seesMoney={shell.seesMoney} />
                  </div>
                ) : null}
                <ul className="flex flex-col gap-2">
                  {group.jobs.map((job) => (
                    <li key={job.id} className="rounded-xl border border-border-subtle bg-panel p-3 shadow-xs">
                      <div className="flex items-start gap-2">
                        <Link href={routes.job(job.number)} className="min-w-0 flex-1 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                          <span className="block truncate font-medium text-fg">{job.name}</span>
                          <span className="block truncate text-xs text-fg-muted">
                            {job.number} · {job.clientName}
                          </span>
                        </Link>
                        <RowMenu job={job} canManage={canManage} actions={actions} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <RiskPill job={job} size="sm" />
                        {tab !== 'open' || job.status === 'on_hold' ? <JobStatusBadge status={job.status} /> : null}
                      </div>
                      {job.stats.headline ? <p className="mt-1.5 text-sm text-fg-secondary">{job.stats.headline}</p> : null}
                      <div className="mt-2.5 grid grid-cols-2 items-end gap-3">
                        <UnitsProgress done={job.stats.unitsGood} planned={job.plannedUnits} pctBp={job.stats.pctCompleteBp} unit={singularUnit(job.unitLabel)} />
                        {shell.seesMoney && !job.stats.moneyHidden ? (
                          <div className="text-right text-xs text-fg-muted">
                            <div>
                              Margin now <span className="font-medium text-fg tabular-nums">{formatPercentBp(job.stats.marginBp, { empty: 'none yet' })}</span>
                            </div>
                            <div>
                              At finish{' '}
                              <span className={cn('font-medium tabular-nums', (job.stats.projectedProfitCents ?? 0) < 0 ? 'text-danger-text' : 'text-fg')}>{formatMoney(job.stats.projectedProfitCents, { cents: false, empty: 'no projection' })}</span>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="text-xs text-fg-muted" aria-live="polite" data-testid="jobs-count">
        {sorted.length === all.length ? `${all.length} ${all.length === 1 ? 'job' : 'jobs'}` : `${sorted.length} of ${all.length} jobs`}
        {trendQuery.isError ? '. Trends could not load.' : ''}
      </p>
    </div>
  );
}

function SortHeader({ label, numeric, active, dir, onSort }: { readonly label: string; readonly numeric?: boolean; readonly active: boolean; readonly dir: 'asc' | 'desc'; readonly onSort: () => void }) {
  return (
    <TableHeaderCell numeric={numeric} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={onSort} className={cn('inline-flex items-center gap-1 rounded-sm hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus', active && 'text-fg')}>
        {label}
        {active ? dir === 'asc' ? <ArrowUp aria-hidden className="size-3" /> : <ArrowDown aria-hidden className="size-3" /> : null}
      </button>
    </TableHeaderCell>
  );
}

function GroupSummary({ label, jobs, seesMoney }: { readonly label: string; readonly jobs: readonly JobListItemDTO[]; readonly seesMoney: boolean }) {
  const flagged = jobs.filter((job) => job.stats.riskStatus === 'losing' || job.stats.riskStatus === 'at_risk').length;
  const known = jobs.filter((job) => job.stats.projectedProfitCents !== null);
  const total = centsToNumber(sumCents(known.map((job) => job.stats.projectedProfitCents)));
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
      <span className="text-sm font-semibold text-fg">{label}</span>
      <span className="text-fg-muted">
        {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}
      </span>
      {flagged > 0 ? <span className="text-danger-text">{flagged} at risk or losing money</span> : null}
      {seesMoney && known.length > 0 ? <span className="text-fg-muted tabular-nums">Profit at finish {formatMoney(total, { cents: false })}</span> : null}
    </div>
  );
}

function RowMenu({ job, canManage, actions }: { readonly job: JobListItemDTO; readonly canManage: boolean; readonly actions: ReturnType<typeof useJobActions> }) {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={`Actions for ${job.number}`} icon={<MoreHorizontal aria-hidden />} size="sm" hideTooltip data-testid={`job-menu-${job.number}`} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => router.push(routes.job(job.number))}>Open the job</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push(routes.log({ job: job.number }))}>Log work for it</DropdownMenuItem>
        {canManage ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Change stage</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {STATUS_MOVES[job.status].map((status) => (
                  <DropdownMenuItem key={status} onSelect={() => void actions.setStatus(job, status)}>
                    {statusMoveLabel(job.status, status)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem icon={<Copy aria-hidden />} onSelect={() => void actions.duplicate(job)}>
              Copy this job
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Archive aria-hidden />} onSelect={() => void actions.archive(job, job.archivedAt === null)}>
              {job.archivedAt === null ? 'Archive' : 'Bring back from the archive'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="danger" icon={<Trash2 aria-hidden />} onSelect={() => void actions.remove(job)}>
              Delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function JobsSkeleton() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-busy="true" data-testid="jobs-loading">
      <span className="sr-only">Loading jobs</span>
      <div className="flex gap-2">
        {[120, 96, 140, 110, 100].map((width, index) => (
          <Skeleton key={index} width={width} height={32} rounded="full" />
        ))}
      </div>
      <Skeleton height={32} className="w-full sm:w-64" />
      <div className="rounded-xl border border-border-subtle bg-panel p-3">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="flex items-center gap-4 border-b border-border-subtle py-3 last:border-b-0">
            <Skeleton width={16} height={16} />
            <Skeleton height={14} className="w-1/4" />
            <Skeleton height={14} className="w-1/3" />
            <Skeleton height={14} className="ml-auto w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
