'use client';
/**
 * One extra service: what it earned and cost in a period, how its price compares with what a
 * unit should cost, the clients using it, and every entry behind the numbers, with the entries
 * that still have no price on top.
 */
import { ScrollX } from '@/components/ui/scroll-x';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleHelp, Download, Pencil, Power, TriangleAlert } from 'lucide-react';
import { ComboChart } from '@/components/charts/cartesian';
import { formatDateLong } from '@/components/charts/scale';
import { KpiTile, MarginPill, marginHealth } from '@/components/charts/stats';
import { ExplainNumber } from '@/components/pulse/explain';
import { ExplainStatic } from '@/components/pulse/explain';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/table';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { toast } from '@/components/ui/toast';
import { cn } from '@/components/ui/cn';
import { formatHours, formatMoney, formatMoneyPlain, formatMoneyWhole, formatNumber, formatPace, formatPercentBp, formatUnitPrice } from '@/lib/format';
import { rawCell } from '@/lib/csv/write';
import { useServerAction } from '@/lib/hooks/use-action';
import { useLaborClasses, useProfit, useProfitEntries, useVasEntries, useVasService } from '@/lib/hooks/use-data';
import { suggestBucket } from '@/lib/profit/trends';
import { qk } from '@/lib/query-keys';
import { rangeLabel } from '@/lib/reports';
import { routes } from '@/lib/routes';
import type { VasServiceDTO } from '@/lib/types';
import { updateVasServiceAction } from '@/server/actions/catalog';
import { downloadCsv } from '@/features/profit/csv-download';
import { parsePeriod, periodQuery } from '@/features/profit/period';
import { PeriodPicker, type PeriodChange } from '@/features/profit/period-picker';
import { LoadError, Section, TableSkeleton } from '@/features/profit/profit-ui';
import { useQueryState } from '@/features/profit/use-query-state';
import { ServiceFormDialog } from './service-form';
import { SetEntryPrice, WarehouseContractLink, WarehouseSourceLink } from '@/features/revenue/entry-price-fix';
import { useShell } from '@/features/shell/shell-context';
import { BILLING_LABELS, NOT_KNOWN, NO_COST_REASON, NO_COST_WORDS, SERVICE_FLAG_WORDS, flagSentence, serviceLine, serviceRateCents, unitWord } from './services-model';

const DEFAULTS = { preset: 'last_90' } as const;
/** Money for a CSV cell: a plain number, marked so a negative amount is not mistaken for a formula. */
const money = (cents: number | null) => (cents === null ? '' : rawCell(formatMoneyPlain(cents)));

