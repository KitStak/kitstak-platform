'use client';
/**
 * Money in: what the job has earned, what has been billed and what is not billed yet; the price
 * and its history ("From which day?"); invoices, fees, corrections and credits; and the extra
 * services with their own revenue, cost and margin.
 */
import { useMemo, useState } from 'react';
import { BadgeDollarSign, Lock, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import {
  Button,
  IconButton,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  toast,
} from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { BarChart } from '@/components/charts/cartesian';
import { KpiTile } from '@/components/charts/stats';
import { Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { useShell } from '@/features/shell/shell-context';
import { PRICING_MODEL_LABELS, REVENUE_KIND_LABELS } from '@/lib/constants';
import {
  formatHours,
  formatMoney,
  formatMoneyPerHour,
  formatNumber,
  formatPercentBp,
  formatUnitPrice,
} from '@/lib/format';
import { addCents, marginBp, subCents, toCents } from '@/lib/money';
import { shortDate } from '@/lib/profit/calendar';
import { routes } from '@/lib/routes';
import type { RevenueEntryDTO, VasEntryDTO } from '@/lib/types';
import {
  deleteRevenueAction,
  deleteVasEntryAction,
  restoreRevenueAction,
  restoreVasEntryAction,
} from '@/server/actions/entries';
import { deleteJobPriceAction } from '@/server/actions/jobs';
import { RevenueDialog, ServiceDialog } from './forms/entry-forms';
import { PriceDialog } from './forms/job-dialogs';
import { useDeleteWithUndo, useJobDaily, useJobRevenue, useJobServices, useRefreshJob } from './job-data';
import { singularUnit } from './job-math';
import type { JobTabProps } from './job-overview';
import { Explain, LoadError } from './job-ui';

export function JobMoneyIn({ job, today, services, laborClasses }: JobTabProps) {
  const shell = useShell();
  const refresh = useRefreshJob();
  const removeWithUndo = useDeleteWithUndo(refresh);
  const canRevenue = shell.can('revenue:manage');
  const canVas = shell.can('vas:manage');
  const unit = singularUnit(job.unitLabel);
  const stats = job.stats;
  const revenue = useJobRevenue(job.id);
  const serviceRows = useJobServices(job.id);
  const daily = useJobDaily(job.number);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [revenueDialog, setRevenueDialog] = useState<RevenueEntryDTO | 'new' | null>(null);
  const [serviceDialog, setServiceDialog] = useState<VasEntryDTO | 'new' | null>(null);
  const [priceOpen, setPriceOpen] = useState(false);
  const hide = (id: string) => setHidden((current) => new Set(current).add(id));
  const show = (id: string) =>
    setHidden((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });

  const revenueRows = useMemo(
    () => (revenue.data ?? []).filter((row) => row.deletedAt === null && !hidden.has(row.id)),
    [revenue.data, hidden],
  );
  const vasRows = useMemo(
    () => (serviceRows.data ?? []).filter((row) => row.deletedAt === null && !hidden.has(row.id)),
    [serviceRows.data, hidden],
  );
  const serviceName = useMemo(() => new Map(services.map((item) => [item.id, item.name])), [services]);
  const earned = useMemo(() => {
    const rows = [...(daily.data?.rows ?? [])]
      .sort((a, b) => a.key.localeCompare(b.key))
      .filter((row) => (row.revenueCents ?? 0) !== 0);
    return {
      labels: rows.map((row) => shortDate(row.key)),
      values: rows.map((row) => row.revenueCents ?? 0),
    };
  }, [daily.data]);

  if (stats.moneyHidden)
    return <LoadError what="money in" message="Your role does not show money, so this tab is hidden." />;

  const priceText =
    job.pricingModel === 'per_unit'
      ? job.unitPrice === null
        ? 'No price yet'
        : `${formatUnitPrice(job.unitPrice)} a ${unit}`
      : job.pricingModel === 'fixed'
        ? job.fixedPriceCents === null
          ? 'No price yet'
          : `${formatMoney(job.fixedPriceCents)} for the whole job`
        : job.billRateCents === null
          ? 'No rate yet'
          : formatMoneyPerHour(job.billRateCents);

  const removePrice = async (priceId: string) => {
    const gone = await deleteJobPriceAction({ priceId });
    if (!gone.ok) {
      toast.error("Couldn't delete that price", gone.error.message);
      return;
    }
    await refresh();
    toast.success('Price change removed', 'Entries from that day went back to the earlier price.');
  };

  return (
    <div className="flex flex-col gap-5" data-testid="job-money-in">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile
          label="Earned"
          value={formatMoney(stats.revenueCents, { cents: false })}
          footer={<span className="text-xs text-fg-muted">Revenue from the work done so far</span>}
          explain={
            <Explain
              title="Earned"
              rule="Revenue is earned when the work is done. This is the only number profit is worked out from."
              rows={[
                { label: 'From the work itself', value: formatMoney(stats.baseRevenueCents) },
                { label: 'Extra services', value: formatMoney(stats.vasRevenueCents) },
                { label: 'Fees, corrections and credits', value: formatMoney(stats.otherRevenueCents) },
                { label: 'Earned', value: formatMoney(stats.revenueCents), kind: 'total' },
              ]}
            />
          }
        />
        <KpiTile
          label="Billed"
          value={formatMoney(stats.billedCents, { cents: false })}
          footer={<span className="text-xs text-fg-muted">Approved invoices. Never counted as profit.</span>}
        />
        <KpiTile
          label="Not billed yet"
          value={formatMoney(stats.notBilledYetCents, { cents: false })}
          footer={
            <span
              className={cn(
                'text-xs',
                (stats.notBilledYetCents ?? 0) > 0 ? 'text-[var(--label-yellow-text)]' : 'text-fg-muted',
              )}
            >
              {(stats.notBilledYetCents ?? 0) > 0
                ? 'Earned, with no invoice to cover it'
                : 'Every earned dollar is on an invoice'}
            </span>
          }
          explain={
            <Explain
              title="Not billed yet"
              rule="What the work has earned, less what approved invoices cover."
              rows={[
                { label: 'Earned', value: formatMoney(stats.revenueCents) },
                { label: 'Billed', value: formatMoney(stats.billedCents), kind: 'minus' },
                { label: 'Not billed yet', value: formatMoney(stats.notBilledYetCents), kind: 'total' },
              ]}
            />
          }
        />
      </div>

      <Panel
        title="Price"
        action={
          canRevenue ? (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Pencil aria-hidden />}
              onClick={() => setPriceOpen(true)}
              data-testid="price-change"
            >
              Change the price
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-fg-secondary">
            {PRICING_MODEL_LABELS[job.pricingModel]}:{' '}
            <span className="text-md font-semibold text-fg tabular-nums" data-testid="price-current">
              {priceText}
            </span>
          </p>
          {job.pricingModel !== 'fixed' && job.prices.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border-subtle">
              <Table aria-label="Price history" data-testid="price-history">
                <TableHead>
                  <TableRow className="hover:bg-transparent">
                    <TableHeaderCell>From which day</TableHeaderCell>
                    <TableHeaderCell numeric>
                      {job.pricingModel === 'per_unit' ? `Price for one ${unit}` : 'Price for one hour'}
                    </TableHeaderCell>
                    <TableHeaderCell>Why</TableHeaderCell>
                    <TableHeaderCell className="w-10">
                      <span className="sr-only">Actions</span>
                    </TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {job.prices.map((price) => (
                    <TableRow key={price.id}>
                      <TableCell>
                        {price.effectiveFrom === '0001-01-01'
                          ? 'From the start'
                          : shortDate(price.effectiveFrom)}
                      </TableCell>
                      <TableCell numeric>
                        {job.pricingModel === 'per_unit'
                          ? formatUnitPrice(price.unitPrice, { empty: 'No price' })
                          : formatMoney(price.billRateCents, { empty: 'No rate' })}
                      </TableCell>
                      <TableCell className="text-fg-secondary">{price.note ?? ''}</TableCell>
                      <TableCell className="pl-0 text-right">
                        {canRevenue && price.effectiveFrom !== '0001-01-01' ? (
                          <IconButton
                            label={`Remove the price change of ${shortDate(price.effectiveFrom)}`}
                            icon={<Trash2 aria-hidden />}
                            size="sm"
                            onClick={() => void removePrice(price.id)}
                          />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
          <p className="text-xs text-fg-muted">
            A price change starts on the day you pick. Days before it keep the old price, so closed months
            never move.
          </p>
        </div>
      </Panel>

      <Panel title="Earned by day" bodyClassName="p-4 min-w-0">
        <BarChart
          title="Revenue earned each day"
          labels={earned.labels}
          series={[{ id: 'earned', label: 'Earned', values: earned.values }]}
          format="money"
          height={220}
          loading={daily.isPending}
          error={daily.isError ? 'This chart could not load.' : null}
          onRetry={() => void daily.refetch()}
          emptyTitle="Nothing earned yet"
          emptyHint="Revenue shows up here on the day the work is logged."
          hideLegend
          tableToggle
        />
      </Panel>

      <Panel
        title="Invoices, fees and credits"
        action={
          canRevenue ? (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Plus aria-hidden />}
              onClick={() => setRevenueDialog('new')}
              data-testid="revenue-add"
            >
              Add a row
            </Button>
          ) : undefined
        }
        bodyClassName="p-0"
      >
        {revenue.isError ? (
          <div className="p-4">
            <LoadError what="the invoices" onRetry={() => void revenue.refetch()} />
          </div>
        ) : revenue.isPending ? (
          <div className="flex flex-col gap-2 p-4" role="status" aria-busy="true">
            <span className="sr-only">Loading invoices</span>
            <Skeleton height={28} />
            <Skeleton height={28} />
          </div>
        ) : revenueRows.length === 0 ? (
          <Teach
            testId="revenue-empty"
            size="sm"
            icon={BadgeDollarSign}
            title="No invoices or fees yet"
            why="Log each invoice to see what is still not billed. Add fees and credits here too: they change what the job earned."
            actions={
              canRevenue ? (
                <Button leadingIcon={<Plus aria-hidden />} onClick={() => setRevenueDialog('new')}>
                  Add an invoice or a fee
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table aria-label="Invoices, fees and credits" data-testid="revenue-table">
              <TableHead>
                <TableRow className="hover:bg-transparent">
                  <TableHeaderCell>Day</TableHeaderCell>
                  <TableHeaderCell>What</TableHeaderCell>
                  <TableHeaderCell>For</TableHeaderCell>
                  <TableHeaderCell numeric>Amount</TableHeaderCell>
                  <TableHeaderCell>Counts as</TableHeaderCell>
                  <TableHeaderCell className="w-20">
                    <span className="sr-only">Actions</span>
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {revenueRows.map((row) => (
                  <TableRow key={row.id} data-testid="revenue-row">
                    <TableCell className="whitespace-nowrap">{shortDate(row.revenueDate)}</TableCell>
                    <TableCell>
                      {REVENUE_KIND_LABELS[row.kind]}
                      {row.invoiceNumber ? (
                        <span className="ml-1.5 text-xs text-fg-muted">{row.invoiceNumber}</span>
                      ) : null}
                      {row.kind === 'invoice' && !row.approved ? (
                        <span className="ml-1.5 rounded-sm bg-[var(--label-yellow-subtle)] px-1 text-2xs font-medium text-[var(--label-yellow-text)]">
                          Not approved yet
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate text-fg-secondary">
                      {row.description ?? row.serviceLabel ?? ''}
                    </TableCell>
                    <TableCell
                      numeric
                      className={cn('font-medium', (row.amountCents ?? 0) < 0 && 'text-danger-text')}
                    >
                      {formatMoney(row.amountCents)}
                    </TableCell>
                    <TableCell className="text-xs text-fg-muted">
                      {row.kind === 'invoice' ? 'Billed' : 'Earned'}
                    </TableCell>
                    <TableCell className="pl-0 text-right whitespace-nowrap">
                      {row.locked ? (
                        <Lock aria-label="This month is closed" className="inline size-3.5 text-fg-muted" />
                      ) : row.kind === 'fixed_true_up' ? (
                        <span
                          className="text-2xs text-fg-muted"
                          title="Pulse writes this row by itself when a fixed price job finishes."
                        >
                          By Pulse
                        </span>
                      ) : canRevenue ? (
                        <>
                          <IconButton
                            label={`Edit the ${REVENUE_KIND_LABELS[row.kind].toLowerCase()} of ${shortDate(row.revenueDate)}`}
                            icon={<Pencil aria-hidden />}
                            size="sm"
                            onClick={() => setRevenueDialog(row)}
                            data-testid="revenue-edit"
                          />
                          <IconButton
                            label={`Delete the ${REVENUE_KIND_LABELS[row.kind].toLowerCase()} of ${shortDate(row.revenueDate)}`}
                            icon={<Trash2 aria-hidden />}
                            size="sm"
                            data-testid="revenue-delete"
                            onClick={() =>
                              void removeWithUndo({
                                label: `the ${REVENUE_KIND_LABELS[row.kind].toLowerCase()}`,
                                hide: () => hide(row.id),
                                show: () => show(row.id),
                                remove: () => deleteRevenueAction({ id: row.id }),
                                restore: () => restoreRevenueAction({ id: row.id }),
                              })
                            }
                          />
                        </>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <Panel
        title="Extra services"
        action={
          canVas && services.length > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Plus aria-hidden />}
              onClick={() => setServiceDialog('new')}
              data-testid="service-add"
            >
              Add a service
            </Button>
          ) : undefined
        }
        bodyClassName="p-0"
      >
        {serviceRows.isError ? (
          <div className="p-4">
            <LoadError what="the extra services" onRetry={() => void serviceRows.refetch()} />
          </div>
        ) : serviceRows.isPending ? (
          <div className="flex flex-col gap-2 p-4" role="status" aria-busy="true">
            <span className="sr-only">Loading extra services</span>
            <Skeleton height={28} />
          </div>
        ) : vasRows.length === 0 ? (
          <Teach
            testId="services-empty"
            size="sm"
            icon={Sparkles}
            title="No extra services on this job"
            why="Labeling, gift wrap, rework, special packing: work sold on top of the job. Each entry carries its own revenue and its own cost, so you can see which services pay."
            actions={
              services.length === 0 ? (
                <ButtonLink href={routes.services()} variant="secondary">
                  Set up your services
                </ButtonLink>
              ) : canVas ? (
                <Button leadingIcon={<Plus aria-hidden />} onClick={() => setServiceDialog('new')}>
                  Add a service
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table aria-label="Extra service entries" data-testid="services-table">
              <TableHead>
                <TableRow className="hover:bg-transparent">
                  <TableHeaderCell>Day</TableHeaderCell>
                  <TableHeaderCell>Service</TableHeaderCell>
                  <TableHeaderCell numeric>How many</TableHeaderCell>
                  <TableHeaderCell numeric>Revenue</TableHeaderCell>
                  <TableHeaderCell numeric>Labor hours</TableHeaderCell>
                  <TableHeaderCell numeric>Cost</TableHeaderCell>
                  <TableHeaderCell numeric>Margin</TableHeaderCell>
                  <TableHeaderCell className="w-20">
                    <span className="sr-only">Actions</span>
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {vasRows.map((row) => {
                  const cost = addCents(
                    row.laborCostCents ?? 0,
                    row.materialCents ?? 0,
                    row.sharedCents ?? 0,
                  );
                  const margin =
                    row.amountCents === null
                      ? null
                      : marginBp(subCents(toCents(row.amountCents), cost), toCents(row.amountCents));
                  const name = serviceName.get(row.vasServiceId) ?? 'Service';
                  return (
                    <TableRow key={row.id} data-testid="service-row">
                      <TableCell className="whitespace-nowrap">{shortDate(row.workDate)}</TableCell>
                      <TableCell>{name}</TableCell>
                      <TableCell numeric>{formatNumber(row.quantity)}</TableCell>
                      <TableCell numeric>
                        {row.noPrice ? (
                          <span className="rounded-sm bg-[var(--label-yellow-subtle)] px-1.5 py-0.5 text-xs font-medium text-[var(--label-yellow-text)]">
                            No price set yet
                          </span>
                        ) : (
                          formatMoney(row.amountCents)
                        )}
                      </TableCell>
                      <TableCell numeric>{Number(row.hours) > 0 ? formatHours(row.hours) : ''}</TableCell>
                      <TableCell numeric>{formatMoney(cost)}</TableCell>
                      <TableCell numeric className={cn(margin !== null && margin < 0 && 'text-danger-text')}>
                        {formatPercentBp(margin, { empty: '' })}
                      </TableCell>
                      <TableCell className="pl-0 text-right whitespace-nowrap">
                        {row.locked ? (
                          <Lock aria-label="This month is closed" className="inline size-3.5 text-fg-muted" />
                        ) : canVas ? (
                          <>
                            <IconButton
                              label={`Edit ${name} of ${shortDate(row.workDate)}`}
                              icon={<Pencil aria-hidden />}
                              size="sm"
                              onClick={() => setServiceDialog(row)}
                            />
                            <IconButton
                              label={`Delete ${name} of ${shortDate(row.workDate)}`}
                              icon={<Trash2 aria-hidden />}
                              size="sm"
                              data-testid="service-delete"
                              onClick={() =>
                                void removeWithUndo({
                                  label: `the ${name} entry`,
                                  hide: () => hide(row.id),
                                  show: () => show(row.id),
                                  remove: () => deleteVasEntryAction({ id: row.id }),
                                  restore: () => restoreVasEntryAction({ id: row.id }),
                                })
                              }
                            />
                          </>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      {revenueDialog ? (
        <RevenueDialog
          key={revenueDialog === 'new' ? 'new' : revenueDialog.id}
          job={job}
          row={revenueDialog === 'new' ? null : revenueDialog}
          today={today}
          open
          onOpenChange={(open) => (open ? undefined : setRevenueDialog(null))}
          onSaved={refresh}
        />
      ) : null}
      {serviceDialog ? (
        <ServiceDialog
          key={serviceDialog === 'new' ? 'new' : serviceDialog.id}
          job={job}
          row={serviceDialog === 'new' ? null : serviceDialog}
          today={today}
          open
          onOpenChange={(open) => (open ? undefined : setServiceDialog(null))}
          onSaved={refresh}
          services={services}
          laborClasses={laborClasses}
        />
      ) : null}
      {priceOpen ? (
        <PriceDialog
          job={job}
          today={today}
          open
          onOpenChange={(open) => (open ? undefined : setPriceOpen(false))}
          onSaved={refresh}
        />
      ) : null}
    </div>
  );
}
