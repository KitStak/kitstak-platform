'use client';
/**
 * "Customer 360" card for the project Overview: the live CRM picture (headline deal with stage,
 * value, close date and owner, the customer's contacts, last touch) and the live WMS picture
 * (SKUs received, open orders, shipped this week, the receipt to watch, inventory exceptions)
 * for the customer this project serves, plus risks that only show up across apps ("Deal close
 * date is Nov 30 but 3 open tasks are due after it"). Every number deep links into its app.
 *
 * Read from the shared database on every view and refetched when the window regains focus.
 * Hidden when the project has no linked customer, account or deal. A connected app with nothing
 * linked yet offers the action that fixes it ("Link the CRM deal", "Connect WMS client").
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  CalendarClock,
  Link2,
  MessageSquareText,
  PackageCheck,
  PackageOpen,
  RefreshCw,
  Truck,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Avatar, Button, IconButton, Skeleton, Tooltip, cn } from '@/components/ui';
import { buttonVariants } from '@/components/ui/button';
import { apiGet, apiPath } from '@/lib/api-client';
import { diffDays, formatRelative, todayIso } from '@/lib/dates';
import { qk } from '@/lib/query-keys';
import type { IntegrationTargetType } from '@/lib/constants';
import type { Customer360, Customer360Contact, Customer360Deal, Customer360Risk } from '@/server/integrations/customer360';
import { LinkRecordDialog } from './link-record-dialog';
import { RecordStatus, SiblingAppMark } from './record-chip';

export const customer360Key = (projectKey: string) => ['project', projectKey, 'customer-360'] as const;

export function useCustomer360(projectKey: string, options: { readonly enabled?: boolean } = {}) {
  return useQuery({
    queryKey: customer360Key(projectKey),
    queryFn: () => apiGet<Customer360>(apiPath(`projects/${encodeURIComponent(projectKey)}/customer-360`)),
    staleTime: 30_000,
    refetchOnWindowFocus: 'always',
    refetchInterval: 120_000,
    enabled: options.enabled ?? true,
  });
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      notation: amount >= 100_000 ? 'compact' : 'standard',
      maximumFractionDigits: amount >= 100_000 ? 1 : 0,
    }).format(amount);
  } catch {
    return `${Math.round(amount).toLocaleString()} ${currency}`;
  }
}

function dayLabel(iso: string): string {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });
}

/** "in 17 days", "today", "12 days ago" for a yyyy-mm-dd close date. */
function closeHint(closeDate: string): { text: string; past: boolean } {
  const days = diffDays(todayIso(), closeDate);
  if (days === 0) return { text: 'today', past: false };
  if (days > 0) return { text: days === 1 ? 'tomorrow' : `in ${days} days`, past: false };
  return { text: days === -1 ? 'yesterday' : `${-days} days ago`, past: true };
}

const external = { target: '_blank', rel: 'noopener noreferrer' } as const;

function Metric({
  label,
  value,
  hint,
  href,
  tone = 'default',
  icon,
  testId,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly hint?: ReactNode;
  readonly href?: string | null;
  readonly tone?: 'default' | 'warning' | 'danger' | 'success';
  readonly icon?: ReactNode;
  readonly testId?: string;
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span
        className={cn(
          'truncate text-lg leading-tight font-semibold tabular-nums',
          tone === 'warning'
            ? 'text-warning-text'
            : tone === 'danger'
              ? 'text-danger-text'
              : tone === 'success'
                ? 'text-success-text'
                : 'text-fg',
        )}
      >
        {value}
      </span>
      {hint ? <span className="line-clamp-2 text-xs text-fg-muted">{hint}</span> : null}
    </>
  );
  const className = 'group/metric relative flex min-w-0 flex-col gap-0.5 rounded-md px-2.5 py-2';
  return href ? (
    <a href={href} {...external} className={cn(className, 'outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus')} data-testid={testId}>
      {body}
      <ArrowUpRight aria-hidden className="absolute top-2 right-2 size-3 text-icon opacity-0 transition-opacity group-hover/metric:opacity-100" />
    </a>
  ) : (
    <div className={className} data-testid={testId}>
      {body}
    </div>
  );
}

