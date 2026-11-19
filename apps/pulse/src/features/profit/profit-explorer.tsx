'use client';
/**
 * The Profit explorer. Everything on screen is in the URL: the grouping, the period and what it
 * is compared with, the filters, the view, the sort and the columns. So a link, a saved view and
 * the CSV export always show the same thing.
 */
import { useCallback, useMemo } from 'react';
import { ChevronRight, CircleDollarSign, Columns3, Download, PackagePlus, Rocket, SearchX, X } from 'lucide-react';
import { KpiTile } from '@/components/charts/stats';
import { ButtonLink } from '@/components/pulse/button-link';
import { ExplainNumber } from '@/components/pulse/explain';
import { Teach } from '@/components/pulse/teach';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { cn } from '@/components/ui/cn';
import { ScrollX } from '@/components/ui/scroll-x';
import { PROFIT_GROUPS, type ProfitGroup } from '@/lib/constants';
import type { CsvCell } from '@/lib/csv/write';
import { formatMoney, formatMoneyWhole, formatPace, formatPercentBp, formatPercentWhole } from '@/lib/format';
import { apiPath } from '@/lib/api-client';
import { reportQuery, useCompanyBridge, useJob, useProfit, useProfitPivot, useVasServices, type ProfitParams } from '@/lib/hooks/use-data';
import { COMPARE_MODE_SHORT, rangeLabel, type RangePreset } from '@/lib/reports';
import { routes } from '@/lib/routes';
import type { ClientDTO, JobTypeDTO, SiteDTO } from '@/lib/types';
import { useShell } from '@/features/shell/shell-context';
import { downloadCsv } from './csv-download';
import { EntriesDrawer } from './entries-drawer';
import { FilterBar, parseFilters } from './filter-bar';
import { parsePeriod, periodQuery } from './period';
import { PeriodPicker, type PeriodChange } from './period-picker';
import {
  ENTRY_FILTERS,
  EXPLORER_MODES,
  MODE_LABELS,
  PIVOT_MEASURES,
  PROFIT_COLUMNS,
  VIEW_LABELS,
  VIEW_NOUN,
  withArticle,
  compareOne,
  compareRows,
  contribution,
  csvHeader,
  csvValue,
  NO_COST_YET,
  defaultPivotBy,
  defaultSort,
  modesFor,
  paretoView,
  parseSort,
  pivotCsv,
  rowNoCost,
  rowLabel,
  sortParam,
  sortRows,
  visibleColumns,
  type EntryFilter,
  type ExplorerMode,
  type PivotMeasure,
  type SortState,
} from './profit-model';
import { LoadError, Section, TableSkeleton, comparable, moneyDelta, numberDelta, pointsDelta } from './profit-ui';
import { CHART_MEASURES, ChartView, ContributionView, ParetoView, PivotView, ServeView, TableView, type ChartMeasure } from './profit-views';
import { useQueryState } from './use-query-state';
import { companyMarginBp, companyWords } from '@/features/home/company-margin';
import { ViewsMenu } from './views-menu';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EMPTY_COPY: Readonly<Record<ProfitGroup, { title: string; why: string }>> = {
  job: { title: 'No job profit yet', why: 'Once a job has a price and some logged work, it shows here with its revenue, labor, materials, other costs, profit and margin.' },
  client: { title: 'No client profit yet', why: 'See which clients make you money and which ones cost you. Each client adds up the revenue and cost of all its jobs and extra services.' },
  type: { title: 'No profit by job type yet', why: 'Group your jobs by the kind of work, like kitting or relabeling, to see which kind pays best and where your pace is strongest.' },
  service: { title: 'No profit from extra services yet', why: 'Extra services are the small billable things around a job, like labeling or rework. Each one has its own revenue, cost and margin here.' },
  site: { title: 'No profit by site yet', why: 'With more than one site, this tab puts them side by side: margin, pace and time not on a job.' },
  month: { title: 'No monthly profit yet', why: 'Each month shows what your jobs made. Closed months are locked so the numbers stay put.' },
  week: { title: 'No weekly profit yet', why: 'Week by week revenue, cost and margin, so you can spot a bad week while there is still time to fix the month.' },
  day: { title: 'No daily profit yet', why: 'Every day with logged work shows its revenue earned, cost and margin. Click a day to see the entries behind it.' },
};