export function ServiceView({ service: initialService, today, weekStart, targetMarginBp, canManage, orgSlug }: { readonly service: VasServiceDTO; readonly today: string; readonly weekStart: number; readonly targetMarginBp: number; readonly canManage: boolean; readonly orgSlug: string }) {
  const queryClient = useQueryClient();
  const shell = useShell();
  const canFixEntries = shell.can('vas:manage');
  const { get, set } = useQueryState();
  const service = useVasService(initialService.id, { initialData: initialService }).data ?? initialService;
  const period = useMemo(() => parsePeriod(get, today, weekStart, DEFAULTS), [get, today, weekStart]);
  const bucket = suggestBucket(period);
  const scope = { from: period.from, to: period.to, serviceId: service.id };
  const onlyNoPrice = get('entries') === 'no-price';
  const [formOpen, setFormOpen] = useState(false);

  const trend = useProfit(bucket, scope);
  const clients = useProfit('client', scope);
  const entries = useVasEntries({ serviceId: service.id, from: period.from, to: period.to, limit: 500 });
  const names = useProfitEntries({ ...scope, kinds: ['revenue_vas'], limit: 2000 });
  const classes = useLaborClasses();
  const update = useServerAction(updateVasServiceAction, { invalidate: [['services'], qk.profitRoot()] });

  const setPeriod = useCallback((change: PeriodChange) => set(periodQuery({ preset: change.preset ?? period.preset, from: change.from ?? period.from, to: change.to ?? period.to, compare: 'none' }, DEFAULTS)), [period, set]);

  const total = trend.data?.total ?? null;
  const points = useMemo(() => [...(trend.data?.rows ?? [])].sort((a, b) => a.key.localeCompare(b.key)), [trend.data]);
  const rate = serviceRateCents(service, classes.data ?? []);
  // The services view counts quantities as units: use the client rows, which add up to the same service.
  const volume = useMemo(() => (entries.data ?? []).reduce((sum, entry) => sum + Number(entry.quantity), 0), [entries.data]);
  const line = useMemo(() => serviceLine(service, total ? { ...total, unitsGood: volume.toFixed(3) } : undefined, rate, targetMarginBp), [service, total, volume, rate, targetMarginBp]);
  const unit = unitWord(service.unitLabel);
  const sentence = flagSentence(line, targetMarginBp, (price) => formatUnitPrice(price), (bp) => formatPercentBp(bp));
  const label = useMemo(() => new Map((names.data?.rows ?? []).map((row) => [row.sourceId, row])), [names.data]);
  const noPrice = (entries.data ?? []).filter((entry) => entry.noPrice);
  const shownEntries = onlyNoPrice ? noPrice : (entries.data ?? []);
  const clientRows = useMemo(() => [...(clients.data?.rows ?? [])].sort((a, b) => (b.revenueCents ?? 0) - (a.revenueCents ?? 0)), [clients.data]);

  const toggle = async () => {
    const saved = await update.run({ serviceId: service.id, patch: { active: !service.active }, version: service.version });
    if (!saved) return;
    queryClient.setQueryData(qk.service(service.id), saved);
    toast.undo(saved.active ? `${saved.name} is on again` : `${saved.name} is turned off`, {
      onUndo: async () => {
        const result = await updateVasServiceAction({ serviceId: service.id, patch: { active: service.active }, version: saved.version });
        if (!result.ok) throw new Error(result.error.message);
        queryClient.setQueryData(qk.service(service.id), result.data);
        await queryClient.invalidateQueries({ queryKey: ['services'] });
      },
    });
  };

  const exportEntries = () =>
    downloadCsv(
      `${orgSlug}-${service.code}-entries-${period.from}-to-${period.to}.csv`,
      ['Day', 'Client', 'Job', 'Quantity', 'Price', 'Amount', 'Labor hours', 'Labor cost', 'Parts cost', 'Note'],
      shownEntries.map((entry) => {
        const info = label.get(entry.id);
        return [entry.workDate, info?.clientName ?? '', info?.jobNumber ?? '', entry.quantity, entry.unitPrice ?? '', money(entry.amountCents), entry.hours, money(entry.laborCostCents), money(entry.materialCents), entry.note ?? ''];
      }),
    );

  return (
    <div className="flex flex-col gap-4" data-testid="service-view">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <PeriodPicker period={period} onChange={setPeriod} showCompare={false} />
        {canManage ? (
          <div className="flex items-center gap-2">
            <Button variant="secondary" leadingIcon={<Power aria-hidden />} onClick={() => void toggle()} loading={update.pending} data-testid="service-toggle">
              {service.active ? 'Turn off' : 'Turn on'}
            </Button>
            <Button variant="secondary" leadingIcon={<Pencil aria-hidden />} onClick={() => setFormOpen(true)} data-testid="service-edit">
              Edit
            </Button>
          </div>
        ) : null}
      </div>

      {!service.active ? (
        <p className="rounded-lg border border-border-subtle bg-sunken px-4 py-2.5 text-sm text-fg-secondary" data-testid="service-off">
          This service is turned off. Its history stays, and it is hidden from new entries.
        </p>
      ) : null}

      {line.flag && sentence ? (
        <div role="status" className={cn('flex items-start gap-3 rounded-lg border px-4 py-3 text-sm', line.flag === 'no_cost' ? 'border-border-subtle bg-sunken text-fg-secondary' : line.flag === 'under_target' || line.flag === 'standard_under_target' ? 'border-warning/30 bg-warning-subtle text-warning-text' : 'border-danger/30 bg-danger-subtle text-danger-text')} data-testid="service-flag-banner" data-flag={line.flag}>
          {line.flag === 'no_cost' ? <CircleHelp aria-hidden className="mt-0.5 size-4 shrink-0" /> : <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />}
          <p>
            <strong className="font-semibold">{SERVICE_FLAG_WORDS[line.flag]}.</strong> {sentence}
          </p>
        </div>
      ) : null}

      {trend.isError && !trend.data ? (
        <LoadError what="this service’s numbers" message={trend.error instanceof Error ? trend.error.message : undefined} onRetry={() => void trend.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6" data-testid="service-tiles">
          <KpiTile label="Revenue" loading={!total} value={total ? formatMoneyWhole(total.revenueCents) : null} sparkline={points.length > 1 ? { values: points.map((row) => row.revenueCents) } : undefined} explain={<ExplainNumber metric="revenue" scope={scope} />} />
          <KpiTile label="Cost" loading={!total} value={total ? (total.costMissing ? NOT_KNOWN : formatMoneyWhole(total.costCents)) : null} footer={total?.costMissing ? <span className="text-xs text-fg-muted">No hours or parts logged</span> : undefined} sparkline={points.length > 1 ? { values: points.map((row) => (row.costMissing ? null : row.costCents)) } : undefined} explain={<ExplainNumber metric="cost" scope={scope} />} />
          {/* With no cost known, profit is not known either: it is never shown as the revenue (round four, designer issue 4). */}
          <KpiTile label="Profit" loading={!total} value={total ? (total.costMissing ? NOT_KNOWN : formatMoneyWhole(total.profitCents)) : null} footer={total?.costMissing ? <span className="text-xs text-fg-muted" data-testid="service-profit-not-known">{NO_COST_REASON}</span> : undefined} explain={<ExplainNumber metric="profit" scope={scope} />} />
          <KpiTile
            label="Margin"
            loading={!total}
            value={total ? (total.costMissing ? NO_COST_WORDS : formatPercentBp(total.marginBp, { empty: 'No revenue yet' })) : null}
            explain={<ExplainNumber metric="margin" scope={scope} />}
            footer={
              total?.costMissing ? (
                <span className="text-xs text-fg-muted" data-testid="service-no-cost">
                  {NO_COST_REASON}
                </span>
              ) : total && total.marginBp !== null ? (
                <MarginPill health={marginHealth(total.marginBp, targetMarginBp)} size="sm" />
              ) : undefined
            }
          />
          <KpiTile label={`Volume, ${service.unitLabel}`} explain={<ExplainStatic title={`Volume, ${service.unitLabel}`} rule="How many, added up over every entry of this service in the period." rows={[{ label: 'Entries', value: formatNumber(entries.data?.length ?? 0) }, { label: 'Volume', value: formatNumber(volume, { maxDigits: 3 }), kind: 'total' }]} />} loading={!entries.data} value={entries.data ? formatNumber(volume, { maxDigits: 3 }) : null} footer={entries.data ? <span className="text-xs text-fg-muted">{entries.data.length} {entries.data.length === 1 ? 'entry' : 'entries'}</span> : undefined} />
          <KpiTile label={`Earned for one ${unit}`} explain={<ExplainStatic title={`Earned for one ${unit}`} rule="Revenue from this service in the period divided by its volume. The cost to do one is its cost divided the same way." rows={[{ label: 'Revenue', value: total ? formatMoney(total.revenueCents, { empty: 'Hidden' }) : 'None' }, { label: 'Volume', value: formatNumber(volume, { maxDigits: 3 }) }, { label: 'Earned for one', value: line.revenuePerUnit ? formatUnitPrice(line.revenuePerUnit) : 'No volume yet', kind: 'total' }]} />} loading={!total || !entries.data} value={line.revenuePerUnit ? formatUnitPrice(line.revenuePerUnit) : null} emptyText="No volume yet" footer={line.costPerUnit ? <span className="text-xs text-fg-muted tabular-nums">{formatUnitPrice(line.costPerUnit)} to do one</span> : undefined} />
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Section title="Trend" hint={`${rangeLabel(period)}, by ${bucket}`} testId="service-trend">
          <ComboChart
            title={`Revenue, cost and margin for ${service.name}`}
            description="Bars show revenue and cost. The line on top is the margin, next to your target margin."
            loading={!trend.data}
            refreshing={trend.isFetching && Boolean(trend.data)}
            dates={points.map((row) => row.key)}
            bucket={bucket}
            bars={[
              { id: 'revenue', label: 'Revenue', values: points.map((row) => row.revenueCents) },
              { id: 'cost', label: 'Cost', values: points.map((row) => (row.costMissing ? null : row.costCents)), gapText: points.map((row) => (row.costMissing ? NOT_KNOWN : null)) },
            ]}
            lines={[{ id: 'margin', label: 'Margin', values: points.map((row) => row.marginBp), gapText: points.map((row) => (row.costMissing ? NO_COST_WORDS : null)) }]}
            barFormat="money"
            lineFormat="percent"
            lineTarget={{ value: targetMarginBp, label: 'Target margin' }}
            height={280}
            tableToggle
            emptyTitle="No entries in this period"
            emptyHint="Pick a longer period, or log this service on a job."
          />
        </Section>

        <Section title="Price and standard cost" hint={`${BILLING_LABELS[service.billing] ?? service.billing}, in ${service.unitLabel}`} testId="service-pricing">
          <dl className="flex flex-col text-sm tabular-nums">
            <div className="flex items-baseline justify-between gap-3 py-1.5">
              <dt className="text-fg-secondary">Price for one {unit}</dt>
              <dd className="font-semibold text-fg" data-testid="service-price-value">
                {line.price === null ? 'Not set' : formatUnitPrice(line.price)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-1.5">
              <dt className="text-fg-secondary">Parts for one {unit}</dt>
              <dd className="text-fg">{service.defaultCostPerUnit === null ? 'Not set' : formatUnitPrice(service.defaultCostPerUnit)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-1.5">
              <dt className="text-fg-secondary">
                <span className="text-fg-muted">plus </span>Labor at the target pace
                <span className="block text-xs text-fg-muted">{service.standardUph === null ? 'No target pace set' : rate === null ? 'No labor rate set' : `${formatPace(service.standardUph)} ${service.unitLabel} per person per hour at ${formatMoney(rate)} an hour`}</span>
              </dt>
              <dd className="text-fg">{line.standardLabor === null ? 'Not known' : formatUnitPrice(line.standardLabor)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-border-default py-1.5 font-semibold">
              <dt className="text-fg">
                <span className="font-normal text-fg-muted">equals </span>Standard cost
              </dt>
              <dd className="text-fg">{line.standardCost === null ? 'Not known' : formatUnitPrice(line.standardCost)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-1.5">
              <dt className="text-fg-secondary">Margin at list price</dt>
              <dd className={cn('font-semibold', (line.standardMarginBp ?? 0) < targetMarginBp ? 'text-danger-text' : 'text-fg')}>{formatPercentBp(line.standardMarginBp, { empty: 'Not known' })}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-1.5">
              <dt className="text-fg-secondary">Price that reaches your {formatPercentBp(targetMarginBp)} target</dt>
              <dd className="text-fg" data-testid="service-price-target">
                {line.priceForTarget === null ? 'Not known' : formatUnitPrice(line.priceForTarget)}
              </dd>
            </div>
          </dl>
          <p className="mt-3 border-t border-border-subtle pt-3 text-xs text-fg-muted">{line.costPerUnit ? `The target price uses what one ${unit} really cost in this period.` : line.costMissing && volume > 0 ? `The target price uses the standard cost, because what this work really cost is not known yet.` : `The target price uses the standard cost, because there is no volume in this period.`}</p>
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
        <Section title="Clients using it" hint={rangeLabel(period)} bodyClassName="p-0" testId="service-clients">
          {clients.isError ? (
            <div className="p-4">
              <LoadError what="the clients" onRetry={() => void clients.refetch()} compact />
            </div>
          ) : !clients.data ? (
            <TableSkeleton label="Loading the clients" rows={3} />
          ) : clientRows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-fg-secondary">No client bought this service in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Client</TableHeaderCell>
                    <TableHeaderCell numeric>Revenue</TableHeaderCell>
                    <TableHeaderCell numeric>Margin</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {clientRows.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="max-w-[220px] truncate">
                        {row.key === 'none' ? (
                          row.label
                        ) : (
                          <Link href={routes.client(row.key)} className="rounded-sm font-medium text-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                            {row.label}
                          </Link>
                        )}
                      </TableCell>
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

        <Section
          title={`Entries${entries.data ? `, ${shownEntries.length}` : ''}`}
          hint={noPrice.length > 0 ? (noPrice.length === 1 ? '1 entry has no price and earns nothing yet.' : `${noPrice.length} entries have no price and earn nothing yet.`) : rangeLabel(period)}
          bodyClassName="p-0"
          testId="service-entries"
          action={
            <>
              <ToggleGroup
                label="Which entries to show"
                size="sm"
                value={onlyNoPrice ? 'no-price' : 'all'}
                onValueChange={(value) => set({ entries: value === 'all' ? null : value })}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'no-price', label: `No price (${noPrice.length})` },
                ]}
              />
              <Button variant="ghost" size="sm" leadingIcon={<Download aria-hidden />} onClick={exportEntries} disabled={shownEntries.length === 0} data-testid="service-entries-export">
                Export
              </Button>
            </>
          }
        >
          {entries.isError ? (
            <div className="p-4">
              <LoadError what="the entries" message={entries.error instanceof Error ? entries.error.message : undefined} onRetry={() => void entries.refetch()} compact />
            </div>
          ) : !entries.data ? (
            <TableSkeleton label="Loading the entries" rows={5} />
          ) : shownEntries.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-fg-secondary" data-testid="service-entries-empty">
              {onlyNoPrice ? 'Every entry has a price. Nothing to fix here.' : 'No entries for this service in this period. Log it from a job, under Money in, and it shows up here.'}
            </p>
          ) : (
            <ScrollX label="Entries of this service" scrollerClassName="max-h-[480px] overflow-y-auto">
              <Table scroll={false} className="min-w-[620px]">
                <TableHead className="sticky top-0 z-[1]">
                  <tr>
                    <TableHeaderCell>Day</TableHeaderCell>
                    <TableHeaderCell>Client and job</TableHeaderCell>
                    <TableHeaderCell numeric>Quantity</TableHeaderCell>
                    <TableHeaderCell numeric>Price</TableHeaderCell>
                    <TableHeaderCell numeric>Amount</TableHeaderCell>
                    <TableHeaderCell numeric>Hours</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {shownEntries.slice(0, 200).map((entry) => {
                    const info = label.get(entry.id);
                    return (
                      <TableRow key={entry.id}>
                        <TableCell className="whitespace-nowrap">{formatDateLong(entry.workDate, 'day').replace(/, \d{4}$/, '')}</TableCell>
                        <TableCell className="max-w-[260px]">
                          <span className="block truncate">{info?.clientName ?? 'Client'}</span>
                          {info?.jobNumber ? (
                            <Link href={routes.jobTab(info.jobNumber, 'money-in')} className="rounded-sm text-xs text-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                              {info.jobNumber} {info.jobName}
                            </Link>
                          ) : entry.jobId ? (
                            <Link href={routes.jobTab(entry.jobId, 'money-in')} className="rounded-sm text-xs text-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                              Open the job
                            </Link>
                          ) : (
                            <span className="text-xs text-fg-muted">No job, billed to the client</span>
                          )}
                          {entry.source === 'wms' ? (
                            <span className="mt-0.5 flex">
                              <WarehouseSourceLink entry={entry} testId={`entry-source-${entry.id}`} />
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell numeric>{formatNumber(entry.quantity, { maxDigits: 2 })}</TableCell>
                        <TableCell numeric>
                          {entry.noPrice ? (
                            <span className="flex flex-col items-end gap-1" data-testid="entry-no-price">
                              <span className="font-medium text-danger-text">No price</span>
                              <SetEntryPrice entry={entry} serviceName={service.name} unitWord={unit} canEdit={canFixEntries} perHour={service.billing === 'per_hour'} />
                              <WarehouseContractLink entry={entry} testId={`entry-contract-${entry.id}`} />
                            </span>
                          ) : (
                            formatUnitPrice(entry.unitPrice, { empty: 'List price' })
                          )}
                        </TableCell>
                        <TableCell numeric>{formatMoney(entry.amountCents)}</TableCell>
                        <TableCell numeric>{Number(entry.hours) > 0 ? formatHours(entry.hours, { maxDigits: 1 }) : <span className="text-fg-muted">None</span>}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {shownEntries.length > 200 ? <p className="border-t border-border-subtle px-4 py-2 text-xs text-fg-muted">Showing the newest 200 of {shownEntries.length}. The export has them all.</p> : null}
            </ScrollX>
          )}
        </Section>
      </div>
      <ServiceFormDialog open={formOpen} onOpenChange={setFormOpen} service={service} rateCents={rate} targetMarginBp={targetMarginBp} onSaved={(saved) => queryClient.setQueryData(qk.service(service.id), saved)} />
    </div>
  );
}
