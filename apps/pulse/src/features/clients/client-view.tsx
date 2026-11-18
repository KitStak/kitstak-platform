'use client';
/**
 * One client's profit page: the headline numbers for a period against the period before, the
 * trend, what it costs to serve the client, its jobs and extra services, the target margin and
 * the last changes. Every number reads the profit rollups filtered to this client, so the totals
 * here match the client's row on the Profit page.
 */
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Pencil, X } from 'lucide-react';
import { ComboChart } from '@/components/charts/cartesian';
import { DonutChart } from '@/components/charts/radial';
import { KpiTile, MarginPill, marginHealth } from '@/components/charts/stats';
import { ExplainNumber } from '@/components/pulse/explain';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { cn } from '@/components/ui/cn';
import { formatRelative } from '@/lib/dates';
import { formatHours, formatMoney, formatMoneyWhole, formatNumber, formatPercentBp, formatPercentWhole } from '@/lib/format';
import { useServerAction } from '@/lib/hooks/use-action';
import { centsToNumber, subCents } from '@/lib/money';
import { useActivity, useClient, useProfit, useReport } from '@/lib/hooks/use-data';
import { suggestBucket } from '@/lib/profit/trends';
import { compareRange, rangeLabel } from '@/lib/reports';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { ClientDTO, ProfitRowDTO } from '@/lib/types';
import { updateClientAction } from '@/server/actions/catalog';
import { parsePeriod, periodQuery } from '@/features/profit/period';
import { PeriodPicker, type PeriodChange } from '@/features/profit/period-picker';
import { LoadError, Section, TableSkeleton, comparable, moneyDelta, pointsDelta } from '@/features/profit/profit-ui';
import { useQueryState } from '@/features/profit/use-query-state';

const DEFAULTS = { preset: 'last_90' } as const;
const PARTS_WORDS: Readonly<Record<string, string>> = { us: 'We buy the parts', client: 'The client supplies the parts' };

function TargetMargin({ client, fallbackBp, canManage }: { readonly client: ClientDTO; readonly fallbackBp: number; readonly canManage: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const update = useServerAction(updateClientAction, { errorTitle: "Couldn't save the target margin" });
  const apply = async (targetMarginBp: number | null, version: number): Promise<ClientDTO | undefined> => {
    const saved = await update.run({ clientId: client.id, patch: { targetMarginBp }, version });
    if (saved) {
      queryClient.setQueryData(qk.client(client.id), saved);
      void queryClient.invalidateQueries({ queryKey: ['clients', 'list'] });
    }
    return saved;
  };
  const save = async () => {
    const trimmed = text.trim().replace(/%$/, '');
    const value = trimmed === '' ? null : Number(trimmed);
    if (value !== null && (!Number.isFinite(value) || value < 0 || value >= 100)) {
      setError('Type a percent from 0 to 99, or leave it blank to use the workspace target.');
      return;
    }
    setError(null);
    const before = client.targetMarginBp;
    const next = value === null ? null : Math.round(value * 100);
    if (next === before) {
      setEditing(false);
      return;
    }
    const saved = await apply(next, client.version);
    if (!saved) return;
    setEditing(false);
    toast.undo(next === null ? 'Target margin cleared' : `Target margin set to ${formatPercentBp(next)}`, {
      onUndo: async () => {
        const undone = await apply(before, saved.version);
        if (!undone) throw new Error('The target margin could not be put back.');
      },
    });
  };
  const shown = client.targetMarginBp ?? fallbackBp;
  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-fg tabular-nums" data-testid="client-target">
          {formatPercentBp(shown)}
        </span>
        {client.targetMarginBp === null ? <span className="text-xs text-fg-muted">the workspace target</span> : null}
        {canManage ? (
          <IconButton
            label="Change the target margin"
            icon={<Pencil aria-hidden />}
            size="xs"
            onClick={() => {
              setText(client.targetMarginBp === null ? '' : String(client.targetMarginBp / 100));
              setError(null);
              setEditing(true);
            }}
            data-testid="client-target-edit"
          />
        ) : null}
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="flex items-center gap-1.5">
        <Input aria-label="Target margin in percent" value={text} onChange={(event) => setText(event.target.value)} inputMode="decimal" placeholder={String(fallbackBp / 100)} invalid={error !== null} autoFocus containerClassName="w-24" trailing={<span className="text-sm text-fg-muted">%</span>} data-testid="client-target-input" />
        <IconButton type="submit" label="Save the target margin" icon={<Check aria-hidden />} size="sm" loading={update.pending} data-testid="client-target-save" />
        <IconButton type="button" label="Cancel" icon={<X aria-hidden />} size="sm" onClick={() => setEditing(false)} />
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger-text">
          {error}
        </p>
      ) : (
        <p className="text-xs text-fg-muted">Leave it blank to use the workspace target.</p>
      )}
    </form>
  );
}

