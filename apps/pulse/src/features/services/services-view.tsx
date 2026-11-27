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
import { CircleHelp, Download, FileSpreadsheet, MoreHorizontal, Pencil, Plus, Power, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { Sparkline } from '@/components/charts/sparkline';
import { StatRow, StatTile } from '@kitstak/ui/dashboard';
import { StatTileLoading, statValue } from '@/components/charts/stats';
import { ButtonLink } from '@/components/pulse/button-link';
import { ExplainNumber } from '@/components/pulse/explain';
import { ExplainStatic } from '@/components/pulse/explain';
import { Teach } from '@/components/pulse/teach';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { IconButton } from '@/components/ui/icon-button';
import { PINNED_CELL_SURFACE, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/table';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { toast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/components/ui/cn';
import { formatMoney, formatMoneyPlain, formatMoneyWhole, formatNumber, formatPercentBp, formatUnitPrice } from '@/lib/format';
import { rawCell } from '@/lib/csv/write';
import { useServerAction } from '@/lib/hooks/use-action';
import { useLaborClasses, useProfit, useVasEntries, useVasServices } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import { rangeLabel } from '@/lib/reports';
import { routes } from '@/lib/routes';
import type { ProfitResponse, VasServiceDTO } from '@/lib/types';
import { deleteVasServiceAction, restoreVasServiceAction, updateVasServiceAction } from '@/server/actions/catalog';
import { downloadCsv } from '@/features/profit/csv-download';
import { parsePeriod, periodQuery } from '@/features/profit/period';
import { PeriodPicker, type PeriodChange } from '@/features/profit/period-picker';
import { LoadError, Section, TableSkeleton, runDelete } from '@/features/profit/profit-ui';
import { useQueryState } from '@/features/profit/use-query-state';
import { NoPriceEntries, noPriceMonth } from './no-price-entries';
import { ServiceFormDialog } from './service-form';
import { BILLING_LABELS, NO_COST_REASON, NO_COST_WORDS, SERVICE_FLAG_WORDS, flagSentence, isUnderpriced, serviceLine, serviceRateCents, type ServiceLine } from './services-model';

const DEFAULTS = { preset: 'last_90' } as const;
/** Money for a CSV cell: a plain number, marked so a negative amount is not mistaken for a formula. */
const money = (cents: number | null) => (cents === null ? '' : rawCell(formatMoneyPlain(cents)));
type Show = 'all' | 'underpriced' | 'off' | 'no-price';

export function FlagPill({ line, targetMarginBp }: { readonly line: ServiceLine; readonly targetMarginBp: number }) {
  if (!line.flag) return null;
  const sentence = flagSentence(line, targetMarginBp, (price) => formatUnitPrice(price), (bp) => formatPercentBp(bp));
  const severe = line.flag === 'below_cost' || line.flag === 'standard_below_cost' || line.flag === 'no_price';
  // "No cost yet" is a gap in the data, not a bad price: it gets a neutral tone.
  const neutral = line.flag === 'no_cost';
  return (
    <Tooltip content={sentence ?? SERVICE_FLAG_WORDS[line.flag]}>
      <span tabIndex={0} data-testid="service-flag" data-flag={line.flag} className={cn('inline-flex h-5 max-w-full items-center gap-1 rounded-sm px-2 text-xs font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus', neutral ? 'bg-muted text-fg-secondary' : severe ? 'bg-danger-subtle text-danger-text' : 'bg-warning-subtle text-warning-text')}>
        {neutral ? <CircleHelp aria-hidden className="size-3 shrink-0" /> : <TriangleAlert aria-hidden className="size-3 shrink-0" />}
        <span className="truncate">{SERVICE_FLAG_WORDS[line.flag]}</span>
        <span className="sr-only">. {sentence}</span>
      </span>
    </Tooltip>
  );
}

export function ServicesView({ initialServices, initialProfit, today, weekStart, targetMarginBp, canManage, canImport, orgSlug }: { readonly initialServices?: VasServiceDTO[]; readonly initialProfit?: { readonly from: string; readonly to: string; readonly profit: ProfitResponse }; readonly today: string; readonly weekStart: number; readonly targetMarginBp: number; readonly canManage: boolean; readonly canImport: boolean; readonly orgSlug: string }) {
  const queryClient = useQueryClient();
  const { get, set } = useQueryState();
  const period = useMemo(() => parsePeriod(get, today, weekStart, DEFAULTS), [get, today, weekStart]);
  const scope = { from: period.from, to: period.to };
  const byServiceHref = routes.profit({ by: 'service', from: period.from, to: period.to });
  /** This page with one list picked, on the same days. */
  const listHref = (pick: Show): string => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...periodQuery({ ...period, compare: 'none' }, DEFAULTS), show: pick === 'all' ? undefined : pick })) if (value) query.set(key, value);
    const text = query.toString();
    return text ? `${routes.services()}?${text}` : routes.services();
  };
  const rawShow = get('show');
  const show: Show = rawShow === 'underpriced' || rawShow === 'off' || rawShow === 'no-price' ? rawShow : 'all';
  const noPriceAt = noPriceMonth(get('month'));
  // The same list "Fix this first" and Home count: every unpriced entry in a month that is still open.
  const unpriced = useVasEntries({ noPrice: true, openMonths: true, limit: 2000 });
  const unpricedCount = unpriced.data?.length ?? 0;
  const services = useVasServices({ includeInactive: true }, { initialData: initialServices });
  // Read on the server for the period the page opened on, so the rows arrive with their numbers.
  const fromServer = Boolean(initialProfit) && scope.from === initialProfit?.from && scope.to === initialProfit?.to;
  const profit = useProfit('service', { ...scope, trend: true }, { initialData: fromServer ? initialProfit?.profit : undefined });
  const classes = useLaborClasses();
  const [editing, setEditing] = useState<VasServiceDTO | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const keys = [qk.services(), ['services'], qk.profitRoot()] as const;
  const update = useServerAction(updateVasServiceAction, { invalidate: keys });

  const setPeriod = useCallback((change: PeriodChange) => set(periodQuery({ preset: change.preset ?? period.preset, from: change.from ?? period.from, to: change.to ?? period.to, compare: 'none' }, DEFAULTS)), [period, set]);

  const lines = useMemo(() => {
    const actuals = new Map((profit.data?.rows ?? []).map((row) => [row.key, row]));
    return (services.data ?? [])
      .map((service) => serviceLine(service, actuals.get(service.id), serviceRateCents(service, classes.data ?? []), targetMarginBp))
      .sort((a, b) => Number(isUnderpriced(b.flag)) - Number(isUnderpriced(a.flag)) || Number(Boolean(b.flag)) - Number(Boolean(a.flag)) || (b.revenueCents ?? 0) - (a.revenueCents ?? 0) || a.service.name.localeCompare(b.service.name));
  }, [services.data, profit.data, classes.data, targetMarginBp]);
  const underpriced = lines.filter((line) => isUnderpriced(line.flag) && line.service.active);
  const noCost = lines.filter((line) => line.costMissing && line.service.active);
  const shown = show === 'underpriced' ? underpriced : show === 'off' ? lines.filter((line) => !line.service.active) : lines.filter((line) => line.service.active);
  const core = profit.data?.rows.find((row) => row.key === 'none');
  const extras = useMemo(() => {
    const rows = (profit.data?.rows ?? []).filter((row) => row.key !== 'none');
    const sum = (pick: (row: (typeof rows)[number]) => number | null): number | null => (rows.length === 0 ? 0 : rows.reduce<number | null>((total, row) => (pick(row) === null || total === null ? null : total + (pick(row) as number)), 0));
    // Rows with no known cost count with no cost in the total, so the total still adds up. The tile says how much of it that is.
    return { revenue: sum((row) => row.revenueCents), profit: sum((row) => row.profitCents), noCostRevenue: sum((row) => (row.costMissing ? row.revenueCents : 0)) };
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
    const deleted = await runDelete(deleteVasServiceAction, { serviceId: service.id }, `Couldn't delete ${service.name}`);
    if (!deleted) return;
    await queryClient.invalidateQueries({ queryKey: ['services'] });
    toast.undo(`Deleted ${service.name}`, {
      onUndo: async () => {
        const result = await restoreVasServiceAction({ serviceId: service.id });
        if (!result.ok) throw new Error(result.error.message);
        await queryClient.invalidateQueries({ queryKey: ['services'] });
      },
    });
  };

  const rowMenu = (service: VasServiceDTO, testId: string) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={`Actions for ${service.name}`} icon={<MoreHorizontal aria-hidden />} size="sm" data-testid={testId} />
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
  );
  /** The margin of one service in the period, with "How we got this". Blank when it had no volume. */
  const marginBody = (line: ServiceLine, hover = true) => (
    <span className={cn('inline-flex items-center justify-end gap-0.5', !hover && 'flex-row-reverse')}>
      {line.volume > 0 ? <ExplainNumber metric="margin" scope={{ ...scope, serviceId: line.service.id }} label={`How we got the margin of ${line.service.name}`} className={hover ? 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100' : undefined} /> : null}
      {line.volume > 0 ? (
        line.costMissing ? (
          <span className="text-fg-muted" title={NO_COST_REASON} data-testid={hover ? 'service-no-cost' : 'service-card-no-cost'}>
            {NO_COST_WORDS}
          </span>
        ) : (
          formatPercentBp(line.marginBp)
        )
      ) : (
        ''
      )}
    </span>
  );

  const exportRows = () =>
    downloadCsv(
      `${orgSlug}-extra-services-${period.from}-to-${period.to}.csv`,
      // Number columns stay numbers: a cost Pulse does not know is an empty cell, and "Cost known" says why.
      ['Service', 'Code', 'Unit', 'Billed', 'Active', 'Price', 'Standard cost', 'Margin at list price (%)', 'Volume', 'Revenue', 'Cost', 'Profit', 'Margin (%)', 'Cost known', 'Revenue per unit', 'Cost per unit', 'Flag', 'Price for target margin'],
      shown.map((line) => [line.service.name, line.service.code, line.service.unitLabel, BILLING_LABELS[line.service.billing] ?? line.service.billing, line.service.active ? 'Yes' : 'No', line.price ?? '', line.standardCost ?? '', line.standardMarginBp === null ? '' : rawCell((line.standardMarginBp / 100).toFixed(2)), line.volume, money(line.revenueCents), line.costMissing ? '' : money(line.costCents), line.costMissing ? '' : money(line.profitCents), line.marginBp === null ? '' : rawCell((line.marginBp / 100).toFixed(2)), line.volume > 0 ? (line.costMissing ? 'No' : 'Yes') : '', line.revenuePerUnit ?? '', line.costPerUnit ?? '', line.flag ? SERVICE_FLAG_WORDS[line.flag] : '', line.priceForTarget ?? '']),
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

      <StatRow label="Extra services numbers" data-testid="services-tiles">
        {!profit.data ? (
          <StatTileLoading label="Revenue from extra services" />
        ) : (
          <StatTile label="Revenue from extra services" href={byServiceHref} explain={<ExplainStatic title="Revenue from extra services" rule="What every extra service entry in this period earned: how many times its price. Core job work is counted apart." rows={[{ label: 'Extra services', value: formatMoney(extras.revenue, { empty: 'Hidden' }), kind: 'total' }, { label: 'Core job work', value: core ? formatMoney(core.revenueCents, { empty: 'Hidden' }) : 'None', kind: 'note' }]} />} value={statValue(formatMoneyWhole(extras.revenue))} caption={core ? <span className="tabular-nums">{formatMoneyWhole(core.revenueCents)} from core job work</span> : undefined} />
        )}
        {!profit.data ? (
          <StatTileLoading label="Profit from extra services" />
        ) : (
        <StatTile
          label="Profit from extra services"
          href={byServiceHref}
          explain={
            <ExplainStatic
              title="Profit from extra services"
              rule={`Revenue from extra services, less their labor, their parts and their share of time not on a job.${(extras.noCostRevenue ?? 0) > 0 ? ' A service with no known cost shows "Not known" on its own row, and counts here with no cost against it, so this total is too high by whatever that work really cost.' : ''}`}
              rows={[
                { label: 'Revenue from extra services', value: formatMoney(extras.revenue, { empty: 'Hidden' }) },
                ...((extras.noCostRevenue ?? 0) > 0 ? [{ label: 'Of that, from services with no known cost', value: formatMoney(extras.noCostRevenue), kind: 'note' as const }] : []),
                { label: 'Profit from extra services', value: formatMoney(extras.profit, { empty: 'Hidden' }), kind: 'total' as const },
              ]}
            />
          }
          value={statValue(formatMoneyWhole(extras.profit))}
          caption={(extras.noCostRevenue ?? 0) > 0 ? <span className="tabular-nums" data-testid="services-no-cost-in-total">Counts {formatMoneyWhole(extras.noCostRevenue)} with no known cost</span> : undefined}
        />
        )}
        {!services.data ? (
          <StatTileLoading label="Services in use" />
        ) : (
          <StatTile label="Services in use" href={null} explain={<ExplainStatic title="Services in use" rule="Active services with at least one entry in this period." rows={[{ label: 'With entries in this period', value: formatNumber(lines.filter((line) => line.volume > 0).length), kind: 'total' }, { label: 'Active services', value: formatNumber(lines.filter((line) => line.service.active).length), kind: 'note' }]} />} value={statValue(formatNumber(lines.filter((line) => line.volume > 0).length))} caption={<span>of {lines.filter((line) => line.service.active).length} active</span>} />
        )}
        {!services.data || !profit.data ? (
          <StatTileLoading label="Underpriced" />
        ) : (
        <StatTile
          label="Underpriced"
          href={listHref('underpriced')}
          explain={
            <ExplainStatic
              title="Underpriced"
              rule="An active service is underpriced when its margin at the list price, or its real margin in this period, is under your target margin."
              rows={[
                { label: 'Target margin', value: formatPercentBp(targetMarginBp) },
                { label: 'Services under it', value: formatNumber(underpriced.length), kind: 'total' },
              ]}
            />
          }
          value={statValue(formatNumber(underpriced.length))}
          caption={underpriced.length > 0 ? <span>Under your {formatPercentBp(targetMarginBp)} target margin</span> : <span>Every price holds your {formatPercentBp(targetMarginBp)} target</span>}
        />
        )}
      </StatRow>

      {show === 'no-price' ? (
        <NoPriceEntries month={noPriceAt} services={services.data ?? []} onShowAll={() => set({ show: null, month: null })} />
      ) : (
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
            onValueChange={(value) => set({ show: value === 'all' ? null : value, month: null })}
            options={[
              { value: 'all', label: 'Active' },
              { value: 'underpriced', label: `Underpriced (${underpriced.length})` },
              ...(unpricedCount > 0 ? [{ value: 'no-price', label: `Entries with no price (${unpricedCount})` }] : []),
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
            {/* Below 1280 px: one card per service, so revenue, cost, margin and the row menu are all on screen. */}
            <ul className="grid gap-2 p-3 sm:grid-cols-2 xl:hidden" aria-label="Extra services" data-testid="services-cards">
              {shown.map((line) => {
                const service = line.service;
                const none = <span className="font-normal text-fg-muted">None</span>;
                return (
                  <li key={service.id} className="flex flex-col gap-2.5 rounded-xl border border-border-subtle bg-panel p-3 shadow-xs" data-testid="service-card">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <Link href={routes.service(service.id)} className="rounded-sm font-medium text-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                          {service.name}
                        </Link>
                        <span className="block truncate text-xs text-fg-muted">
                          {service.code} · {BILLING_LABELS[service.billing] ?? service.billing}, {service.unitLabel}
                          {service.active ? '' : ' · turned off'}
                        </span>
                      </div>
                      {canManage ? rowMenu(service, 'service-card-actions') : null}
                    </div>
                    <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm tabular-nums">
                      <div className="min-w-0">
                        <dt className="text-xs text-fg-muted">Revenue</dt>
                        <dd className="font-medium text-fg" data-testid="service-card-revenue">{line.volume > 0 ? formatMoney(line.revenueCents) : none}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-xs text-fg-muted">Cost</dt>
                        <dd className="font-medium text-fg" data-testid="service-card-cost">{line.volume > 0 ? line.costMissing ? <span className="font-normal text-fg-muted">Not known</span> : formatMoney(line.costCents) : none}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-xs text-fg-muted">Margin</dt>
                        <dd className={cn('font-medium text-fg', (line.marginBp ?? 0) < 0 && 'text-danger-text')} data-testid="service-card-margin">{line.volume > 0 ? marginBody(line, false) : none}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-xs text-fg-muted">Volume</dt>
                        <dd className="text-fg">{line.volume > 0 ? formatNumber(line.volume, { maxDigits: 3 }) : none}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-xs text-fg-muted">Price</dt>
                        <dd className="text-fg">{line.price === null ? none : formatUnitPrice(line.price)}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-xs text-fg-muted" title="Parts for one unit plus labor at the target pace.">
                          Standard cost
                        </dt>
                        <dd className="text-fg">{line.standardCost === null ? <span className="text-fg-muted">Not set</span> : formatUnitPrice(line.standardCost)}</dd>
                      </div>
                    </dl>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <FlagPill line={line} targetMarginBp={targetMarginBp} />
                      {line.standardMarginBp !== null ? (
                        <span className="text-xs text-fg-muted">
                          Margin at list price <span className={cn('font-medium tabular-nums', line.standardMarginBp < 0 ? 'text-danger-text' : 'text-fg-secondary')}>{formatPercentBp(line.standardMarginBp)}</span>
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="hidden overflow-x-auto xl:block">
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
                      <TableHeaderCell className="sticky right-0 z-[1] w-12 bg-panel">
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
                          {line.volume > 0 ? formatNumber(line.volume, { maxDigits: 3 }) : <span className="text-fg-muted">None</span>}
                        </TableCell>
                        <TableCell numeric className="whitespace-nowrap">
                          {line.volume > 0 ? formatMoney(line.revenueCents) : ''}
                        </TableCell>
                        <TableCell numeric className="whitespace-nowrap">
                          {line.volume > 0 ? line.costMissing ? <span className="text-fg-muted">Not known</span> : formatMoney(line.costCents) : ''}
                        </TableCell>
                        <TableCell numeric className={cn('whitespace-nowrap', (line.marginBp ?? 0) < 0 && 'text-danger-text')}>
                          {marginBody(line)}
                        </TableCell>
                        <TableCell>{line.trend && line.trend.length > 1 && line.volume > 0 && !line.costMissing ? <Sparkline values={[...line.trend]} label={`${service.name} profit over the period`} format="money" width={84} height={24} tone={(line.profitCents ?? 0) < 0 ? 'bad' : 'accent'} /> : null}</TableCell>
                        <TableCell>
                          <FlagPill line={line} targetMarginBp={targetMarginBp} />
                        </TableCell>
                        {canManage ? (
                          <TableCell className={cn('sticky right-0 z-[1] w-12', PINNED_CELL_SURFACE)}>
                            {rowMenu(service, 'service-actions')}
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
      )}
      {noCost.length > 0 ? (
        <p className="text-xs text-fg-muted" data-testid="services-no-cost-note">
          {noCost.length} {noCost.length === 1 ? 'service shows' : 'services show'} &ldquo;{NO_COST_WORDS}&rdquo; in place of a margin. {NO_COST_REASON} Work that comes in from the warehouse has a price and no hours until someone adds them.
        </p>
      ) : null}
      <p className="text-xs text-fg-muted">
        Standard cost is the parts for one unit plus labor at the target pace and the real cost of an hour. A service with entries cannot be deleted, so its history stays: turn it off instead.
      </p>
      {dialog}
    </div>
  );
}