export interface ProfitExplorerProps {
  readonly by: ProfitGroup;
  readonly today: string;
  readonly weekStart: number;
  readonly targetMarginBp: number;
  readonly sites: readonly SiteDTO[];
  readonly clients: readonly ClientDTO[];
  readonly jobTypes: readonly JobTypeDTO[];
  readonly orgSlug: string;
}

export function ProfitExplorer({ by, today, weekStart, targetMarginBp, sites, clients, jobTypes, orgSlug }: ProfitExplorerProps) {
  const { seesMoney, can } = useShell();
  const url = useQueryState();
  const { get, set } = url;

  const period = useMemo(() => parsePeriod(get, today, weekStart), [get, today, weekStart]);
  const filters = useMemo(() => parseFilters(get), [get]);
  const jobId = UUID.test(get('job') ?? '') ? get('job') : null;
  const serviceId = UUID.test(get('service') ?? '') ? get('service') : null;
  const modes = modesFor(by);
  const rawMode = get('view') as ExplorerMode | null;
  const mode: ExplorerMode = rawMode && (EXPLORER_MODES as readonly string[]).includes(rawMode) && modes.includes(rawMode) ? rawMode : 'table';
  const sort = parseSort(get('sort'), defaultSort(by, seesMoney));
  const colsParam = get('cols');
  const columns = useMemo(() => visibleColumns(colsParam ? colsParam.split(',') : null, seesMoney), [colsParam, seesMoney]);
  const measure: ChartMeasure = (CHART_MEASURES as readonly string[]).includes(get('measure') ?? '') ? (get('measure') as ChartMeasure) : 'profit';
  const order: 'best' | 'worst' = get('order') === 'worst' ? 'worst' : 'best';
  const rawPivot = get('pivot') as ProfitGroup | null;
  const pivotBy: ProfitGroup = rawPivot && (PROFIT_GROUPS as readonly string[]).includes(rawPivot) && rawPivot !== by ? rawPivot : defaultPivotBy(by);
  const pivotMeasure: PivotMeasure = (PIVOT_MEASURES as readonly string[]).includes(get('pm') ?? '') ? (get('pm') as PivotMeasure) : seesMoney ? 'profit' : 'units';
  const entries = (ENTRY_FILTERS as readonly string[]).includes(get('entries') ?? '') ? (get('entries') as EntryFilter) : null;
  const entryDay = /^\d{4}-\d{2}-\d{2}$/.test(get('day') ?? '') ? (get('day') as string) : null;

  const scope: ProfitParams = useMemo(() => ({ from: period.from, to: period.to, siteId: filters.siteId, clientId: filters.clientId, jobTypeId: filters.jobTypeId, status: filters.status, jobId, serviceId }), [period.from, period.to, filters, jobId, serviceId]);
  const main = useProfit(by, { ...scope, trend: true });
  const before = useProfit(by, { ...scope, from: period.compareTo?.from, to: period.compareTo?.to }, { enabled: period.compareTo !== null });
  const wholeCompany = !filters.clientId && !filters.jobTypeId && !filters.status && !jobId && !serviceId;
  const bridge = useCompanyBridge({ from: period.from, to: period.to, siteId: filters.siteId }, { enabled: wholeCompany && seesMoney });
  const pivot = useProfitPivot(by, pivotBy, scope, { enabled: mode === 'pivot' });
  const services = useVasServices({}, { enabled: serviceId !== null });
  const job = useJob(jobId, { enabled: jobId !== null });

  const data = main.data;
  const comparing = period.compareTo !== null;
  const compareLabel = comparing ? COMPARE_MODE_SHORT[period.compare] : '';
  const compared = useMemo(() => compareRows(by, data?.rows ?? [], comparing ? before.data?.rows : null), [by, data, before.data, comparing]);
  const totalCompared = useMemo(() => (comparing && data && before.data ? compareOne(data.total, before.data.total) : null), [comparing, data, before.data]);
  const sortColumn = sort.column;
  const sortDirection = sort.direction;
  const rows = useMemo(() => sortRows(by, data?.rows ?? [], { column: sortColumn, direction: sortDirection }, compared), [by, data, sortColumn, sortDirection, compared]);
  const total = data?.total ?? null;
  const prior = comparing ? comparable(before.data) : null;
  const companyMargin = total && bridge.data ? companyMarginBp(bridge.data.companyProfitCents, total.revenueCents) : null;

  const setPeriod = useCallback(
    (change: PeriodChange) => {
      const next = { preset: (change.preset ?? period.preset) as RangePreset, from: change.from ?? period.from, to: change.to ?? period.to, compare: change.compare ?? period.compare };
      set(periodQuery(next));
    },
    [period, set],
  );
  const drill = useCallback((patch: Readonly<Record<string, string | null>>) => set(patch, { push: true }), [set]);
  const setSort = useCallback((next: SortState) => set({ sort: sortParam(next) === sortParam(defaultSort(by, seesMoney)) ? null : sortParam(next) }), [by, seesMoney, set]);

  /* ---- the drill path: every filter that narrows the page, each one removable ---- */
  const crumbs: { key: string; label: string; clear: Record<string, null> }[] = [];
  const siteName = sites.find((site) => site.id === filters.siteId)?.name;
  const clientName = clients.find((client) => client.id === filters.clientId)?.name;
  const typeName = jobTypes.find((type) => type.id === filters.jobTypeId)?.name;
  const serviceName = services.data?.find((service) => service.id === serviceId)?.name;
  if (filters.siteId) crumbs.push({ key: 'site', label: siteName ?? 'One site', clear: { site: null } });
  if (serviceId) crumbs.push({ key: 'service', label: serviceName ?? 'One extra service', clear: { service: null } });
  if (filters.jobTypeId) crumbs.push({ key: 'jobType', label: typeName ?? 'One job type', clear: { jobType: null } });
  if (filters.clientId) crumbs.push({ key: 'client', label: clientName ?? 'One client', clear: { client: null } });
  if (jobId) crumbs.push({ key: 'job', label: job.data ? `${job.data.number} ${job.data.name}` : 'One job', clear: { job: null } });
  const scopeWords = [crumbs.map((crumb) => crumb.label).join(', '), rangeLabel(period)].filter(Boolean).join(', ');

  /* ---- export exactly what is on screen ---- */
  const exportView = () => {
    if (!data || !total) return;
    const stamp = `${period.from}-to-${period.to}`;
    const nameHeader = VIEW_LABELS[by].replace(/s$/, '');
    if (mode === 'serve') {
      // Cost to serve is a report: its CSV comes from the same build the view shows.
      window.location.assign(apiPath('reports/cost-to-serve.csv', reportQuery({ from: period.from, to: period.to, siteId: filters.siteId, clientId: filters.clientId, jobTypeId: filters.jobTypeId, status: filters.status })));
      return;
    }
    if (mode === 'pivot') {
      if (!pivot.data) return;
      const grid = pivotCsv(pivot.data, pivotMeasure);
      downloadCsv(`${orgSlug}-profit-${by}-by-${pivotBy}-${pivotMeasure}-${stamp}.csv`, grid.headers, grid.rows);
      return;
    }
    if (mode === 'pareto') {
      const view = paretoView(data.rows);
      downloadCsv(
        `${orgSlug}-profit-pareto-${by}-${stamp}.csv`,
        ['Rank', nameHeader, 'Profit', 'Share of profit (%)', 'Running share (%)', 'Share of revenue (%)', 'Margin (%)'],
        view.ranked.map((item) => [item.rank, rowLabel(by, item.item), csvValue(Number(item.profitCents), 'money'), csvValue(item.profitShareBp, 'percent'), csvValue(item.cumulativeProfitShareBp, 'percent'), csvValue(item.revenueShareBp, 'percent'), csvValue(item.marginBp, 'percent')]),
      );
      return;
    }
    if (mode === 'contribution') {
      const line = (name: string, row: typeof total): CsvCell[] => {
        const parts = contribution(row);
        return [name, csvValue(row.revenueCents, 'money'), csvValue(parts?.directCents, 'money'), csvValue(parts?.contributionCents, 'money'), row.costMissing ? NO_COST_YET : csvValue(row.marginBeforeSharedBp, 'percent'), csvValue(row.sharedCents, 'money'), csvValue(row.profitCents, 'money'), row.costMissing ? NO_COST_YET : csvValue(row.marginBp, 'percent')];
      };
      downloadCsv(`${orgSlug}-profit-contribution-${by}-${stamp}.csv`, [nameHeader, 'Revenue', 'Direct costs', 'Contribution', 'Contribution (%)', 'Time not on a job', 'Profit', 'Job margin (%)'], [...rows.map((row) => line(rowLabel(by, row), row)), line('Total', total)]);
      return;
    }
    const withName = by === 'job';
    const headers = [nameHeader, ...(withName ? ['Name'] : []), ...columns.map(csvHeader), ...(comparing ? ['Profit change', 'Margin change (points)'] : [])];
    const line = (name: string, sub: string | null, row: typeof total, change: { profitDelta: number | null; marginDelta: number | null } | null | undefined): CsvCell[] => [name, ...(withName ? [sub ?? ''] : []), ...columns.map((column) => (rowNoCost(row, column.id) ? NO_COST_YET : csvValue(column.get(row), column.kind))), ...(comparing ? [csvValue(change?.profitDelta ?? null, 'money'), csvValue(change?.marginDelta ?? null, 'percent')] : [])];
    downloadCsv(`${orgSlug}-profit-by-${by}-${stamp}.csv`, headers, [...rows.map((row) => line(rowLabel(by, row), row.sublabel, row, compared.get(row.key))), line('Total', null, total, totalCompared)]);
  };

  const filtered = crumbs.length > 0 || filters.status !== null;
  const empty = data !== undefined && data.rows.length === 0;
  const drawerScope: ProfitParams = entryDay ? { ...scope, from: entryDay, to: entryDay } : scope;

  return (
    <div className="flex flex-col gap-4" data-testid="profit-explorer">
      {/* Period, filters, saved views, export */}
      <div className="flex flex-col gap-2 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PeriodPicker period={period} onChange={setPeriod} />
          <div className="flex items-center gap-2">
            <ViewsMenu params={url.params} onApply={(query) => url.replaceAll(query)} />
            <Button variant="secondary" leadingIcon={<Download aria-hidden />} onClick={exportView} disabled={!data || empty || (mode === 'pivot' && !pivot.data)} data-testid="profit-export" title={mode === 'chart' ? 'Exports the numbers behind the chart, as the table shows them.' : undefined}>
              Export CSV
            </Button>
          </div>
        </div>
        <FilterBar values={filters} onChange={(patch) => set({ ...('siteId' in patch ? { site: patch.siteId } : {}), ...('clientId' in patch ? { client: patch.clientId } : {}), ...('jobTypeId' in patch ? { jobType: patch.jobTypeId } : {}), ...('status' in patch ? { status: patch.status } : {}) })} sites={sites} clients={clients} jobTypes={jobTypes} />
      </div>

      {/* The drill path */}
      {crumbs.length > 0 ? (
        <nav aria-label="Where you are" className="flex flex-wrap items-center gap-1.5 text-sm" data-testid="drill-path">
          <button type="button" onClick={() => set({ site: null, client: null, jobType: null, job: null, service: null }, { push: true })} className="rounded-md px-1.5 py-0.5 font-medium text-primary-text hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus" data-testid="drill-root">
            Everything
          </button>
          {crumbs.map((crumb) => (
            <span key={crumb.key} className="inline-flex items-center gap-1.5">
              <ChevronRight aria-hidden className="size-3.5 text-icon" />
              <span className="inline-flex max-w-[260px] items-center gap-1 rounded-md border border-border-subtle bg-panel py-0.5 pr-0.5 pl-2 text-fg">
                <span className="truncate">{crumb.label}</span>
                <button type="button" aria-label={`Remove ${crumb.label} from the filters`} onClick={() => set(crumb.clear, { push: true })} className="inline-flex size-5 items-center justify-center rounded-sm text-icon hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus">
                  <X aria-hidden className="size-3" />
                </button>
              </span>
            </span>
          ))}
          <ChevronRight aria-hidden className="size-3.5 text-icon" />
          <span className="text-fg-secondary">{VIEW_LABELS[by]}</span>
        </nav>
      ) : null}

      {main.isError ? (
        <LoadError what="the profit numbers" message={main.error instanceof Error ? main.error.message : undefined} onRetry={() => void main.refetch()} />
      ) : empty ? (
        <div className="rounded-xl border border-border-subtle bg-panel">
          {filtered || period.preset !== 'this_month' ? (
            <Teach
              testId="profit-empty-filtered"
              icon={SearchX}
              title="Nothing matches these filters"
              why={`No work, revenue or cost is dated ${rangeLabel(period)} for the filters you picked. Try a longer period or clear the filters.`}
              actions={
                <>
                  <Button onClick={() => url.replaceAll({ by: by === 'job' ? null : by, range: 'last_90' })} data-testid="profit-empty-widen">
                    Show the last 90 days
                  </Button>
                  {filtered ? (
                    <Button variant="secondary" onClick={() => set({ site: null, client: null, jobType: null, job: null, service: null, status: null })}>
                      Clear filters
                    </Button>
                  ) : null}
                </>
              }
            />
          ) : (
            <Teach
              icon={CircleDollarSign}
              title={EMPTY_COPY[by].title}
              why={EMPTY_COPY[by].why}
              points={['Revenue, labor, materials, other costs and time not on a job', 'Margin before and after shared costs', 'Click any row to drill down, and totals always match']}
              actions={
                <>
                  {can('job:manage') ? (
                    <ButtonLink href={routes.newJob()} icon={<PackagePlus aria-hidden />}>
                      Add a job
                    </ButtonLink>
                  ) : null}
                  <Button variant="secondary" onClick={() => set({ range: 'last_90' })}>
                    Show the last 90 days
                  </Button>
                  <ButtonLink href={routes.welcome()} variant="secondary" icon={<Rocket aria-hidden />}>
                    Other ways to start
                  </ButtonLink>
                </>
              }
            />
          )}
        </div>
      ) : (
        <>
          {/* Totals for what is on screen */}
          <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-3', comparing ? 'min-[1680px]:grid-cols-6' : 'xl:grid-cols-6')} data-testid="profit-tiles">
            {seesMoney ? (
              <>
                <KpiTile label="Revenue" loading={!total} value={total ? formatMoneyWhole(total.revenueCents) : null} delta={total ? moneyDelta(total.revenueCents, prior?.revenueCents, 'up', compareLabel) : undefined} explain={<ExplainNumber metric="revenue" scope={scope} />} />
                <KpiTile label="Cost" loading={!total} value={total ? formatMoneyWhole(total.costCents) : null} delta={total ? moneyDelta(total.costCents, prior?.costCents, 'down', compareLabel) : undefined} explain={<ExplainNumber metric="cost" scope={scope} />} />
                <KpiTile label="Profit" loading={!total} value={total ? formatMoneyWhole(total.profitCents) : null} delta={total ? moneyDelta(total.profitCents, prior?.profitCents, 'up', compareLabel) : undefined} explain={<ExplainNumber metric="profit" scope={scope} />} />
                <KpiTile label="Job margin" loading={!total} value={total ? formatPercentBp(total.marginBp, { empty: 'No revenue' }) : null} delta={total ? pointsDelta(total.marginBp, prior?.marginBp, 'up', compareLabel) : undefined} explain={<ExplainNumber metric="margin" scope={scope} />} footer={!comparing && total?.marginBp !== null && total ? <span className="text-xs text-fg-muted">Target {formatPercentWhole(targetMarginBp)}</span> : undefined} />
                {/* The company margin only exists for the whole company: a client or a job type has no overhead of its own. */}
                {wholeCompany ? (
                  <div className="contents" data-testid="profit-company-margin">
                    <KpiTile
                      label="Company margin"
                      loading={!total || bridge.isLoading}
                      value={total && bridge.data ? (companyMargin === null ? null : formatPercentBp(companyMargin)) : null}
                      emptyText={bridge.isError ? 'Could not load' : 'No revenue'}
                      explain={<ExplainNumber metric="company_profit" scope={{ from: period.from, to: period.to, siteId: filters.siteId }} label="How we got company profit" />}
                      footer={companyMargin !== null && bridge.data ? <span className="text-xs text-fg-muted" data-testid="profit-company-margin-words">{companyWords(bridge.data).tile}</span> : undefined}
                    />
                  </div>
                ) : null}
              </>
            ) : null}
            <KpiTile label="Units per person per hour" loading={!total} value={total ? formatPace(total.uph, { empty: 'No hours yet' }) : null} delta={total ? numberDelta(total.uph === null ? null : Number(total.uph), prior ? (prior.uph === null ? null : Number(prior.uph)) : undefined, 'up', compareLabel, 1) : undefined} explain={<ExplainNumber metric="uph" scope={scope} />} />
          </div>

          {/* Jobs are not the company: say what the company made */}
          {wholeCompany && seesMoney && bridge.data && total && bridge.data.companyProfitCents !== null ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border-subtle bg-sunken px-4 py-2.5 text-sm text-fg-secondary" data-testid="company-bridge">
              <span>
                Your jobs made <strong className="font-semibold text-fg tabular-nums">{formatMoneyWhole(total.profitCents)}</strong>. {companyWords(bridge.data).lead}, the company made{' '}
                <strong className={cn('font-semibold tabular-nums', bridge.data.companyProfitCents < 0 ? 'text-danger-text' : 'text-fg')}>{formatMoneyWhole(bridge.data.companyProfitCents)}</strong>.
                {companyWords(bridge.data).note ? <span data-testid="company-cost-note"> {companyWords(bridge.data).note}</span> : null}
              </span>
              <ExplainNumber metric="company_profit" scope={{ from: period.from, to: period.to, siteId: filters.siteId }} label="How we got company profit" align="start" />
            </div>
          ) : null}

          <Section
            title={`${VIEW_LABELS[by]}${data ? `, ${data.rows.length}` : ''}`}
            hint={scopeWords}
            testId="profit-section"
            bodyClassName={mode === 'table' ? 'p-0' : 'p-4'}
            action={
              <div className="flex max-w-full flex-wrap items-center gap-2 print:hidden">
                {mode === 'table' ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" leadingIcon={<Columns3 aria-hidden />} className="hidden md:inline-flex" data-testid="columns-menu">
                        Columns
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
                      <DropdownMenuLabel>Columns to show</DropdownMenuLabel>
                      {PROFIT_COLUMNS.filter((column) => seesMoney || !column.money).map((column) => {
                        const on = columns.some((item) => item.id === column.id);
                        return (
                          <DropdownMenuCheckboxItem
                            key={column.id}
                            checked={on}
                            onSelect={(event) => event.preventDefault()}
                            onCheckedChange={(checked) => {
                              const next = PROFIT_COLUMNS.filter((item) => (item.id === column.id ? checked : columns.some((shown) => shown.id === item.id))).map((item) => item.id);
                              if (next.length === 0) return;
                              const defaults = visibleColumns(null, seesMoney).map((item) => item.id);
                              set({ cols: next.join(',') === defaults.join(',') ? null : next.join(',') });
                            }}
                          >
                            {column.label}
                          </DropdownMenuCheckboxItem>
                        );
                      })}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => set({ cols: null })}>Back to the usual columns</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                <ScrollX label="How to show the numbers" tabStop={false} className="max-w-full">
                  <ToggleGroup label="How to show the numbers" size="sm" value={mode} onValueChange={(value) => set({ view: value === 'table' ? null : value })} options={modes.filter((value) => seesMoney || value === 'table' || value === 'chart' || value === 'pivot').map((value) => ({ value, label: MODE_LABELS[value] }))} />
                </ScrollX>
              </div>
            }
          >
            {!data || !total ? (
              <TableSkeleton label="Loading the profit numbers" rows={10} />
            ) : mode === 'table' ? (
              <div className={cn(main.isFetching && 'opacity-70 transition-opacity')}>
                <TableView by={by} rows={rows} total={total} columns={columns} compared={compared} totalCompared={totalCompared} compareLabel={compareLabel} sort={sort} onSort={setSort} onDrill={drill} scope={scope} range={period} seesMoney={seesMoney} />
              </div>
            ) : mode === 'chart' ? (
              <ChartView by={by} rows={data.rows} measure={measure} order={order} onMeasure={(value) => set({ measure: value === 'profit' ? null : value })} onOrder={(value) => set({ order: value === 'best' ? null : value })} targetMarginBp={targetMarginBp} refreshing={main.isFetching} seesMoney={seesMoney} />
            ) : mode === 'contribution' ? (
              <ContributionView by={by} rows={rows} total={total} onDrill={drill} range={period} refreshing={main.isFetching} />
            ) : mode === 'pareto' ? (
              <ParetoView by={by} rows={data.rows} onDrill={drill} range={period} refreshing={main.isFetching} />
            ) : mode === 'pivot' ? (
              <PivotView by={by} colBy={pivotBy} measure={pivotMeasure} onColBy={(value) => set({ pivot: value === defaultPivotBy(by) ? null : value })} onMeasure={(value) => set({ pm: value === 'profit' ? null : value })} scope={scope} seesMoney={seesMoney} />
            ) : (
              <ServeView params={{ from: period.from, to: period.to, siteId: filters.siteId, clientId: filters.clientId, jobTypeId: filters.jobTypeId, status: filters.status }} />
            )}
          </Section>
          {comparing && before.isError ? <p className="text-sm text-danger-text">We could not load the period to compare with. The change columns are blank.</p> : null}
          {data && mode === 'table' ? (
            <p className="text-xs text-fg-muted">
              Click {withArticle(VIEW_NOUN[by])} to go one level down. The total of each level matches the row you clicked. {seesMoney ? `Profit on this page is ${formatMoney(total?.profitCents ?? null)}.` : ''}
            </p>
          ) : null}
        </>
      )}

      <EntriesDrawer
        open={entries !== null}
        onClose={() => set({ entries: null, day: null })}
        filter={entries ?? 'all'}
        onFilter={(value) => set({ entries: value })}
        scope={drawerScope}
        title={[crumbs.map((crumb) => crumb.label).join(', '), rangeLabel({ from: drawerScope.from as string, to: drawerScope.to as string })].filter(Boolean).join(', ')}
        fileName={`${orgSlug}-entries-${drawerScope.from}-to-${drawerScope.to}.csv`}
      />
    </div>
  );
}
