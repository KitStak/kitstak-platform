'use client';
/**
 * One report: filters in the URL, the summary, a chart, the table, a print view, a CSV download
 * and "Build on a schedule". The page, the CSV and the print view all read the same built report
 * with the same filters, so the three can never disagree.
 */
import { useCallback, useMemo, useState } from 'react';
import { CalendarClock, Download, FileText, ListTree, Printer } from 'lucide-react';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { apiPath } from '@/lib/api-client';
import { formatMoneyWhole, formatNumber } from '@/lib/format';
import { reportQuery, useReport } from '@/lib/hooks/use-data';
import { rangeLabel } from '@/lib/reports';
import { routes } from '@/lib/routes';
import type { ClientDTO, JobTypeDTO, SiteDTO } from '@/lib/types';
import { EntriesDrawer } from '@/features/profit/entries-drawer';
import { FilterBar, parseFilters } from '@/features/profit/filter-bar';
import type { EntryFilter } from '@/features/profit/profit-model';
import { parsePeriod, periodQuery } from '@/features/profit/period';
import { PeriodPicker, type PeriodChange } from '@/features/profit/period-picker';
import { LoadError, Section, TableSkeleton } from '@/features/profit/profit-ui';
import { useQueryState } from '@/features/profit/use-query-state';
import { SavedViewsBar } from '@/features/views/saved-views-bar';
import { ReportChart } from './report-chart';
import { reportCellText } from './report-format';
import { ReportTable } from './report-table';
import { ScheduleDialog } from './schedule-dialog';

