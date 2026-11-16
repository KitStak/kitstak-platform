'use client';
/** "Warehouse (WMS)" card on the account 360 page: link the account to a core customer. */
import { useState } from 'react';
import { Link2, Unlink, Warehouse } from 'lucide-react';
import { Button, Combobox, cn } from '@/components/ui';
import type { CoreCustomerDto, WmsOpsPeekDto } from '@/server/services/wms-link-contracts';
import { useSetWmsLink, useWmsCustomers, useWmsLink } from '../api';
import { CardSkeleton, CrmCard, ErrorBlock } from '../components/crm-ui';

function StatusChip({ status }: { readonly status: string }) {
  const active = status.toLowerCase() === 'active';
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full px-2 text-xs font-semibold',
        active ? 'bg-success-subtle text-success-text' : 'bg-muted text-fg-muted',
      )}
    >
      {status}
    </span>
  );
}

const COUNT_FORMAT = new Intl.NumberFormat('en-US');

function LinkedCustomer({
  customer,
  ops,
  onUnlink,
  busy,
}: {
  readonly customer: CoreCustomerDto;
  readonly ops: WmsOpsPeekDto | null;
  readonly onUnlink: () => void;
  readonly busy: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-2 py-2">
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary-text">
        <Warehouse aria-hidden className="size-4.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-base font-medium text-fg" title={customer.name}>
            {customer.name}
          </span>
          <StatusChip status={customer.status} />
        </span>
        <span className="truncate text-xs text-fg-muted" title={customer.code}>
          Client code {customer.code}
        </span>
        {/* The ops row wraps rather than truncates: the counts are its point on phones. */}
        {ops ? (
          <span className="text-xs text-fg-secondary tabular-nums" data-testid="crm-wms-ops">
            Open orders {COUNT_FORMAT.format(ops.openOrders)} · On hand{' '}
            {COUNT_FORMAT.format(ops.onHandUnits)} units
          </span>
        ) : null}
      </span>
      <Button
        variant="ghost"
        size="sm"
        leadingIcon={<Unlink aria-hidden />}
        onClick={onUnlink}
        disabled={busy}
        data-testid="crm-wms-unlink"
      >
        Unlink
      </Button>
    </div>
  );
}

function LinkPicker({ onLink, busy }: { readonly onLink: (coreCustomerId: string) => void; readonly busy: boolean }) {
  const customers = useWmsCustomers(true);
  const [selected, setSelected] = useState<string | null>(null);
  const options = (customers.data ?? []).map((customer) => ({
    value: customer.id,
    label: customer.name,
    description: `${customer.code} · ${customer.status}`,
    keywords: [customer.code],
  }));
  return (
    <div className="flex flex-col gap-2.5 px-2 py-2">
      <p className="text-sm text-fg-muted">Not linked to a WMS client yet.</p>
      <div className="flex items-center gap-2">
        <Combobox
          aria-label="WMS client"
          value={selected}
          onValueChange={setSelected}
          options={options}
          placeholder="Search WMS clients…"
          searchPlaceholder="Search by name or code…"
          emptyMessage={customers.isPending ? 'Loading clients…' : 'No WMS clients match'}
          disabled={busy || customers.isError}
          className="min-w-0 flex-1"
        />
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={<Link2 aria-hidden />}
          disabled={!selected || busy}
          onClick={() => selected && onLink(selected)}
          data-testid="crm-wms-link"
        >
          Link
        </Button>
      </div>
      {customers.isError ? <p className="text-xs text-danger-text">Couldn’t load WMS clients. Try again later.</p> : null}
    </div>
  );
}

export function WmsCard({ itemId }: { readonly itemId: string }) {
  const query = useWmsLink(itemId);
  const mutation = useSetWmsLink(itemId);
  return (
    <CrmCard
      id="crm-wms-card"
      testId="crm-wms-card"
      title="Warehouse (WMS)"
      description={query.data?.customer ? 'Linked WMS client' : undefined}
      bodyClassName="p-2 sm:p-3"
    >
      {query.isPending ? (
        <div className="p-2">
          <CardSkeleton rows={1} height={44} />
        </div>
      ) : query.isError ? (
        <ErrorBlock error={query.error} title="Couldn’t load the WMS link" onRetry={() => void query.refetch()} className="m-2" />
      ) : query.data.customer ? (
        <LinkedCustomer
          customer={query.data.customer}
          ops={query.data.ops ?? null}
          onUnlink={() => mutation.mutate(null)}
          busy={mutation.isPending}
        />
      ) : (
        <LinkPicker onLink={(coreCustomerId) => mutation.mutate(coreCustomerId)} busy={mutation.isPending} />
      )}
    </CrmCard>
  );
}