export function ClientView({ client: initialClient, today, weekStart, defaultTargetMarginBp, canManage }: { readonly client: ClientDTO; readonly today: string; readonly weekStart: number; readonly defaultTargetMarginBp: number; readonly canManage: boolean }) {
  const { get, set } = useQueryState();
  const client = useClient(initialClient.id, { initialData: initialClient }).data ?? initialClient;
  const period = useMemo(() => parsePeriod(get, today, weekStart, DEFAULTS), [get, today, weekStart]);
  const prior = useMemo(() => compareRange('prior', period) as { from: string; to: string }, [period]);
  const bucket = suggestBucket(period);
  const scope = { from: period.from, to: period.to, clientId: client.id };
  const targetBp = client.targetMarginBp ?? defaultTargetMarginBp;

  const trend = useProfit(bucket, scope);
  const before = useProfit('month', { ...prior, clientId: client.id });
  const jobs = useProfit('job', { ...scope, trend: true });
  const services = useProfit('service', scope);
  const serve = useReport('cost-to-serve', scope);
  const activity = useActivity({ clientId: client.id, limit: 8 });

  const setPeriod = useCallback((change: PeriodChange) => set(periodQuery({ preset: change.preset ?? period.preset, from: change.from ?? period.from, to: change.to ?? period.to, compare: 'none' }, DEFAULTS)), [period, set]);

  const total = trend.data?.total ?? null;
  const previous = comparable(before.data);
  const points = useMemo(() => [...(trend.data?.rows ?? [])].sort((a, b) => a.key.localeCompare(b.key)), [trend.data]);
  const serveRow = serve.data?.rows[0]?.cells ?? null;
  const cell = (key: string): number | null => (serveRow && typeof serveRow[key] === 'number' ? (serveRow[key] as number) : null);
  const vs = 'vs before';
  const jobRows = useMemo(() => [...(jobs.data?.rows ?? [])].sort((a, b) => (b.revenueCents ?? 0) - (a.revenueCents ?? 0)), [jobs.data]);
  const serviceRows = useMemo(() => (services.data?.rows ?? []).filter((row) => row.key !== 'none').sort((a, b) => (b.revenueCents ?? 0) - (a.revenueCents ?? 0)), [services.data]);
  const noActivity = trend.data !== undefined && trend.data.rows.length === 0;
  const notBilled = total && total.revenueCents !== null && total.billedCents !== null;

  if (trend.isError && !trend.data) return <LoadError what="this client’s numbers" message={trend.error instanceof Error ? trend.error.message : undefined} onRetry={() => void trend.refetch()} />;

  return (
    <div className="flex flex-col gap-4" data-testid="client-view">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <PeriodPicker period={period} onChange={setPeriod} showCompare={false} />
        <Link href={`${routes.profit({ by: 'job', client: client.id, from: period.from, to: period.to })}`} className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" data-testid="client-open-profit">
          Open in the Profit explorer
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </div>

      {noActivity ? (
        <div className="rounded-lg border border-dashed border-border-default bg-panel px-4 py-3 text-sm text-fg-secondary" data-testid="client-empty-period">
          No work, revenue or cost for {client.name} is dated {rangeLabel(period)}. Pick a longer period, or{' '}
          <Link href={routes.newJob({ client: client.id })} className="rounded-sm font-medium text-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            start a job for this client
          </Link>
          .
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6" data-testid="client-tiles">
        <KpiTile label="Revenue" loading={!total} value={total ? formatMoneyWhole(total.revenueCents) : null} delta={total ? moneyDelta(total.revenueCents, previous?.revenueCents, 'up', vs) : undefined} sparkline={points.length > 1 ? { values: points.map((row) => row.revenueCents) } : undefined} explain={<ExplainNumber metric="revenue" scope={scope} />} />
        <KpiTile label="Cost to serve" loading={!total} value={total ? formatMoneyWhole(total.costCents) : null} delta={total ? moneyDelta(total.costCents, previous?.costCents, 'down', vs) : undefined} sparkline={points.length > 1 ? { values: points.map((row) => row.costCents) } : undefined} explain={<ExplainNumber metric="cost" scope={scope} />} />
        <KpiTile label="Profit" loading={!total} value={total ? formatMoneyWhole(total.profitCents) : null} delta={total ? moneyDelta(total.profitCents, previous?.profitCents, 'up', vs) : undefined} sparkline={points.length > 1 ? { values: points.map((row) => row.profitCents), tone: (total?.profitCents ?? 0) < 0 ? 'bad' : 'accent' } : undefined} explain={<ExplainNumber metric="profit" scope={scope} />} />
        <KpiTile
          label="Margin after all costs"
          loading={!total}
          value={total ? formatPercentBp(total.marginBp, { empty: 'No revenue yet' }) : null}
          delta={total ? pointsDelta(total.marginBp, previous?.marginBp, 'up', vs) : undefined}
          explain={<ExplainNumber metric="margin" scope={scope} />}
          footer={total && total.marginBp !== null ? <MarginPill health={marginHealth(total.marginBp, targetBp)} size="sm" /> : undefined}
        />
        <KpiTile label="Labor as % of revenue" loading={!total} value={total ? formatPercentBp(total.laborPctBp, { empty: 'No revenue yet' }) : null} delta={total ? pointsDelta(total.laborPctBp, previous?.laborPctBp, 'down', vs) : undefined} explain={<ExplainNumber metric="labor_pct" scope={scope} />} />
        <KpiTile label="Not billed yet" loading={!total} value={notBilled ? formatMoneyWhole(notBilledCents(total)) : null} emptyText="Nothing earned yet" explain={<ExplainNumber metric="not_billed" scope={scope} />} footer={total ? <span className="text-xs text-fg-muted tabular-nums">{formatMoneyWhole(total.billedCents)} billed in this period</span> : undefined} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Section title="Trend" hint={`${rangeLabel(period)}, by ${bucket}`} testId="client-trend">
          <ComboChart
            title={`Revenue, cost and margin for ${client.name}`}
            description="Bars show revenue and cost. The line on top is the margin after all costs, next to this client’s target margin."
            loading={!trend.data}
            refreshing={trend.isFetching && Boolean(trend.data)}
            dates={points.map((row) => row.key)}
            bucket={bucket}
            bars={[
              { id: 'revenue', label: 'Revenue', values: points.map((row) => row.revenueCents) },
              { id: 'cost', label: 'Cost', values: points.map((row) => row.costCents) },
            ]}
            lines={[{ id: 'margin', label: 'Margin after all costs', values: points.map((row) => row.marginBp) }]}
            barFormat="money"
            lineFormat="percent"
            lineTarget={{ value: targetBp, label: 'Target margin' }}
            height={300}
            tableToggle
            emptyTitle="No work in this period"
            emptyHint="Pick a longer period to see the trend."
          />
        </Section>

        <Section title="Cost to serve" hint="Every cost of this client’s jobs, plus costs put on the client." testId="client-serve">
          {serve.isError ? (
            <LoadError what="cost to serve" onRetry={() => void serve.refetch()} compact />
          ) : (
            <div className="flex flex-col gap-4">
              <DonutChart
                title="Where the cost to serve comes from"
                description="Each slice is one kind of cost."
                loading={!serve.data}
                slices={[
                  { id: 'labor', label: 'Labor', value: cell('labor') ?? 0 },
                  { id: 'material', label: 'Material', value: cell('material') ?? 0 },
                  { id: 'other', label: 'Other job costs', value: cell('other') ?? 0 },
                  { id: 'shared', label: 'Time not on a job', value: cell('shared') ?? 0 },
                  { id: 'client', label: 'Costs on the client', value: cell('client_cost') ?? 0 },
                ].filter((slice) => slice.value > 0)}
                format="money"
                centerLabel="cost to serve"
                size={148}
                emptyTitle="No costs in this period"
                emptyHint="Costs show up as work is logged."
              />
              {serveRow ? (
                <dl className="grid grid-cols-3 gap-3 border-t border-border-subtle pt-3 text-sm tabular-nums" data-testid="client-serve-numbers">
                  <div>
                    <dt className="text-xs text-fg-muted">Per unit</dt>
                    <dd className="font-semibold text-fg">{formatMoney(cell('per_unit'), { empty: 'No units' })}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-fg-muted">Per job</dt>
                    <dd className="font-semibold text-fg">{formatMoney(cell('per_job'), { empty: 'No jobs', cents: false })}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-fg-muted">Share of revenue</dt>
                    <dd className="font-semibold text-fg">{formatPercentBp(cell('pct'), { empty: 'No revenue' })}</dd>
                  </div>
                </dl>
              ) : null}
            </div>
          )}
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Section title={`Jobs${jobs.data ? `, ${jobRows.length}` : ''}`} hint={rangeLabel(period)} bodyClassName="p-0" testId="client-jobs">
          {jobs.isError ? (
            <div className="p-4">
              <LoadError what="the jobs" onRetry={() => void jobs.refetch()} compact />
            </div>
          ) : !jobs.data ? (
            <TableSkeleton label="Loading the jobs" rows={5} />
          ) : jobRows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-fg-secondary">No job of this client has work in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[640px]">
                <TableHead>
                  <tr>
                    <TableHeaderCell>Job</TableHeaderCell>
                    <TableHeaderCell numeric>Revenue</TableHeaderCell>
                    <TableHeaderCell numeric>Cost</TableHeaderCell>
                    <TableHeaderCell numeric>Profit</TableHeaderCell>
                    <TableHeaderCell numeric>Margin</TableHeaderCell>
                    <TableHeaderCell numeric>Units</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {jobRows.map((row: ProfitRowDTO) => (
                    <TableRow key={row.key}>
                      <TableCell className="max-w-[320px]">
                        {row.key === 'none' ? (
                          <span className="font-medium text-fg-secondary">Put on the client, no job</span>
                        ) : (
                          <Link href={routes.job(row.label)} className="rounded-sm font-medium text-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" data-testid="client-job-link">
                            {row.label}
                          </Link>
                        )}
                        <span className="flex items-center gap-2">
                          {row.sublabel ? <span className="truncate text-xs text-fg-muted">{row.sublabel}</span> : null}
                          {row.riskStatus ? <MarginPill status={row.riskStatus} size="sm" /> : null}
                        </span>
                      </TableCell>
                      <TableCell numeric>{formatMoney(row.revenueCents)}</TableCell>
                      <TableCell numeric>{formatMoney(row.costCents)}</TableCell>
                      <TableCell numeric className={cn((row.profitCents ?? 0) < 0 && 'text-danger-text')}>
                        {formatMoney(row.profitCents)}
                      </TableCell>
                      <TableCell numeric className={cn((row.marginBp ?? 0) < 0 && 'text-danger-text')}>
                        {formatPercentBp(row.marginBp)}
                      </TableCell>
                      <TableCell numeric>{formatNumber(row.unitsGood, { maxDigits: 0 })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {jobs.data ? (
                  <tfoot>
                    <tr className="h-10 border-t-2 border-border-strong bg-sunken font-semibold" data-testid="client-jobs-total">
                      <TableCell>Total</TableCell>
                      <TableCell numeric>{formatMoney(jobs.data.total.revenueCents)}</TableCell>
                      <TableCell numeric>{formatMoney(jobs.data.total.costCents)}</TableCell>
                      <TableCell numeric>{formatMoney(jobs.data.total.profitCents)}</TableCell>
                      <TableCell numeric>{formatPercentBp(jobs.data.total.marginBp)}</TableCell>
                      <TableCell numeric>{formatNumber(jobs.data.total.unitsGood, { maxDigits: 0 })}</TableCell>
                    </tr>
                  </tfoot>
                ) : null}
              </Table>
            </div>
          )}
        </Section>

        <div className="flex min-w-0 flex-col gap-4">
          <Section title="Extra services" hint="What this client buys on top of the jobs." bodyClassName="p-0" testId="client-services">
            {services.isError ? (
              <div className="p-4">
                <LoadError what="the extra services" onRetry={() => void services.refetch()} compact />
              </div>
            ) : !services.data ? (
              <TableSkeleton label="Loading the extra services" rows={3} />
            ) : serviceRows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-fg-secondary">
                No extra services for this client in this period. Labeling, rework and special packing show here once they are logged.{' '}
                <Link href={routes.services()} className="rounded-sm font-medium text-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                  See the service list
                </Link>
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <tr>
                      <TableHeaderCell>Service</TableHeaderCell>
                      <TableHeaderCell numeric>Units</TableHeaderCell>
                      <TableHeaderCell numeric>Revenue</TableHeaderCell>
                      <TableHeaderCell numeric>Margin</TableHeaderCell>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {serviceRows.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell className="max-w-[200px] truncate">
                          <Link href={routes.service(row.key)} className="rounded-sm font-medium text-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                            {row.label}
                          </Link>
                        </TableCell>
                        <TableCell numeric>{formatNumber(row.unitsGood, { maxDigits: 0 })}</TableCell>
                        <TableCell numeric>{formatMoney(row.revenueCents)}</TableCell>
                        <TableCell numeric className={cn((row.marginBp ?? 0) < 0 && 'text-danger-text')}>
                          {formatPercentBp(row.marginBp)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>

          <Section title="About this client" testId="client-about">
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <dt className="text-fg-secondary">Target margin</dt>
                <dd>
                  <TargetMargin client={client} fallbackBp={defaultTargetMarginBp} canManage={canManage} />
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-fg-secondary">Who buys the parts</dt>
                <dd className="text-right text-fg">{client.partsOwner ? PARTS_WORDS[client.partsOwner] : 'The workspace rule'}</dd>
              </div>
              {client.paymentTermsDays !== null ? (
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-fg-secondary">Payment terms</dt>
                  <dd className="text-fg">{client.paymentTermsDays} days</dd>
                </div>
              ) : null}
              {client.contactName || client.contactEmail || client.phone ? (
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-fg-secondary">Contact</dt>
                  <dd className="min-w-0 text-right text-fg">
                    {client.contactName ? <span className="block">{client.contactName}</span> : null}
                    {client.contactEmail ? (
                      <a href={`mailto:${client.contactEmail}`} className="block truncate rounded-sm text-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                        {client.contactEmail}
                      </a>
                    ) : null}
                    {client.phone ? <span className="block text-fg-secondary">{client.phone}</span> : null}
                  </dd>
                </div>
              ) : null}
              <div className="flex items-start justify-between gap-3">
                <dt className="text-fg-secondary">Jobs</dt>
                <dd className="text-fg">
                  {client.jobCount ?? 0} in all, {client.openJobCount ?? 0} open
                </dd>
              </div>
              {total ? (
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-fg-secondary">Labor hours in this period</dt>
                  <dd className="text-fg tabular-nums">{formatHours(total.hours, { maxDigits: 0 })}</dd>
                </div>
              ) : null}
              {client.notes ? <p className="border-t border-border-subtle pt-3 whitespace-pre-line text-fg-secondary">{client.notes}</p> : null}
            </dl>
            {total && total.marginBp !== null ? (
              <p className="mt-3 border-t border-border-subtle pt-3 text-xs text-fg-muted">
                Margin is {formatPercentBp(total.marginBp)} against a target of {formatPercentWhole(targetBp)}.
              </p>
            ) : null}
          </Section>
        </div>
      </div>

      <Section title="Last changes" hint="Who changed what on this client and its jobs." bodyClassName="p-0" testId="client-activity">
        {activity.isError ? (
          <div className="p-4">
            <LoadError what="the last changes" onRetry={() => void activity.refetch()} compact />
          </div>
        ) : !activity.data ? (
          <TableSkeleton label="Loading the last changes" rows={3} />
        ) : activity.data.items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-fg-secondary">No changes yet. Edits to this client, like a new target margin, show up here with who made them.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {activity.data.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 text-sm">
                <span className="min-w-0 text-fg">
                  <span className="font-medium">{item.actor?.name ?? 'KitStak'}</span> <span className="text-fg-secondary">{activityWords(item.verb, item.field)}</span>
                </span>
                <span className="shrink-0 text-xs text-fg-muted">{formatRelative(item.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {canManage ? null : <p className="text-xs text-fg-muted">Ask a manager to change this client’s details.</p>}
    </div>
  );
}

/** Earned less billed, never below zero. Uses the money library, like every other difference. */
function notBilledCents(total: ProfitRowDTO): number {
  const left = centsToNumber(subCents(total.revenueCents ?? 0, total.billedCents ?? 0));
  return left < 0 ? 0 : left;
}

const VERB_WORDS: Readonly<Record<string, string>> = {
  'client.created': 'added this client',
  'client.updated': 'changed this client',
  'client.deleted': 'deleted this client',
  'client.restored': 'brought this client back',
  'job.created': 'added a job',
  'job.updated': 'changed a job',
  'job.status': 'changed the status of a job',
  'note.added': 'left a note',
  'cost.created': 'added a cost',
  'revenue.created': 'added revenue',
  'job.status_changed': 'changed the stage of a job',
  'job.deleted': 'deleted a job',
  'job.restored': 'brought a job back',
  'job.duplicated': 'copied a job',
  'job.archived': 'archived a job',
  'plan.revised': 'changed the plan of a job',
  'price.changed': 'changed a price',
  'production.logged': 'logged a day of work',
  'production.edited': 'edited a work entry',
  'production.deleted': 'deleted a work entry',
  'production.restored': 'brought back a work entry',
  'material.logged': 'logged material used',
  'material.edited': 'edited material used',
  'material.deleted': 'deleted material used',
  'material.restored': 'brought back material used',
  'cost.logged': 'added a cost',
  'cost.edited': 'edited a cost',
  'cost.deleted': 'deleted a cost',
  'cost.restored': 'brought back a cost',
  'revenue.logged': 'added an invoice, fee or credit',
  'revenue.edited': 'edited an invoice, fee or credit',
  'revenue.deleted': 'deleted an invoice, fee or credit',
  'revenue.restored': 'brought back an invoice, fee or credit',
  'service_entry.logged': 'added an extra service',
  'service_entry.edited': 'edited an extra service',
  'service_entry.deleted': 'deleted an extra service',
  'service_entry.restored': 'brought back an extra service',
  'shared.moved': 'moved the share of time not on a job',
};

const FIELD_WORDS: Readonly<Record<string, string>> = { targetMarginBp: 'the target margin', name: 'the name', status: 'the status', contactName: 'the contact', contactEmail: 'the contact email', phone: 'the phone number', notes: 'the notes', partsOwner: 'who buys the parts', paymentTermsDays: 'the payment terms' };

function activityWords(verb: string, field: string | null): string {
  if (verb === 'client.updated' && field && FIELD_WORDS[field]) return `changed ${FIELD_WORDS[field]}`;
  const known = VERB_WORDS[verb];
  if (known) return known;
  const [entity = 'record', action = 'changed'] = verb.split('.');
  return `${action.replace(/_/g, ' ')} a ${entity.replace(/_/g, ' ')}`;
}