export function ReportView({ slug, name, today, weekStart, sites, clients, jobTypes }: { readonly slug: string; readonly name: string; readonly today: string; readonly weekStart: number; readonly sites: readonly SiteDTO[]; readonly clients: readonly ClientDTO[]; readonly jobTypes: readonly JobTypeDTO[] }) {
  const { get, set, replaceAll } = useQueryState();
  const period = useMemo(() => parsePeriod(get, today, weekStart), [get, today, weekStart]);
  const filters = useMemo(() => parseFilters(get), [get]);
  const params = useMemo(() => ({ from: period.from, to: period.to, siteId: filters.siteId, clientId: filters.clientId, jobTypeId: filters.jobTypeId, status: filters.status }), [period.from, period.to, filters]);
  const query = useReport(slug, params);
  const report = query.data;
  const [scheduling, setScheduling] = useState(false);
  // The entries behind the report's aside (rows put on a client with no job), and which kinds to show.
  const [asideEntries, setAsideEntries] = useState<EntryFilter | null>(null);
  const asideScope = useMemo(() => ({ from: period.from, to: period.to, siteId: filters.siteId, clientId: filters.clientId, noJob: true }), [period.from, period.to, filters.siteId, filters.clientId]);

  const setPeriod = useCallback((change: PeriodChange) => set(periodQuery({ preset: change.preset ?? period.preset, from: change.from ?? period.from, to: change.to ?? period.to, compare: 'none' })), [period, set]);
  const fileQuery = reportQuery(params);
  const csvHref = apiPath(`reports/${slug}.csv`, fileQuery);
  const printHref = apiPath(`reports/${slug}.html`, { ...fileQuery, print: 1 });
  const filtered = Boolean(filters.siteId || filters.clientId || filters.jobTypeId || filters.status);
  const empty = report !== undefined && report.rows.length === 0;

  return (
    <div className="flex flex-col gap-4" data-testid="report-view">
      <div className="flex flex-col gap-2 print:hidden">
        <SavedViewsBar page="reports" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PeriodPicker period={period} onChange={setPeriod} showCompare={false} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" leadingIcon={<CalendarClock aria-hidden />} onClick={() => setScheduling(true)} data-testid="report-schedule">
              Build on a schedule
            </Button>
            <a href={printHref} target="_blank" rel="noreferrer" data-testid="report-print" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-input bg-panel px-3 text-sm font-medium text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              <Printer aria-hidden className="size-4" />
              Print
            </a>
            <a href={csvHref} download data-testid="report-csv" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              <Download aria-hidden className="size-4" />
              Download CSV
            </a>
          </div>
        </div>
        <FilterBar values={filters} onChange={(patch) => set({ ...('siteId' in patch ? { site: patch.siteId } : {}), ...('clientId' in patch ? { client: patch.clientId } : {}), ...('jobTypeId' in patch ? { jobType: patch.jobTypeId } : {}), ...('status' in patch ? { status: patch.status } : {}) })} sites={sites} clients={clients} jobTypes={jobTypes} />
      </div>

      {query.isError && !report ? (
        <LoadError what="this report" message={query.error instanceof Error ? query.error.message : undefined} onRetry={() => void query.refetch()} />
      ) : !report ? (
        <div className="rounded-xl border border-border-subtle bg-panel">
          <TableSkeleton label={`Building ${name}`} rows={10} />
        </div>
      ) : (
        <div className={cn('flex flex-col gap-4', query.isFetching && 'opacity-70 transition-opacity')}>
          <p className="text-sm text-fg-secondary" data-testid="report-scope">
            {report.filtersLabel}
          </p>
          {report.summary.length > 0 ? (
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="report-summary">
              {report.summary.map((item) => (
                <div key={item.label} className="rounded-lg border border-border-subtle bg-panel p-4">
                  <dt className="text-xs font-medium text-fg-secondary">{item.label}</dt>
                  <dd className={cn('mt-1.5 truncate text-xl font-semibold tracking-tight tabular-nums', item.value === null ? 'text-fg-muted' : typeof item.value === 'number' && item.value < 0 && item.kind === 'money' ? 'text-danger-text' : 'text-fg')}>{item.kind === 'money' && typeof item.value === 'number' && Math.abs(item.value) >= 100000 ? formatMoneyWhole(item.value) : reportCellText(item.value, item.kind, report.moneyHidden ? 'Hidden' : 'None')}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {report.notes.length > 0 || report.truncated ? (
            <ul className="flex flex-col gap-1 text-sm text-fg-secondary" data-testid="report-notes">
              {/* The aside is said in full under the chart, so its note is only for the print view and the file. */}
              {report.notes
                .filter((note) => !(report.aside && note.startsWith(report.aside.label)))
                .map((note) => (
                  <li key={note}>{note}</li>
                ))}
              {report.truncated ? <li>This report is long. Only the first 5,000 rows are shown. Narrow the dates to see the rest.</li> : null}
            </ul>
          ) : null}
          {empty ? (
            <div className="rounded-xl border border-border-subtle bg-panel">
              <Teach
                testId="report-empty"
                icon={FileText}
                title="Nothing to report for these filters"
                why={report.usesDates ? `No rows match ${rangeLabel(period)}${filtered ? ' with the filters you picked' : ''}. Try a longer period${filtered ? ' or clear the filters' : ''}.` : 'Nothing matches right now. That is good news for this report.'}
                actions={
                  <>
                    {report.usesDates ? (
                      <Button onClick={() => replaceAll({ range: 'last_90' })} data-testid="report-widen">
                        Show the last 90 days
                      </Button>
                    ) : null}
                    {filtered ? (
                      <Button variant="secondary" onClick={() => set({ site: null, client: null, jobType: null, status: null })}>
                        Clear filters
                      </Button>
                    ) : null}
                    <ButtonLink href={routes.reports()} variant="secondary">
                      All reports
                    </ButtonLink>
                  </>
                }
              />
            </div>
          ) : (
            <>
              {report.chart ? (
                <Section title={report.chart.title} hint={report.chart.description} testId="report-chart">
                  <ReportChart chart={report.chart} refreshing={query.isFetching} />
                </Section>
              ) : null}
              {report.aside ? (
                <aside aria-label={report.aside.label} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-border-subtle bg-panel px-4 py-3 shadow-xs" data-testid="report-aside">
                  <div className="min-w-0 max-w-3xl">
                    <p className="text-sm text-fg">
                      <span className="font-medium">{report.aside.label}:</span>{' '}
                      <strong className={cn('font-semibold tabular-nums', (report.aside.valueCents ?? 0) < 0 ? 'text-danger-text' : 'text-fg')} data-testid="report-aside-value">
                        {report.aside.valueCents === null ? 'Hidden' : formatMoneyWhole(report.aside.valueCents)}
                      </strong>
                    </p>
                    <p className="mt-0.5 text-sm text-fg-secondary">{report.aside.text}</p>
                  </div>
                  <Button variant="secondary" size="sm" leadingIcon={<ListTree aria-hidden />} onClick={() => setAsideEntries('all')} data-testid="report-aside-drill">
                    See the {formatNumber(report.aside.entryCount)} {report.aside.entryCount === 1 ? 'entry' : 'entries'} behind this
                  </Button>
                </aside>
              ) : null}
              <Section title={`${report.rows.length} ${report.rows.length === 1 ? 'row' : 'rows'}`} hint="Click a column name to sort. The download keeps the order the report was built in." bodyClassName="p-0" testId="report-rows">
                <ReportTable report={report} />
              </Section>
            </>
          )}
        </div>
      )}
      {report?.aside ? (
        <EntriesDrawer
          open={asideEntries !== null}
          onClose={() => setAsideEntries(null)}
          filter={asideEntries ?? 'all'}
          onFilter={setAsideEntries}
          scope={asideScope}
          title={[report.aside.label, rangeLabel(period)].join(', ')}
          fileName={`${slug}-not-on-a-job-${period.from}-to-${period.to}.csv`}
        />
      ) : null}
      <ScheduleDialog open={scheduling} onOpenChange={setScheduling} reportSlug={slug} filters={{ siteId: filters.siteId, clientId: filters.clientId, jobTypeId: filters.jobTypeId, words: report?.filtersLabel.split(', ').slice(1).join(', ') }} />
    </div>
  );
}
