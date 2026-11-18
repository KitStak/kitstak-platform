'use client';
/**
 * Extra services: the catalog (price, standard cost, margin at list price) next to what each
 * service really did in the chosen period (volume, revenue, cost, margin, trend), with the
 * underpriced ones flagged and the price that would fix them. Add, edit, turn off and delete
 * (with undo) for people who manage services.
 */
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, MoreHorizontal, Pencil, Plus, Power, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { Sparkline } from '@/components/charts/sparkline';
import { KpiTile } from '@/components/charts/stats';
import { ButtonLink } from '@/components/pulse/button-link';
import { ExplainNumber } from '@/components/pulse/explain';
import { Teach } from '@/components/pulse/teach';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { IconButton } from '@/components/ui/icon-button';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/table';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { toast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/components/ui/cn';
import { formatMoney, formatMoneyPlain, formatMoneyWhole, formatNumber, formatPercentBp, formatUnitPrice } from '@/lib/format';
import { useServerAction } from '@/lib/hooks/use-action';
import { useLaborClasses, useProfit, useVasServices } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import { rangeLabel } from '@/lib/reports';
import { routes } from '@/lib/routes';
import type { VasServiceDTO } from '@/lib/types';
import { deleteVasServiceAction, restoreVasServiceAction, updateVasServiceAction } from '@/server/actions/catalog';
import { downloadCsv } from '@/features/profit/csv-download';
import { parsePeriod, periodQuery } from '@/features/profit/period';
import { PeriodPicker, type PeriodChange } from '@/features/profit/period-picker';
import { LoadError, Section, TableSkeleton } from '@/features/profit/profit-ui';
import { useQueryState } from '@/features/profit/use-query-state';
import { ServiceFormDialog } from './service-form';
import { BILLING_LABELS, SERVICE_FLAG_WORDS, flagSentence, serviceLine, serviceRateCents, type ServiceLine } from './services-model';

const DEFAULTS = { preset: 'last_90' } as const;
type Show = 'all' | 'underpriced' | 'off';

export function FlagPill({ line, targetMarginBp }: { readonly line: ServiceLine; readonly targetMarginBp: number }) {
  if (!line.flag) return null;
  const sentence = flagSentence(line, targetMarginBp, (price) => formatUnitPrice(price), (bp) => formatPercentBp(bp));
  const severe = line.flag === 'below_cost' || line.flag === 'standard_below_cost' || line.flag === 'no_price';
  return (
    <Tooltip content={sentence ?? SERVICE_FLAG_WORDS[line.flag]}>
      <span tabIndex={0} data-testid="service-flag" className={cn('inline-flex h-5 max-w-full items-center gap-1 rounded-sm px-2 text-xs font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus', severe ? 'bg-danger-subtle text-danger-text' : 'bg-[var(--label-orange-subtle)] text-[var(--label-orange-text)]')}>
        <TriangleAlert aria-hidden className="size-3 shrink-0" />
        <span className="truncate">{SERVICE_FLAG_WORDS[line.flag]}</span>
        <span className="sr-only">. {sentence}</span>
      </span>
    </Tooltip>
  );
}