function StripHeading({ app, label, href, linkLabel }: { readonly app: 'crm' | 'wms'; readonly label: string; readonly href?: string | null; readonly linkLabel: string }) {
  return (
    <div className="flex items-center gap-2 px-2.5">
      <SiblingAppMark app={app} size={14} />
      <h3 className="text-xs font-semibold tracking-[0.06em] text-fg-secondary uppercase">{label}</h3>
      {href ? (
        <a href={href} {...external} className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-fg-secondary hover:bg-hover hover:text-fg">
          {linkLabel}
          <ArrowUpRight aria-hidden className="size-3" />
        </a>
      ) : null}
    </div>
  );
}

function ContactAvatars({ contacts }: { readonly contacts: readonly Customer360Contact[] }) {
  if (contacts.length === 0) return null;
  const shown = contacts.slice(0, 5);
  const more = contacts.length - shown.length;
  return (
    <div className="flex items-center gap-2 px-2.5" data-testid="c360-contacts">
      <span className="text-xs text-fg-muted">Contacts</span>
      <ul className="flex items-center -space-x-1.5">
        {shown.map((contact) => (
          <li key={contact.id}>
            <Tooltip content={[contact.name, contact.title, contact.email].filter(Boolean).join(' · ')}>
              <a
                href={contact.url}
                {...external}
                aria-label={`${contact.name}${contact.title ? `, ${contact.title}` : ''}. Opens in CRM`}
                className="block rounded-full ring-2 ring-panel outline-none hover:z-10 hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-focus"
                data-testid="c360-contact"
              >
                <Avatar name={contact.name} size="sm" decorative />
              </a>
            </Tooltip>
          </li>
        ))}
      </ul>
      {more > 0 ? <span className="text-xs text-fg-muted">+{more}</span> : null}
      {shown.length === 1 ? <span className="truncate text-xs text-fg-secondary">{shown[0]?.name}</span> : null}
    </div>
  );
}

function DealRow({ deal, currency }: { readonly deal: Customer360Deal; readonly currency: string }) {
  return (
    <li>
      <a href={deal.url} {...external} className="group/deal flex min-h-8 items-center gap-2 rounded-md px-2.5 py-1 text-sm hover:bg-hover" data-testid="c360-deal">
        <span className="min-w-0 flex-1 truncate text-fg-secondary">{deal.name}</span>
        <RecordStatus status={deal.stage} />
        <span className="w-16 shrink-0 text-right text-xs text-fg-secondary tabular-nums">
          {deal.amount !== null ? money(deal.amount, deal.currency ?? currency) : 'No value'}
        </span>
      </a>
    </li>
  );
}

function EmptyAction({
  app,
  text,
  action,
}: {
  readonly app: 'crm' | 'wms';
  readonly text: string;
  readonly action: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border-default px-3 py-3" data-testid={`c360-empty-${app}`}>
      <p className="text-sm text-fg-secondary">{text}</p>
      {action}
    </div>
  );
}

