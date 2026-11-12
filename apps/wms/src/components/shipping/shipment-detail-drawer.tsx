'use client';

/**
 * Package detail drawer (KitStaks addition): label facts, packed items and every package
 * of the same multi-package shipment, with the same actions as the row menu.
 */
import Link from 'next/link';
import * as React from 'react';
import { Download, ExternalLink, Printer, RefreshCw, XCircle } from 'lucide-react';
import { useApiQuery } from '@/lib/query-client';
import { formatGridDateTime as formatDateTime } from '@/lib/format';
import { Button, buttonVariants } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { DisabledReason } from '@/components/ui/tooltip';
import { KvList } from '@/components/shared/kv-list';
import { StatusPill } from '@/components/ui/status-pill';
import type { ShipmentDetail } from '@/server/repositories/shipping';
import { LabelStatusPill, LabelTypePill } from './column-kit';
import type { ShipmentRow } from './shipments-columns';

export interface ShipmentActions {
  readonly onDownload: (row: ShipmentRow) => void;
  readonly onReprint: (row: ShipmentRow) => void;
  readonly onVoid: (row: ShipmentRow) => void;
  readonly canVoid: boolean;
  readonly canReprint: boolean;
  readonly canTrack?: boolean;
  readonly onRefreshTracking?: (row: ShipmentRow) => Promise<void>;
}

const MODE_NOTE: Readonly<Record<string, string>> = {
  live: 'Live carrier API (Production connection).',
  'carrier-test': "Carrier's own test API (Test connection with carrier credentials).",
  simulated:
    "Offline simulation: this connection has no carrier credentials, so calls are validated and answered locally. Add the carrier's test credentials on the carrier setup to call the real test API.",
};

