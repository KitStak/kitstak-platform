'use client';
/**
 * "Customer 360" strip for the project Overview: the live CRM deal picture (stage, value, open
 * pipeline) and the live WMS picture (open orders, exceptions, receipts, recent shipments) for the
 * customer this project serves. Pulled straight from the shared database on every view and
 * refetched when the window regains focus, so it is never a stale copy.
 * Renders nothing when the project has no customer or deal and no sibling app is connected.
 */
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpRight, PackageCheck, PackageOpen, RefreshCw, Truck } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton, Skeleton, cn } from '@/components/ui';
import { apiGet, apiPath } from '@/lib/api-client';
import { formatRelative } from '@/lib/dates';
import type { Customer360, Customer360Deal } from '@/server/integrations/customer360';
import { RecordStatus, SiblingAppMark } from './record-chip';

export const customer360Key = (projectKey: string) => ['project', projectKey, 'customer-360'] as const;

export function useCustomer360(projectKey: string) {
  return useQuery({
    queryKey: customer360Key(projectKey),
    queryFn: () => apiGet<Customer360>(apiPath(`projects/${encodeURIComponent(projectKey)}/customer-360`)),
    staleTime: 30_000,
    refetchOnWindowFocus: 'always',
    refetchInterval: 120_000,
  });
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: amount >= 100_000 ? 'compact' : 'standard', maximumFractionDigits: amount >= 100_000 ? 1 : 0 }).format(amount);
  } catch {
    return `${Math.round(amount).toLocaleString()} ${currency}`;
  }
}

function Metric({
  label,
  value,
  href,
  tone = 'default',
  icon,
  testId,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly href?: string | null;
  readonly tone?: 'default' | 'warning' | 'success';
  readonly icon?: ReactNode;
  readonly testId?: string;
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-2xs font-semibold tracking-[0.06em] text-fg-muted uppercase">
        {icon}
        {label}
      </span>
      <span
        className={cn(
          'text-lg leading-tight font-semibold tabular-nums',
          tone === 'warning' ? 'text-warning-text' : tone === 'success' ? 'text-success-text' : 'text-fg',
        )}
      >
        {value}
      </span>
    </>
  );
  const className = 'group/metric flex min-w-0 flex-col gap-1 rounded-md px-3 py-2';
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn(className, 'hover:bg-hover')} data-testid={testId}>
      {body}
    </a>
  ) : (
    <div className={className} data-testid={testId}>
      {body}
    </div>
  );
}

