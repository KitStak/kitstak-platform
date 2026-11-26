'use client';
/**
 * Money in: what the job has earned, what has been billed and what is not billed yet; the price
 * and its history ("From which day?"); invoices, fees, corrections and credits; and the extra
 * services with their own revenue, cost and margin.
 */
import { useMemo, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import {
  Button,
  IconButton,
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
import { ProgramPricePanel } from './job-program';
import { RevenueLedger } from '@/features/revenue/revenue-ledger';
import { ServiceLedger } from '@/features/revenue/service-ledger';
import { useShell } from '@/features/shell/shell-context';
import { PRICING_MODEL_LABELS } from '@/lib/constants';
import { formatMoney, formatMoneyPerHour, formatUnitPrice } from '@/lib/format';
import { shortDate } from '@/lib/profit/calendar';
import { deleteJobPriceAction } from '@/server/actions/jobs';
import { PriceDialog } from './forms/job-dialogs';
import { useJobDaily, useRefreshJob } from './job-data';
import { singularUnit } from './job-math';
import type { JobTabProps } from './job-overview';
import { Explain, LoadError } from './job-ui';

export function JobMoneyIn({ job, today, program = null }: JobTabProps) {
  const shell = useShell();
  const refresh = useRefreshJob();
  const canRevenue = shell.can('revenue:manage');
  const unit = singularUnit(job.unitLabel);
  const stats = job.stats;
  const daily = useJobDaily(job.number);
  const [priceOpen, setPriceOpen] = useState(false);
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
          explain={
            <Explain
              title="Billed"
              rule="Every approved invoice on this job, added up. Billing is a record only. Profit comes from what the work earned, not from what was billed."
              rows={[
                { label: 'Approved invoices', value: formatMoney(stats.billedCents), kind: 'total' },
                { label: 'Earned so far', value: formatMoney(stats.revenueCents), kind: 'note' },
              ]}
            />
          }
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

      {job.program ? (
        <ProgramPricePanel job={job} program={program} />
      ) : (
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
      )}

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

      <div id="invoices" className="scroll-mt-24">
        <RevenueLedger jobId={job.id} today={today} />
      </div>
      <div id="extra-services" className="scroll-mt-24">
        <ServiceLedger jobId={job.id} today={today} title="Extra services" />
      </div>

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