function pretty(json: string | null): string {
  if (!json) return '';
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

type Detail = ShipmentDetail & ShipmentRow;

const money = (v: unknown, currency: unknown) =>
  typeof v === 'number' ? `${v.toFixed(2)} ${String(currency ?? 'USD')}` : null;
const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const STEP_LABEL: Readonly<Record<string, string>> = {
  LabelGeneration: 'Label created',
  VoidLabel: 'Label voided',
  RateCall: 'Rate request',
  Tracking: 'Tracking update',
  Pickup: 'Pickup scheduled',
};
const STEP_ERROR_LABEL: Readonly<Record<string, string>> = {
  LabelGeneration: 'Label request',
  VoidLabel: 'Void request',
  RateCall: 'Rate request',
  Tracking: 'Tracking request',
  Pickup: 'Pickup request',
};

function Body({ d, actions }: { readonly d: Detail; readonly actions: ShipmentActions }) {
  const [tracking, setTracking] = React.useState(false);
  const trackReason = !actions.canTrack
    ? "You don't have permission to refresh tracking"
    : d.labelStatus === 'Voided'
      ? 'Voided labels have no tracking'
      : null;
  const voidReason = !actions.canVoid ? "You don't have permission to void labels" : d.voidBlockedReason;
  const reprintReason = !actions.canReprint
    ? "You don't have permission to reprint labels"
    : d.labelStatus === 'Voided'
      ? "Voided labels can't be reprinted"
      : !d.labelFileId
        ? 'No label file is stored for this package'
        : null;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <LabelTypePill type={d.labelType} />
        <LabelStatusPill status={d.labelStatus} />
        <StatusPill status={d.orderStatus} domain="shipmentOrder" />
      </div>
      <div className="flex flex-wrap gap-2">
        <DisabledReason reason={reprintReason}>
          <Button variant="secondary" disabled={Boolean(reprintReason)} onClick={() => actions.onDownload(d)}>
            <Download className="h-3.5 w-3.5" aria-hidden />
            Download label
          </Button>
        </DisabledReason>
        <DisabledReason reason={reprintReason}>
          <Button variant="secondary" disabled={Boolean(reprintReason)} onClick={() => actions.onReprint(d)}>
            <Printer className="h-3.5 w-3.5" aria-hidden />
            Reprint
          </Button>
        </DisabledReason>
        {actions.onRefreshTracking ? (
          <DisabledReason reason={trackReason}>
            <Button
              variant="secondary"
              disabled={Boolean(trackReason) || tracking}
              onClick={async () => {
                setTracking(true);
                try {
                  await actions.onRefreshTracking?.(d);
                } finally {
                  setTracking(false);
                }
              }}
            >
              <RefreshCw className={tracking ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} aria-hidden />
              Refresh tracking
            </Button>
          </DisabledReason>
        ) : null}
        {d.trackingUrl ? (
          <a
            className={buttonVariants({ variant: 'secondary' })}
            href={d.trackingUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            Track
          </a>
        ) : null}
        <DisabledReason reason={voidReason}>
          <Button
            variant={voidReason ? 'secondary' : 'danger'}
            disabled={Boolean(voidReason)}
            onClick={() => actions.onVoid(d)}
          >
            <XCircle className="h-3.5 w-3.5" aria-hidden />
            Void label
          </Button>
        </DisabledReason>
      </div>
      <section className="rounded-lg border border-border p-4">
        <h3 className="mb-3 text-sm font-semibold">Label</h3>
        <KvList
          items={[
            {
              key: 'order',
              label: 'Order',
              value: (
                <Link
                  className="text-primary hover:underline"
                  href={`/orders/${encodeURIComponent(d.orderCode)}`}
                >
                  {d.orderCode}
                </Link>
              ),
            },
            { key: 'carrier', label: 'Carrier', value: d.carrier },
            { key: 'service', label: 'Shipment method', value: d.serviceName as string },
            {
              key: 'tracking',
              label: 'Tracking number',
              value: <span className="font-mono">{d.trackingNumber}</span>,
            },
            {
              key: 'master',
              label: 'Master tracking number',
              value: d.masterTrackingNumber ? (
                <span className="font-mono">{d.masterTrackingNumber}</span>
              ) : null,
            },
            { key: 'created', label: 'Label create date', value: formatDateTime(d.labelCreatedAt) },
            {
              key: 'shipped',
              label: 'Actual shipment date',
              value: d.actualShipmentAt ? formatDateTime(d.actualShipmentAt) : null,
            },
            {
              key: 'voided',
              label: 'Void date/time',
              value: d.voidedAt ? formatDateTime(d.voidedAt as string) : null,
            },
            { key: 'rate', label: 'Rate', value: money(d.rate, d.currency) },
            { key: 'cost', label: 'Shipping cost', value: money(d.shippingCost, d.currency) },
            {
              key: 'weight',
              label: 'Weight',
              value: typeof d.weight === 'number' ? `${d.weight} ${String(d.weightUnit ?? '')}`.trim() : null,
            },
            {
              key: 'dims',
              label: 'Dimensions',
              value: d.length
                ? `${String(d.length)} × ${String(d.width)} × ${String(d.height)} ${String(d.dimensionUnit ?? '')}`
                : null,
            },
            {
              key: 'address',
              label: 'Ship to',
              value: `${d.customerName as string} · ${d.customerAddress}`,
              full: true,
            },
          ]}
        />
      </section>
      <section className="rounded-lg border border-border p-4">
        <h3 className="mb-3 text-sm font-semibold">Shipment</h3>
        <KvList
          items={[
            { key: 'client', label: 'Client', value: str(d.clientName) },
            { key: 'warehouse', label: 'Warehouse', value: str(d.warehouseCode) },
            { key: 'location', label: 'Inventory location', value: str(d.locationCode) },
            { key: 'lp', label: 'Parent LP', value: str(d.parentLpNumber) },
            { key: 'package', label: 'Package type', value: str(d.packageCode) },
            { key: 'zone', label: 'Zone', value: str(d.zone) },
            {
              key: 'insurance',
              label: 'Insurance',
              value: d.insuranceType
                ? `${String(d.insuranceType)}${typeof d.insuranceValue === 'number' && d.insuranceValue > 0 ? ` · ${money(d.insuranceValue, d.currency)}` : ''}`
                : null,
            },
            { key: 'confirmation', label: 'Delivery confirmation', value: str(d.confirmationType) },
            { key: 'saturday', label: 'Saturday delivery', value: d.allowSaturdayDelivery ? 'Yes' : 'No' },
            { key: 'sync', label: 'Synced to store', value: d.syncedToStore ? 'Yes' : 'No' },
            {
              key: 'expected',
              label: 'Expected delivery',
              value: d.carrierExpectedDeliveryAt ? formatDateTime(String(d.carrierExpectedDeliveryAt)) : null,
            },
            { key: 'tracking-status', label: 'Tracking status', value: str(d.trackingStatus) },
            {
              key: 'sched-pickup',
              label: 'Scheduled pickup',
              value: d.scheduledPickupAt ? formatDateTime(String(d.scheduledPickupAt)) : null,
            },
            {
              key: 'actual-pickup',
              label: 'Actual pickup',
              value: d.actualPickupAt ? formatDateTime(String(d.actualPickupAt)) : null,
            },
            {
              key: 'delivered',
              label: 'Delivery date',
              value: d.deliveredAt ? formatDateTime(String(d.deliveredAt)) : null,
            },
            {
              key: 'ship-mail',
              label: 'Shipment mail sent',
              value: d.shipmentMailSentAt ? formatDateTime(String(d.shipmentMailSentAt)) : 'No',
            },
            {
              key: 'delivery-mail',
              label: 'Delivery mail sent',
              value: d.deliveryMailSentAt ? formatDateTime(String(d.deliveryMailSentAt)) : 'No',
            },
            { key: 'reference', label: 'External reference', value: str(d.externalReference) },
          ]}
        />
      </section>
      <section className="rounded-lg border border-border p-4">
        <h3 className="mb-1 text-sm font-semibold">
          {d.itemsSource === 'order' ? 'Items on the order' : 'Items in this package'}
        </h3>
        {d.itemsSource === 'order' && d.items.length > 0 ? (
          <p className="mb-2 text-xs text-secondary">
            Packing didn&apos;t record a per-package breakdown for this label, so the order&apos;s open lines
            are shown{d.siblings.length > 1 ? ` (shared by all ${d.siblings.length} packages)` : ''}.
          </p>
        ) : null}
        {d.items.length === 0 ? (
          <p className="text-xs text-secondary">This order has no open lines.</p>
        ) : (
          <table className="mt-2 w-full text-xs">
            <thead className="text-left text-2xs text-faint">
              <tr>
                <th className="py-1">SKU</th>
                <th>Product</th>
                <th>Lot</th>
                <th className="text-right">Qty</th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((i) => (
                <tr key={i.id} className="border-t border-border">
                  <td className="py-1.5 font-medium">{i.sku}</td>
                  <td className="max-w-[180px] truncate" title={i.productName}>
                    {i.productName}
                  </td>
                  <td>{i.lotNumber ?? '—'}</td>
                  <td className="text-right tabular-nums">
                    {i.quantity} {i.packType}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="rounded-lg border border-border p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Carrier activity</h3>
          {d.carrierMode ? (
            <span className="text-2xs text-faint" data-testid="carrier-mode">
              {d.carrierEnvironment} connection ·{' '}
              {d.carrierMode === 'simulated'
                ? 'simulated'
                : d.carrierMode === 'carrier-test'
                  ? 'carrier test API'
                  : 'live API'}
            </span>
          ) : null}
        </div>
        {d.carrierMode ? (
          <p className="mb-3 rounded-md bg-surface-sunken px-2.5 py-1.5 text-2xs text-secondary">
            {MODE_NOTE[d.carrierMode]}
          </p>
        ) : null}
        {d.events.length === 0 ? (
          <p className="text-xs text-secondary">No carrier calls were logged for this package.</p>
        ) : (
          <ol className="flex flex-col gap-2 text-xs" data-testid="carrier-activity">
            {d.events.map((e) => (
              <li
                key={e.id}
                className="flex flex-col gap-1 border-t border-border pt-2 first:border-t-0 first:pt-0"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium text-foreground">
                      {e.status === 'Success'
                        ? (STEP_LABEL[e.step] ?? e.step)
                        : (STEP_ERROR_LABEL[e.step] ?? e.step)}{' '}
                      <span className={e.status === 'Success' ? 'text-success' : 'text-danger'}>
                        · {e.status === 'Success' ? 'Success' : 'Error'} {e.httpCode}
                      </span>{' '}
                      <span className="font-normal text-faint">· {e.responseMs} ms</span>
                    </span>
                    {e.error ? <span className="break-words text-danger">{e.error}</span> : null}
                    {e.source ? <span className="text-faint">{e.source}</span> : null}
                  </span>
                  <span className="shrink-0 tabular-nums text-secondary">{formatDateTime(e.at)}</span>
                </span>
                {e.responseJson ? (
                  <details className="text-2xs">
                    <summary className="cursor-pointer text-primary">Carrier response</summary>
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-sunken p-2 font-mono text-2xs text-secondary">
                      {pretty(e.responseJson)}
                    </pre>
                    {e.requestJson ? (
                      <>
                        <p className="mt-1 text-faint">Request</p>
                        <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-sunken p-2 font-mono text-2xs text-secondary">
                          {pretty(e.requestJson)}
                        </pre>
                      </>
                    ) : null}
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
      {d.siblings.length > 1 ? (
        <section className="rounded-lg border border-border p-4">
          <h3 className="mb-3 text-sm font-semibold">Packages in this shipment ({d.siblings.length})</h3>
          <ul className="flex flex-col gap-1.5 text-xs">
            {d.siblings.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span className="font-mono">
                  {s.packageSeq}. {s.trackingNumber}
                  {s.id === d.id ? <span className="ml-2 font-sans text-faint">(this package)</span> : null}
                </span>
                <LabelStatusPill status={s.labelStatus} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function ShipmentDetailDrawer({
  id,
  onClose,
  actions,
}: {
  readonly id: string | null;
  readonly onClose: () => void;
  readonly actions: ShipmentActions;
}) {
  const q = useApiQuery<Detail>(
    ['shipment', id ?? ''],
    id ? `/api/shipments/${encodeURIComponent(id)}` : null,
    { staleTime: 0 },
  );
  const d = q.data?.data;
  return (
    <Drawer
      open={id !== null}
      onOpenChange={(o) => (o ? undefined : onClose())}
      width={45}
      title={d ? `Package ${d.trackingNumber}` : 'Package'}
      description={d ? `${d.orderCode} · ${d.carrier}` : undefined}
    >
      {q.isError ? (
        <EmptyState
          title="Couldn't load this package"
          description={q.error.message}
          action={<Button onClick={() => void q.refetch()}>Retry</Button>}
        />
      ) : !d ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <Body
          d={d}
          actions={{
            ...actions,
            onRefreshTracking: actions.onRefreshTracking
              ? async (r) => {
                  await actions.onRefreshTracking?.(r);
                  await q.refetch();
                }
              : undefined,
          }}
        />
      )}
    </Drawer>
  );
}