function DealRow({ deal, currency }: { readonly deal: Customer360Deal; readonly currency: string }) {
  return (
    <li>
      <a
        href={deal.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group/deal flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-hover"
        data-testid="c360-deal"
      >
        <span className="min-w-0 flex-1 truncate font-medium text-fg">{deal.name}</span>
        {deal.linked ? <span className="shrink-0 rounded-sm bg-primary-subtle px-1.5 py-px text-2xs font-semibold text-primary-text">This project</span> : null}
        <RecordStatus status={deal.stage} />
        <span className="w-20 shrink-0 text-right text-sm text-fg-secondary tabular-nums">
          {deal.amount !== null ? money(deal.amount, deal.currency ?? currency) : 'No value'}
        </span>
        <ArrowUpRight aria-hidden className="size-3.5 shrink-0 text-icon opacity-0 transition-opacity group-hover/deal:opacity-100" />
      </a>
    </li>
  );
}

export function Customer360Strip({ projectKey }: { readonly projectKey: string }) {
  const query = useCustomer360(projectKey);
  if (query.isPending) {
    return (
      <section aria-busy="true" aria-label="Loading customer" className="rounded-xl border border-border-subtle bg-panel p-4 shadow-xs lg:col-span-2">
        <Skeleton width={180} height={14} />
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} height={44} rounded="md" />
          ))}
        </div>
      </section>
    );
  }
  const data = query.data;
  if (!data || (!data.crm && !data.wms && !data.customer)) return null;
  const name = data.customer?.name ?? data.account?.name ?? data.crm?.deals[0]?.name ?? 'Customer';
  const crm = data.crm;
  const wms = data.wms;
  const headline = crm?.deals.find((deal) => deal.linked) ?? crm?.deals[0];

  return (
    <section
      aria-labelledby="c360-title"
      className="rounded-xl border border-border-subtle bg-panel shadow-xs lg:col-span-2"
      data-testid="customer-360"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle px-4 py-3">
        <h2 id="c360-title" className="flex min-w-0 items-center gap-2 text-md font-semibold text-fg">
          <span className="truncate">{name}</span>
          {data.customer ? <span className="shrink-0 rounded-sm bg-sunken px-1.5 py-px text-2xs font-semibold tracking-[0.08em] text-fg-secondary">{data.customer.code}</span> : null}
        </h2>
        <span className="text-xs text-fg-muted">Customer 360 · live from your CRM and warehouse</span>
        <span className="ml-auto flex items-center gap-1">
          {data.account ? (
            <a href={data.account.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-fg-secondary hover:bg-hover hover:text-fg">
              <SiblingAppMark app="crm" size={12} /> Account
            </a>
          ) : null}
          {wms ? (
            <a href={wms.clientUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-fg-secondary hover:bg-hover hover:text-fg">
              <SiblingAppMark app="wms" size={12} /> Client
            </a>
          ) : null}
          <IconButton
            size="sm"
            label={`Refresh. Updated ${formatRelative(data.checkedAt)}, and again whenever you come back to this tab`}
            icon={<RefreshCw aria-hidden className={cn(query.isFetching && 'animate-spin')} />}
            onClick={() => void query.refetch()}
            data-testid="c360-refresh"
          />
        </span>
      </header>
      <div className="grid gap-4 p-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        {crm ? (
          <div className="flex min-w-0 flex-col gap-2">
            <div className="grid grid-cols-3 gap-1">
              <Metric
                label="Deal stage"
                value={headline?.stage ?? 'No stage'}
                href={headline?.url}
                icon={<SiblingAppMark app="crm" size={11} />}
                tone={headline?.outcome === 'won' ? 'success' : 'default'}
                testId="c360-stage"
              />
              <Metric label="Open pipeline" value={money(crm.openPipeline, crm.currency)} testId="c360-pipeline" />
              <Metric label="Won" value={money(crm.wonValue, crm.currency)} tone={crm.wonValue > 0 ? 'success' : 'default'} testId="c360-won" />
            </div>
            {crm.deals.length > 0 ? (
              <ul className="flex flex-col" aria-label="Deals">
                {crm.deals.map((deal) => (
                  <DealRow key={deal.id} deal={deal} currency={crm.currency} />
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {wms ? (
          <div className="grid min-w-0 grid-cols-2 content-start gap-1">
            <Metric label="Open orders" value={wms.openOrders} href={wms.ordersUrl} icon={<PackageOpen aria-hidden className="size-3" />} testId="c360-open-orders" />
            <Metric
              label="Exceptions"
              value={wms.exceptions}
              href={wms.ordersUrl}
              tone={wms.exceptions > 0 ? 'warning' : 'default'}
              icon={<AlertTriangle aria-hidden className="size-3" />}
              testId="c360-exceptions"
            />
            <Metric label="Receipts in progress" value={wms.openReceipts} href={wms.receiptsUrl} icon={<PackageCheck aria-hidden className="size-3" />} testId="c360-receipts" />
            <Metric
              label="Shipped, 30 days"
              value={wms.shippedLast30}
              href={wms.shippedUrl}
              icon={<Truck aria-hidden className="size-3" />}
              testId="c360-shipped"
            />
            {wms.lastShippedAt ? <p className="col-span-2 px-3 text-xs text-fg-muted">Last shipment {formatRelative(wms.lastShippedAt)}</p> : null}
          </div>
        ) : data.customer ? (
          <p className="self-center px-3 text-sm text-fg-secondary">No warehouse activity for {data.customer.name} yet.</p>
        ) : null}
      </div>
    </section>
  );
}