function CrmStrip({
  data,
  canEdit,
  onLink,
}: {
  readonly data: Customer360;
  readonly canEdit: boolean;
  readonly onLink: (type: IntegrationTargetType) => void;
}) {
  const crm = data.crm;
  const deal = crm?.headline ?? null;
  if (!crm || !deal) {
    const who = data.account?.name ?? data.customer?.name ?? 'this customer';
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <StripHeading app="crm" label="CRM" href={data.account?.url ?? data.urls.crm} linkLabel={data.account ? 'Open account in CRM' : 'Open CRM'} />
        <EmptyAction
          app="crm"
          text={
            data.crmReady
              ? `No CRM deal is linked to this project yet. Link the deal for ${who} to see its stage, value, close date and contacts here.`
              : `Your CRM has no deals pipeline yet. Set one up from a template, then link the deal for ${who} to see its stage, value and contacts here.`
          }
          action={
            !data.crmReady ? (
              <a
                href={data.urls.crmTemplates}
                {...external}
                className={buttonVariants({ size: 'sm', variant: 'secondary' })}
                data-testid="c360-setup-crm"
              >
                <SiblingAppMark app="crm" />
                Set up CRM
                <ArrowUpRight aria-hidden />
              </a>
            ) : canEdit ? (
              <Button size="sm" variant="secondary" onClick={() => onLink('crm_item')} data-testid="c360-link-deal">
                <Link2 aria-hidden />
                Link the CRM deal
              </Button>
            ) : (
              <a href={data.urls.crm} {...external} className="text-sm font-medium text-primary-text hover:underline">
                Open CRM
              </a>
            )
          }
        />
      </div>
    );
  }
  const hint = deal.closeDate ? closeHint(deal.closeDate) : null;
  const others = crm.deals.filter((entry) => entry.id !== deal.id);
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="c360-crm">
      <StripHeading app="crm" label="CRM" href={data.account?.url} linkLabel="Open account in CRM" />
      <a href={deal.url} {...external} className="group/headline flex min-w-0 items-center gap-2 rounded-md px-2.5 py-1 hover:bg-hover" data-testid="c360-deal-name">
        <span className="min-w-0 truncate text-md font-semibold text-fg">{deal.name}</span>
        {deal.linked ? <span className="shrink-0 rounded-sm bg-primary-subtle px-1.5 py-px text-2xs font-semibold text-primary-text">This project</span> : null}
        <ArrowUpRight aria-hidden className="size-3.5 shrink-0 text-icon opacity-0 transition-opacity group-hover/headline:opacity-100" />
      </a>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        <Metric
          label="Stage"
          value={deal.stage ? <RecordStatus status={deal.stage} className="text-sm" /> : 'No stage'}
          hint={deal.probability !== null && deal.outcome === 'open' ? `${deal.probability}% likely` : null}
          href={deal.url}
          testId="c360-stage"
        />
        <Metric
          label="Value"
          value={deal.amount !== null ? money(deal.amount, deal.currency ?? crm.currency) : 'Not set'}
          hint={crm.openPipeline > 0 && others.length ? `${money(crm.openPipeline, crm.currency)} open pipeline` : null}
          href={deal.url}
          tone={deal.outcome === 'won' ? 'success' : 'default'}
          testId="c360-value"
        />
        <Metric
          label="Close date"
          icon={<CalendarClock aria-hidden className="size-3" />}
          value={deal.closeDate ? dayLabel(deal.closeDate) : 'Not set'}
          hint={deal.outcome !== 'open' ? 'Closed' : hint ? (hint.past ? `${hint.text}, still open` : hint.text) : null}
          tone={hint?.past && deal.outcome === 'open' ? 'warning' : 'default'}
          href={deal.url}
          testId="c360-close"
        />
        <div className="flex min-w-0 flex-col gap-0.5 rounded-md px-2.5 py-2" data-testid="c360-owner">
          <span className="text-xs font-medium text-fg-muted">Owner</span>
          {deal.owner ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <Avatar name={deal.owner.name} src={deal.owner.image ?? undefined} size="xs" decorative />
              <span className="truncate text-sm font-medium text-fg">{deal.owner.name}</span>
            </span>
          ) : (
            <span className="text-sm text-fg-muted">No owner</span>
          )}
        </div>
      </div>
      <ContactAvatars contacts={crm.contacts} />
      {deal.nextStep || crm.lastTouch ? (
        <ul className="flex flex-col gap-1 px-2.5 text-xs text-fg-secondary">
          {deal.nextStep ? (
            <li className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 font-semibold text-fg-muted">Next step</span>
              <span className="truncate">{deal.nextStep}</span>
            </li>
          ) : null}
          {crm.lastTouch ? (
            <li className="flex min-w-0 items-center gap-1.5" data-testid="c360-last-touch">
              <MessageSquareText aria-hidden className="size-3 shrink-0 text-icon" />
              <span className="shrink-0">
                Last touch {formatRelative(crm.lastTouch.at)}
                {crm.lastTouch.by ? ` by ${crm.lastTouch.by}` : ''}
              </span>
              {crm.lastTouch.text ? <span className="truncate text-fg-muted">{crm.lastTouch.text}</span> : null}
            </li>
          ) : null}
        </ul>
      ) : null}
      {others.length > 0 ? (
        <div className="flex flex-col gap-0.5 border-t border-border-subtle pt-2">
          <span className="px-2.5 text-2xs font-semibold tracking-[0.06em] text-fg-muted uppercase">Other deals</span>
          <ul className="flex flex-col" aria-label="Other deals">
            {others.slice(0, 3).map((entry) => (
              <DealRow key={entry.id} deal={entry} currency={crm.currency} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function WmsStrip({
  data,
  canEdit,
  onLink,
}: {
  readonly data: Customer360;
  readonly canEdit: boolean;
  readonly onLink: (type: IntegrationTargetType) => void;
}) {
  const wms = data.wms;
  if (!wms) {
    const name = data.customer?.name;
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <StripHeading app="wms" label="Warehouse" href={data.urls.wms} linkLabel="Open WMS" />
        <EmptyAction
          app="wms"
          text={
            name
              ? `${name} is not set up as a client in WMS yet. Connect the client to see receipts, orders and shipments here.`
              : 'No WMS client is connected to this project yet. Connect the customer to see receipts, orders and shipments here.'
          }
          action={
            name ? (
              <a href={`${data.urls.wms}/clients`} {...external} className={buttonVariants({ variant: 'secondary', size: 'sm' })} data-testid="c360-connect-wms">
                <SiblingAppMark app="wms" size={14} />
                Connect WMS client
              </a>
            ) : canEdit ? (
              <Button size="sm" variant="secondary" onClick={() => onLink('core_customer')} data-testid="c360-connect-wms">
                <Link2 aria-hidden />
                Connect WMS client
              </Button>
            ) : null
          }
        />
      </div>
    );
  }
  const receipt = wms.lastReceipt;
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="c360-wms">
      <StripHeading app="wms" label="Warehouse" href={wms.clientUrl} linkLabel="Open client in WMS" />
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        <Metric
          label="SKUs received"
          icon={<Boxes aria-hidden className="size-3" />}
          value={wms.skusReceived30}
          hint="Last 30 days"
          href={wms.receivedUrl}
          testId="c360-skus"
        />
        <Metric
          label="Open orders"
          icon={<PackageOpen aria-hidden className="size-3" />}
          value={wms.openOrders}
          hint={wms.openReceipts ? `${wms.openReceipts} receipt${wms.openReceipts === 1 ? '' : 's'} open` : 'No receipts open'}
          href={wms.ordersUrl}
          testId="c360-open-orders"
        />
        <Metric
          label="Shipped, 7 days"
          icon={<Truck aria-hidden className="size-3" />}
          value={wms.shippedLast7}
          hint={wms.lastShippedAt ? `Last ${formatRelative(wms.lastShippedAt)}` : 'Nothing shipped yet'}
          href={wms.shippedUrl}
          testId="c360-shipped"
        />
        <Metric
          label="Exceptions"
          icon={<AlertTriangle aria-hidden className="size-3" />}
          value={wms.exceptions === 0 ? 'None' : wms.exceptions}
          hint={wms.exceptions === 0 ? 'Inventory is clear' : 'Shortages and holds'}
          href={wms.exceptionsUrl}
          tone={wms.exceptions > 0 ? 'danger' : 'success'}
          testId="c360-exceptions"
        />
      </div>
      {receipt ? (
        <a
          href={receipt.url}
          {...external}
          className="group/receipt flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2.5 py-1.5 text-sm hover:bg-hover"
          data-testid="c360-receipt"
        >
          <PackageCheck aria-hidden className="size-3.5 shrink-0 text-icon" />
          <span className="shrink-0 text-xs text-fg-muted">{receipt.late ? 'Late receipt' : 'Latest receipt'}</span>
          <span className="shrink-0 font-medium text-fg tabular-nums slashed-zero">{receipt.code}</span>
          <RecordStatus status={receipt.status} />
          <span className={cn('min-w-0 truncate text-xs', receipt.late ? 'font-medium text-warning-text' : 'text-fg-muted')}>
            {receipt.receivedAt
              ? `Received ${dayLabel(receipt.receivedAt)}`
              : receipt.expectedAt
                ? `${receipt.late ? 'Was due' : 'Due'} ${dayLabel(receipt.expectedAt)}`
                : null}
          </span>
          <ArrowUpRight aria-hidden className="ml-auto size-3.5 shrink-0 text-icon opacity-0 transition-opacity group-hover/receipt:opacity-100" />
        </a>
      ) : null}
    </div>
  );
}

function RiskList({ risks }: { readonly risks: readonly Customer360Risk[] }) {
  if (risks.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 border-b border-border-subtle bg-warning-subtle/40 px-4 py-2" aria-label="Risks from other apps" data-testid="c360-risks">
      {risks.map((risk) => (
        <li key={risk.id} className="flex min-w-0 items-start gap-2 text-sm">
          <AlertTriangle aria-hidden className={cn('mt-0.5 size-3.5 shrink-0', risk.tone === 'danger' ? 'text-danger-text' : 'text-warning-text')} />
          <span className="min-w-0 flex-1 text-fg" data-testid="c360-risk">
            {risk.text}
          </span>
          {risk.href ? (
            <a href={risk.href} {...external} className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-fg-secondary hover:bg-hover hover:text-fg">
              <SiblingAppMark app={risk.app} size={11} />
              {risk.app === 'crm' ? 'Open in CRM' : 'Open in WMS'}
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function Customer360Strip({
  projectKey,
  projectId,
  canEdit = false,
}: {
  readonly projectKey: string;
  /** Needed for the "Link the CRM deal" / "Connect WMS client" actions. */
  readonly projectId?: string;
  readonly canEdit?: boolean;
}) {
  const query = useCustomer360(projectKey);
  const queryClient = useQueryClient();
  const [linking, setLinking] = useState<IntegrationTargetType | null>(null);
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
  // Hidden when the project serves no known customer (no customer, account or deal linked).
  if (!data || (!data.customer && !data.account && !data.crm)) return null;
  if (!data.available.crm && !data.available.wms) return null;
  const name = data.customer?.name ?? data.account?.name ?? data.crm?.headline?.name ?? 'Customer';
  const editable = canEdit && Boolean(projectId);
  const sources = [data.available.crm ? 'CRM' : null, data.available.wms ? 'warehouse' : null].filter(Boolean).join(' and ');

  return (
    <section aria-labelledby="c360-title" className="overflow-hidden rounded-xl border border-border-subtle bg-panel shadow-xs lg:col-span-2" data-testid="customer-360">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle px-4 py-3">
        <h2 id="c360-title" className="flex min-w-0 items-center gap-2 text-md font-semibold text-fg">
          <span className="truncate">{name}</span>
          {data.customer ? (
            <span className="shrink-0 rounded-sm bg-sunken px-1.5 py-px text-2xs font-semibold tracking-[0.08em] text-fg-secondary">{data.customer.code}</span>
          ) : null}
        </h2>
        <span className="flex items-center gap-1.5 text-xs text-fg-muted">
          <span aria-hidden className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:hidden" />
            <span className="relative inline-flex size-1.5 rounded-full bg-success" />
          </span>
          Customer 360 · live from your {sources}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <span className="hidden text-xs text-fg-muted sm:inline">Updated {formatRelative(data.checkedAt)}</span>
          <IconButton
            size="sm"
            label={`Refresh. Updated ${formatRelative(data.checkedAt)}, and again whenever you come back to this tab`}
            icon={<RefreshCw aria-hidden className={cn(query.isFetching && 'animate-spin')} />}
            onClick={() => void query.refetch()}
            data-testid="c360-refresh"
          />
        </span>
      </header>
      <RiskList risks={data.risks} />
      <div
        className={cn(
          'grid gap-4 p-3',
          data.available.crm && data.available.wms && 'md:grid-cols-2 md:divide-x md:divide-border-subtle [&>*+*]:md:pl-4',
        )}
      >
        {data.available.crm ? <CrmStrip data={data} canEdit={editable} onLink={setLinking} /> : null}
        {data.available.wms ? <WmsStrip data={data} canEdit={editable} onLink={setLinking} /> : null}
      </div>
      {projectId ? (
        <LinkRecordDialog
          open={linking !== null}
          onOpenChange={(open) => {
            if (!open) setLinking(null);
          }}
          owner={{ projectId }}
          initialType={linking ?? undefined}
          onLinked={() => {
            void queryClient.invalidateQueries({ queryKey: customer360Key(projectKey) });
            void queryClient.invalidateQueries({ queryKey: qk.project(projectKey) });
          }}
        />
      ) : null}
    </section>
  );
}
