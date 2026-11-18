'use client';
/**
 * Export: every kind of data as a CSV file in the same columns as its import template, so a file
 * you download can be fixed in a spreadsheet and imported back. Dates and filters live in the
 * address bar, so a filtered export can be bookmarked and shared.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarRange, Download, FileArchive, FileSpreadsheet, Upload, X } from 'lucide-react';
import { Button, IsoDatePicker, Select, Skeleton, Switch } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { useQueryState } from '@/features/profit/use-query-state';
import { errorText, fileLinks, importApi, importKeys } from '@/features/imports/api';
import { SavedViewsBar } from '@/features/views/saved-views-bar';
import { JOB_STATUS_LABELS, JOB_STATUS_VALUES } from '@/lib/constants';
import { formatNumber } from '@/lib/format';
import { useClients, useJobTypes, useSites } from '@/lib/hooks/use-data';
import { addMonths, endOfMonth, startOfMonth } from '@/lib/profit/calendar';
import { routes } from '@/lib/routes';
import { STREAMS, STREAM_GROUP_LABELS, type StreamGroup, type StreamId } from '@/lib/streams';

const GROUPS: readonly StreamGroup[] = ['setup', 'daily', 'money'];
const ANY = '__any__';

/** Which filters each kind of file listens to, so the page can say what a filter will do. */
const DATED: ReadonlySet<StreamId> = new Set<StreamId>(['jobs', 'production', 'indirect_time', 'paid_hours', 'time_punches', 'materials', 'costs', 'revenue', 'services_done', 'goals']);

function isoToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const linkClass =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-border-input bg-panel px-3 text-sm font-medium text-fg hover:bg-hover hover:border-border-input-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export function ExportView({ initialCounts, seesMoney, canImport }: { readonly initialCounts: { stream: StreamId; rows: number }[]; readonly seesMoney: boolean; readonly canImport: boolean }) {
  const state = useQueryState();
  const counts = useQuery({ queryKey: importKeys.exportCounts(), queryFn: importApi.exportCounts, initialData: initialCounts, staleTime: 30_000 });
  const clients = useClients({});
  const jobTypes = useJobTypes({});
  const sites = useSites();
  const from = state.get('from');
  const to = state.get('to');
  const client = state.get('client');
  const jobType = state.get('jobType');
  const site = state.get('site');
  const status = state.get('status');
  const noMoney = state.get('money') === '0';
  const filters = { from, to, client, jobType, site, status, money: noMoney ? '0' : null };
  const active = [from, to, client, jobType, site, status].filter(Boolean).length;
  const byStream = useMemo(() => new Map(counts.data.map((row) => [row.stream, row.rows])), [counts.data]);
  // Every workspace starts with the built in General job type, so that one row is not "data" yet.
  const total = counts.data.reduce((sum, row) => sum + (row.stream === 'job_types' ? Math.max(row.rows - 1, 0) : row.rows), 0);
  const today = isoToday();

  const presets: readonly { id: string; label: string; from: string | null; to: string | null }[] = [
    { id: 'all', label: 'All time', from: null, to: null },
    { id: 'month', label: 'This month', from: startOfMonth(today), to: today },
    { id: 'last', label: 'Last month', from: startOfMonth(addMonths(today, -1)), to: endOfMonth(addMonths(today, -1)) },
    { id: 'year', label: 'This year', from: `${today.slice(0, 4)}-01-01`, to: today },
  ];
  const badRange = Boolean(from && to && to < from);

  if (counts.isError) {
    return (
      <Panel>
        <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
          <p className="text-sm text-fg-secondary">We could not load your data. {errorText(counts.error)}</p>
          <Button variant="secondary" onClick={() => void counts.refetch()}>
            Try again
          </Button>
        </div>
      </Panel>
    );
  }

  if (total === 0) {
    return (
      <Panel>
        <Teach
          testId="export-empty"
          icon={Download}
          title="Nothing to export yet"
          why={`Your data is always yours. Once there are rows in Pulse, each of the ${STREAMS.length} kinds of data downloads as a CSV file with one click, in the same columns as its import template, so a file you export can be fixed and brought back in.`}
          points={['Pick a date range and filters, or take everything in one zip file', 'Files open cleanly in Excel and Google Sheets', seesMoney ? 'Money columns are included for you' : 'Money columns are left out for your role']}
          actions={
            canImport ? (
              <>
                <ButtonLink href={routes.importCenter()} icon={<Upload aria-hidden />}>
                  Import your first file
                </ButtonLink>
                <ButtonLink href={routes.welcome()} variant="secondary">
                  Try it with sample data
                </ButtonLink>
              </>
            ) : (
              <ButtonLink href={routes.jobs()}>Open jobs</ButtonLink>
            )
          }
        />
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <SavedViewsBar page="export" label="Saved exports" />
      <Panel title="What to export">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Date range">
            <CalendarRange aria-hidden className="size-4 text-icon" />
            {presets.map((preset) => {
              const on = (from ?? null) === preset.from && (to ?? null) === preset.to;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={on}
                  data-testid={`range-${preset.id}`}
                  onClick={() => state.set({ from: preset.from, to: preset.to })}
                  className={cn(
                    'inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    on ? 'border-primary bg-primary-subtle text-primary-text' : 'border-border-subtle bg-panel text-fg-secondary hover:bg-hover hover:text-fg',
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <label className="flex flex-col gap-1 text-xs font-medium text-fg-secondary">
              From
              <IsoDatePicker value={from} onChange={(value) => state.set({ from: value })} aria-label="From date" clearable placeholder="The start" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-fg-secondary">
              To
              <IsoDatePicker value={to} onChange={(value) => state.set({ to: value })} aria-label="To date" clearable placeholder="Today" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-fg-secondary">
              Client
              <Select aria-label="Client" value={client ?? ANY} onValueChange={(value) => state.set({ client: value === ANY ? null : value })} options={[{ value: ANY, label: 'Every client' }, ...(clients.data ?? []).map((row) => ({ value: row.id, label: row.name }))]} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-fg-secondary">
              Job type
              <Select aria-label="Job type" value={jobType ?? ANY} onValueChange={(value) => state.set({ jobType: value === ANY ? null : value })} options={[{ value: ANY, label: 'Every job type' }, ...(jobTypes.data ?? []).map((row) => ({ value: row.id, label: row.name }))]} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-fg-secondary">
              Site
              <Select aria-label="Site" value={site ?? ANY} onValueChange={(value) => state.set({ site: value === ANY ? null : value })} options={[{ value: ANY, label: 'Every site' }, ...(sites.data ?? []).map((row) => ({ value: row.id, label: row.name }))]} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-fg-secondary">
              Job status
              <Select aria-label="Job status" value={status ?? ANY} onValueChange={(value) => state.set({ status: value === ANY ? null : value })} options={[{ value: ANY, label: 'Every status' }, ...JOB_STATUS_VALUES.map((value) => ({ value, label: JOB_STATUS_LABELS[value] }))]} />
            </label>
          </div>
          {badRange ? (
            <p role="alert" className="text-sm text-danger-text" data-testid="export-range-error">
              The end date is before the start date. Pick a later end date.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-3">
            <div className="flex flex-wrap items-center gap-4">
              {seesMoney ? (
                <div className="max-w-sm">
                  <Switch size="sm" checked={noMoney} onCheckedChange={(checked) => state.set({ money: checked ? '0' : null })} label="Leave money out" description="Prices, costs and wages are dropped from every file." data-testid="export-no-money" />
                </div>
              ) : (
                <p className="text-sm text-fg-muted">Money columns are left out for your role.</p>
              )}
              {active > 0 ? (
                <Button variant="ghost" size="sm" leadingIcon={<X aria-hidden className="size-3.5" />} onClick={() => state.replaceAll(noMoney ? { money: '0' } : {})} data-testid="export-clear">
                  Clear {active} {active === 1 ? 'filter' : 'filters'}
                </Button>
              ) : null}
            </div>
            <a href={badRange ? undefined : fileLinks.exportEverything(filters)} aria-disabled={badRange} download data-testid="export-everything" className={cn(linkClass, 'h-9 border-transparent bg-primary px-4 text-primary-fg hover:border-transparent hover:bg-primary-hover', badRange && 'pointer-events-none opacity-50')}>
              <FileArchive aria-hidden className="size-4" />
              Download everything (zip)
            </a>
          </div>
        </div>
      </Panel>

      {GROUPS.map((group) => (
        <section key={group} aria-labelledby={`export-${group}`}>
          <h2 id={`export-${group}`} className="mb-2 text-2xs font-semibold tracking-[0.06em] text-fg-muted uppercase">
            {STREAM_GROUP_LABELS[group]}
          </h2>
          <ul className="overflow-hidden rounded-xl border border-border-subtle bg-panel shadow-xs">
            {STREAMS.filter((stream) => stream.group === group).map((stream) => {
              const rows = byStream.get(stream.id) ?? 0;
              const hidden = stream.id === 'labor_rates' && (!seesMoney || noMoney);
              return (
                <li key={stream.id} data-testid={`export-${stream.id}`} className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-3 last:border-0">
                  <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-icon-strong">
                    <FileSpreadsheet className="size-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1 basis-56">
                    <h3 className="text-sm font-semibold text-fg">{stream.name}</h3>
                    <p className="text-sm text-fg-muted">
                      {counts.isLoading ? <Skeleton width={120} height={14} /> : `${formatNumber(rows, { maxDigits: 0 })} ${rows === 1 ? 'row' : 'rows'} in Pulse.`} {active > 0 ? (DATED.has(stream.id) || client || jobType || site || status ? 'Your filters apply where this file has that column.' : '') : ''}
                    </p>
                  </div>
                  {hidden ? (
                    <p className="text-sm text-fg-muted">{seesMoney ? 'Left out: this file is all money.' : 'Labor rates are money, so your role cannot export them.'}</p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      {stream.id === 'job_plans' ? (
                        <a href={fileLinks.exportStream(stream.id, { ...filters, layout: 'lines' })} download className={cn(linkClass, 'border-transparent bg-transparent text-fg-secondary')} data-testid="export-job_plans-lines">
                          Line by line
                        </a>
                      ) : null}
                      <a href={badRange ? undefined : fileLinks.exportStream(stream.id, filters)} aria-disabled={badRange} download aria-label={`Download ${stream.name} as CSV`} data-testid={`export-link-${stream.id}`} className={cn(linkClass, badRange && 'pointer-events-none opacity-50')}>
                        <Download aria-hidden className="size-4" />
                        CSV
                      </a>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <p className="text-sm text-fg-muted">
        Every file has the same columns as its import template and carries an entry id, so importing a file you exported changes nothing. Text that looks like a spreadsheet formula is made safe, and every export is written to the audit log.
      </p>
    </div>
  );
}