export function ServicesView({ initialServices, today, weekStart, targetMarginBp, canManage, canImport, orgSlug }: { readonly initialServices?: VasServiceDTO[]; readonly today: string; readonly weekStart: number; readonly targetMarginBp: number; readonly canManage: boolean; readonly canImport: boolean; readonly orgSlug: string }) {
  const queryClient = useQueryClient();
  const { get, set } = useQueryState();
  const period = useMemo(() => parsePeriod(get, today, weekStart, DEFAULTS), [get, today, weekStart]);
  const scope = { from: period.from, to: period.to };
  const show: Show = get('show') === 'underpriced' ? 'underpriced' : get('show') === 'off' ? 'off' : 'all';
  const services = useVasServices({ includeInactive: true }, { initialData: initialServices });
  const profit = useProfit('service', { ...scope, trend: true });
  const classes = useLaborClasses();
  const [editing, setEditing] = useState<VasServiceDTO | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const keys = [qk.services(), ['services'], qk.profitRoot()] as const;
  const update = useServerAction(updateVasServiceAction, { invalidate: keys });
  const remove = useServerAction(deleteVasServiceAction, { invalidate: keys, errorTitle: "Couldn't delete the service" });

  const setPeriod = useCallback((change: PeriodChange) => set(periodQuery({ preset: change.preset ?? period.preset, from: change.from ?? period.from, to: change.to ?? period.to, compare: 'none' }, DEFAULTS)), [period, set]);

  const lines = useMemo(() => {
    const actuals = new Map((profit.data?.rows ?? []).map((row) => [row.key, row]));
    return (services.data ?? [])
      .map((service) => serviceLine(service, actuals.get(service.id), serviceRateCents(service, classes.data ?? []), targetMarginBp))
      .sort((a, b) => Number(Boolean(b.flag)) - Number(Boolean(a.flag)) || (b.revenueCents ?? 0) - (a.revenueCents ?? 0) || a.service.name.localeCompare(b.service.name));
  }, [services.data, profit.data, classes.data, targetMarginBp]);
  const underpriced = lines.filter((line) => line.flag && line.service.active);
  const shown = show === 'underpriced' ? underpriced : show === 'off' ? lines.filter((line) => !line.service.active) : lines.filter((line) => line.service.active);
  const core = profit.data?.rows.find((row) => row.key === 'none');
  const extras = useMemo(() => {
    const rows = (profit.data?.rows ?? []).filter((row) => row.key !== 'none');
    const sum = (pick: (row: (typeof rows)[number]) => number | null): number | null => (rows.length === 0 ? 0 : rows.reduce<number | null>((total, row) => (pick(row) === null || total === null ? null : total + (pick(row) as number)), 0));
    return { revenue: sum((row) => row.revenueCents), profit: sum((row) => row.profitCents) };
  }, [profit.data]);

  const toggle = async (service: VasServiceDTO) => {
    const saved = await update.run({ serviceId: service.id, patch: { active: !service.active }, version: service.version });
    if (!saved) return;
    toast.undo(saved.active ? `${saved.name} is on again` : `${saved.name} is turned off`, {
      onUndo: async () => {
        const result = await updateVasServiceAction({ serviceId: service.id, patch: { active: service.active }, version: saved.version });
        if (!result.ok) throw new Error(result.error.message);
        await queryClient.invalidateQueries({ queryKey: ['services'] });
      },
    });
  };

  const deleteService = async (service: VasServiceDTO) => {
    const done = await remove.run({ serviceId: service.id });
    if (done === undefined) return;
    toast.undo(`Deleted ${service.name}`, {
      onUndo: async () => {
        const result = await restoreVasServiceAction({ serviceId: service.id });
        if (!result.ok) throw new Error(result.error.message);
        await queryClient.invalidateQueries({ queryKey: ['services'] });
      },
    });
  };

  const exportRows = () =>
    downloadCsv(
      `${orgSlug}-extra-services-${period.from}-to-${period.to}.csv`,
      ['Service', 'Code', 'Unit', 'Billed', 'Active', 'Price', 'Standard cost', 'Margin at list price (%)', 'Volume', 'Revenue', 'Cost', 'Profit', 'Margin (%)', 'Revenue per unit', 'Cost per unit', 'Flag', 'Price for target margin'],
      shown.map((line) => [line.service.name, line.service.code, line.service.unitLabel, BILLING_LABELS[line.service.billing] ?? line.service.billing, line.service.active ? 'Yes' : 'No', line.price ?? '', line.standardCost ?? '', line.standardMarginBp === null ? '' : String(line.standardMarginBp / 100), line.volume, formatMoneyPlain(line.revenueCents), formatMoneyPlain(line.costCents), formatMoneyPlain(line.profitCents), line.marginBp === null ? '' : String(line.marginBp / 100), line.revenuePerUnit ?? '', line.costPerUnit ?? '', line.flag ? SERVICE_FLAG_WORDS[line.flag] : '', line.priceForTarget ?? '']),
    );

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const dialog = <ServiceFormDialog open={formOpen} onOpenChange={setFormOpen} service={editing} rateCents={editing ? serviceRateCents(editing, classes.data ?? []) : serviceRateCents({ defaultLaborClassId: null }, classes.data ?? [])} targetMarginBp={targetMarginBp} />;

  if (services.isError && !services.data) return <LoadError what="your extra services" message={services.error instanceof Error ? services.error.message : undefined} onRetry={() => void services.refetch()} />;

  if (services.data && services.data.length === 0) {
    return (
      <div className="rounded-xl border border-border-subtle bg-panel shadow-xs">
        <Teach
          testId="services-empty"
          icon={Sparkles}
          title="No extra services yet"
          why="Extra services are the things you bill on top of a job: labeling, rework, special packing, storage. List each one with its price and Pulse shows which ones earn their keep."
          points={['Price, standard cost and margin for each service', 'Volume, revenue and trend for any period', 'Which ones are underpriced, and the price that would fix them']}
          actions={
            <>
              {canManage ? (
                <Button leadingIcon={<Plus aria-hidden />} onClick={openNew} data-testid="services-add-first">
                  Add your first service
                </Button>
              ) : null}
              {canImport ? (
                <ButtonLink href={routes.newImport('services')} variant="secondary" icon={<FileSpreadsheet aria-hidden />}>
                  Import a service list
                </ButtonLink>
              ) : null}
            </>
          }
          footnote={canManage ? 'The import template has one row per service: code, name, unit, price and target pace.' : 'Ask a manager to add the first service.'}
        />
        {dialog}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="services-view">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <PeriodPicker period={period} onChange={setPeriod} showCompare={false} />
        <div className="flex items-center gap-2">
          <Button variant="secondary" leadingIcon={<Download aria-hidden />} onClick={exportRows} disabled={shown.length === 0} data-testid="services-export">
            Export CSV
          </Button>
          {canManage ? (
            <Button leadingIcon={<Plus aria-hidden />} onClick={openNew} data-testid="services-add">
              Add a service
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="services-tiles">
        <KpiTile label="Revenue from extra services" loading={!profit.data} value={profit.data ? formatMoneyWhole(extras.revenue) : null} footer={core ? <span className="text-xs text-fg-muted tabular-nums">{formatMoneyWhole(core.revenueCents)} from core job work</span> : undefined} />
        <KpiTile label="Profit from extra services" loading={!profit.data} value={profit.data ? formatMoneyWhole(extras.profit) : null} />
        <KpiTile label="Services in use" loading={!services.data} value={services.data ? formatNumber(lines.filter((line) => line.volume > 0).length) : null} footer={<span className="text-xs text-fg-muted">of {lines.filter((line) => line.service.active).length} active</span>} />
        <KpiTile
          label="Underpriced"
          loading={!services.data || !profit.data}
          value={formatNumber(underpriced.length)}
          footer={
            underpriced.length > 0 ? (
              <button type="button" onClick={() => set({ show: 'underpriced' })} className="rounded-sm text-xs font-medium text-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" data-testid="services-show-underpriced">
                Show them
              </button>
            ) : (
              <span className="text-xs text-fg-muted">Every price holds your {formatPercentBp(targetMarginBp)} target</span>
            )
          }
        />
      </div>

      <Section
        title={`Services, ${shown.length}`}
        hint={`Activity for ${rangeLabel(period)}. Target margin ${formatPercentBp(targetMarginBp)}.`}
        bodyClassName="p-0"
        testId="services-section"
        action={
          <ToggleGroup
            label="Which services to show"
            size="sm"
            value={show}
            onValueChange={(value) => set({ show: value === 'all' ? null : value })}
            options={[
              { value: 'all', label: 'Active' },
              { value: 'underpriced', label: `Underpriced (${underpriced.length})` },
              { value: 'off', label: 'Turned off' },
            ]}
          />
        }
      >
        {!services.data ? (
          <TableSkeleton label="Loading your extra services" />
        ) : shown.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-fg-secondary" data-testid="services-none-shown">
            {show === 'underpriced' ? `Nothing is underpriced. Every active service holds your ${formatPercentBp(targetMarginBp)} target margin.` : show === 'off' ? 'No service is turned off.' : 'Every service is turned off. Pick Turned off to see them.'}
          </p>
        ) : (
          <>
            {profit.isError ? <p className="border-b border-border-subtle px-4 py-2 text-sm text-danger-text">We could not load the activity for this period, so volume, revenue and margin are blank.</p> : null}
            <div className="overflow-x-auto">
              <Table className="min-w-max" data-testid="services-table">
                <TableHead>
                  <tr>
                    <TableHeaderCell className="sticky left-0 z-[1] min-w-[220px] bg-panel">Service</TableHeaderCell>
                    <TableHeaderCell numeric>Price</TableHeaderCell>
                    <TableHeaderCell numeric title="Parts for one unit plus labor at the target pace.">
                      Standard cost
                    </TableHeaderCell>
                    <TableHeaderCell numeric title="The margin one unit makes at the list price and the standard cost.">
                      Margin at list price
                    </TableHeaderCell>
                    <TableHeaderCell numeric>Volume</TableHeaderCell>
                    <TableHeaderCell numeric>Revenue</TableHeaderCell>
                    <TableHeaderCell numeric>Cost</TableHeaderCell>
                    <TableHeaderCell numeric>Margin</TableHeaderCell>
                    <TableHeaderCell>Profit trend</TableHeaderCell>
                    <TableHeaderCell>Check</TableHeaderCell>
                    {canManage ? (
                      <TableHeaderCell>
                        <span className="sr-only">Actions</span>
                      </TableHeaderCell>
                    ) : null}
                  </tr>
                </TableHead>
                <TableBody>
                  {shown.map((line) => {
                    const service = line.service;
                    return (
                      <TableRow key={service.id} data-testid="service-row" className="group">
                        <TableCell className="sticky left-0 z-[1] max-w-[280px] bg-panel group-hover:bg-hover">
                          <Link href={routes.service(service.id)} className="rounded-sm font-medium text-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" data-testid="service-link">
                            {service.name}
                          </Link>
                          <span className="block truncate text-xs text-fg-muted">
                            {service.code} · {BILLING_LABELS[service.billing] ?? service.billing}, {service.unitLabel}
                            {service.active ? '' : ' · turned off'}
                          </span>
                        </TableCell>
                        <TableCell numeric className="whitespace-nowrap">
                          {line.price === null ? <span className="text-fg-muted">None</span> : formatUnitPrice(line.price)}
                        </TableCell>
                        <TableCell numeric className="whitespace-nowrap">
                          {line.standardCost === null ? <span className="text-fg-muted">Not set</span> : formatUnitPrice(line.standardCost)}
                        </TableCell>
                        <TableCell numeric className={cn('whitespace-nowrap', (line.standardMarginBp ?? 0) < 0 && 'text-danger-text')}>
                          {formatPercentBp(line.standardMarginBp)}
                        </TableCell>
                        <TableCell numeric className="whitespace-nowrap">
                          {line.volume > 0 ? formatNumber(line.volume, { maxDigits: 0 }) : <span className="text-fg-muted">None</span>}
                        </TableCell>
                        <TableCell numeric className="whitespace-nowrap">
                          {line.volume > 0 ? formatMoney(line.revenueCents) : ''}
                        </TableCell>
                        <TableCell numeric className="whitespace-nowrap">
                          {line.volume > 0 ? formatMoney(line.costCents) : ''}
                        </TableCell>
                        <TableCell numeric className={cn('whitespace-nowrap', (line.marginBp ?? 0) < 0 && 'text-danger-text')}>
                          <span className="inline-flex items-center justify-end gap-0.5">
                            {line.volume > 0 ? <ExplainNumber metric="margin" scope={{ ...scope, serviceId: service.id }} label={`How we got the margin of ${service.name}`} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100" /> : null}
                            {line.volume > 0 ? formatPercentBp(line.marginBp) : ''}
                          </span>
                        </TableCell>
                        <TableCell>{line.trend && line.trend.length > 1 && line.volume > 0 ? <Sparkline values={[...line.trend]} label={`${service.name} profit over the period`} format="money" width={84} height={24} tone={(line.profitCents ?? 0) < 0 ? 'bad' : 'accent'} /> : null}</TableCell>
                        <TableCell>
                          <FlagPill line={line} targetMarginBp={targetMarginBp} />
                        </TableCell>
                        {canManage ? (
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <IconButton label={`Actions for ${service.name}`} icon={<MoreHorizontal aria-hidden />} size="sm" data-testid="service-actions" />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  icon={<Pencil aria-hidden />}
                                  onSelect={() => {
                                    setEditing(service);
                                    setFormOpen(true);
                                  }}
                                >
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem icon={<Power aria-hidden />} onSelect={() => void toggle(service)}>
                                  {service.active ? 'Turn off' : 'Turn on'}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem variant="danger" icon={<Trash2 aria-hidden />} onSelect={() => void deleteService(service)}>
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </Section>
      <p className="text-xs text-fg-muted">
        Standard cost is the parts for one unit plus labor at the target pace and the real cost of an hour. A service with entries cannot be deleted, so its history stays: turn it off instead.
      </p>
      {dialog}
    </div>
  );
}
