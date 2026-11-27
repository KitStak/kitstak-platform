'use client';

/**
 * Receipt detail drawer (Master ID link; KitStaks addition). What was received, where,
 * with which attributes, the ledger transaction, serials and the other receipts of the
 * same purchase order. Cancel reverses the receipt through the ledger.
 */
import * as React from 'react';
import Link from 'next/link';
import { Ban, ExternalLink, PackageCheck, ScrollText } from 'lucide-react';
import { KvList, type KvItem } from '@/components/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Drawer } from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { DisabledReason } from '@/components/ui/tooltip';
import { useFormat } from '@/lib/format';
import { calendarDay } from '@/lib/grid-defs/receiving/po-schemas';
import { formatZoned } from '@/lib/grid-defs/receiving/zoned-time';
import { receivingTypeLabel } from '@/lib/grid-defs/receiving/receiving-types';
import { receivingLedgerHref } from '@/lib/grid-defs/receiving/receiving-ledger';
import { useApiQuery } from '@/lib/query-client';
import type { ReceiptRow } from './receipt-columns';
import { errorMessage, ProductThumb } from './receiving-shared';

export interface ReceiptDetail extends ReceiptRow {
  readonly serials: readonly {
    readonly primary: string;
    readonly secondary: string | null;
    readonly status: string;
  }[];
  readonly transaction: {
    readonly id: string;
    readonly type: string;
    readonly at: string;
    readonly uomQty: number;
  } | null;
  readonly siblings: readonly {
    readonly id: string;
    readonly masterId: number;
    readonly sku: string;
    readonly quantity: number;
    readonly receivedAt: string;
    readonly cancelledAt: string | null;
  }[];
}

export const receiptKey = (id: string) => ['receipt', id] as const;

export function ReceiptDrawer({
  receiptId,
  onOpenChange,
  onCancel,
  canCancel,
  onOpenReceipt,
  seed,
}: {
  readonly receiptId: string | null;
  /** The grid row of this receipt: the drawer renders from it at once while the detail loads. */
  readonly seed?: ReceiptRow | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCancel?: (row: ReceiptRow) => void;
  readonly canCancel: boolean;
  readonly onOpenReceipt?: (id: string) => void;
}) {
  const fmt = useFormat();
  const seeded = seed && seed.id === receiptId ? seed : null;
  const q = useApiQuery<ReceiptDetail>(
    receiptKey(receiptId ?? ''),
    receiptId ? `/api/receipts/${receiptId}` : null,
    {
      retry: false,
      // Instant render from the cached grid row; serials, siblings and the ledger row fill in after.
      placeholderData: seeded
        ? { data: { ...seeded, serials: [], transaction: null, siblings: [] } }
        : undefined,
    },
  );
  const r = q.data?.data;

  const facts: KvItem[] = (
    r
      ? [
          { label: 'Receiving type', value: receivingTypeLabel(r.type) },
          {
            label: 'Purchase order',
            value:
              r.purchaseOrderId && r.poCode ? (
                <Link className="text-primary hover:underline" href={`/receiving/${r.purchaseOrderId}`}>
                  {r.poCode}
                </Link>
              ) : (
                'None'
              ),
          },
          {
            label: 'PO status',
            value: r.poStatus ? <StatusPill status={r.poStatus} domain="purchaseOrder" size="sm" /> : 'None',
          },
          {
            label: 'Quantity',
            value: `${r.quantity.toLocaleString()} ${r.packType}${r.uomQuantity !== r.quantity ? ` (${r.uomQuantity.toLocaleString()} ${r.uomPackType})` : ''}`,
          },
          { label: 'Location', value: r.locationCode },
          { label: 'LPN', value: r.lpNumber ? `${r.lpNumber}${r.lpType ? ` · ${r.lpType}` : ''}` : 'None' },
          { label: 'Lot/batch number', value: r.lotNumber ?? 'None' },
          { label: 'Expiry date', value: r.expiryDate ? fmt.date(calendarDay(r.expiryDate)) : 'None' },
          {
            label: 'Production date',
            value: r.productionDate ? fmt.date(calendarDay(r.productionDate)) : 'None',
          },
          {
            label: 'Damage reason',
            value: r.damageReason ? <Badge tone="warning">{r.damageReason}</Badge> : 'None',
          },
          { label: 'Received', value: `${formatZoned(r.receivedAt, r.timeZone)} · ${r.receivedBy}` },
          { label: 'Client / warehouse', value: `${r.clientName} · ${r.warehouseName}` },
          { label: 'Note', value: r.note ?? 'None' },
        ]
      : []
  ).map((f) => ({ ...f, key: f.label }));

  const cancelReason = !canCancel
    ? "You don't have permission to cancel receipts"
    : (r?.cancelBlockedReason ?? null);

  return (
    <Drawer
      open={receiptId !== null}
      onOpenChange={onOpenChange}
      width={35}
      title={
        <span className="flex items-center gap-2">
          <PackageCheck className="h-4 w-4 text-primary" aria-hidden />
          Receipt {r ? r.masterId : ''}
          {r?.cancelledAt ? <Badge tone="danger">Cancelled</Badge> : null}
        </span>
      }
      description={r ? `${r.sku} · ${r.productName}` : undefined}
      footer={
        r && onCancel ? (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <DisabledReason reason={cancelReason}>
              <Button variant="danger" disabled={Boolean(cancelReason)} onClick={() => onCancel(r)}>
                <Ban className="h-3.5 w-3.5" aria-hidden />
                Cancel receipt
              </Button>
            </DisabledReason>
          </>
        ) : undefined
      }
    >
      {q.isPending ? (
        <div className="flex flex-col gap-3" aria-busy>
          <p className="text-xs text-secondary" aria-live="polite">
            Loading the receipt, its ledger transaction and serial numbers…
          </p>
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : q.error || !r ? (
        <Callout
          variant="error"
          title="Couldn't load the receipt"
          action={
            <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
              Retry
            </Button>
          }
        >
          {errorMessage(q.error)}
        </Callout>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-sunken p-3">
            <ProductThumb url={r.imageUrl} label={r.sku} size={44} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{r.sku}</p>
              <p className="truncate text-xs text-secondary">{r.productName}</p>
              <p className="text-2xs text-faint">Barcode {r.barcode}</p>
            </div>
            <div className="text-right">
              <p className="text-xl font-bold leading-6 tabular-nums text-foreground">
                {r.quantity.toLocaleString()}
              </p>
              <p className="text-2xs text-faint">{r.packType}</p>
            </div>
          </div>
          {r.cancelledAt ? (
            <Callout variant="attention" title="This receipt was cancelled">
              Cancelled {formatZoned(r.cancelledAt, r.timeZone)}
              {r.cancelledBy ? ` by ${r.cancelledBy}` : ''}. The inventory was reversed.
            </Callout>
          ) : null}
          <KvList items={facts} />
          {r.damageImageFileId ? (
            <a
              href={`/api/files/${r.damageImageFileId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              Open damage photo
            </a>
          ) : null}
          <section>
            <h3 className="mb-2 text-xs font-semibold text-faint">Ledger transaction</h3>
            {r.transaction ? (
              <p className="text-xs text-body">
                {r.transaction.type} · {r.transaction.uomQty > 0 ? '+' : ''}
                {r.transaction.uomQty.toLocaleString()} units ·{' '}
                {formatZoned(r.transaction.at, r.timeZone)}{' '}
              </p>
            ) : q.isPlaceholderData ? (
              <Skeleton className="h-4 w-3/4" />
            ) : (
              <p className="text-xs text-faint">No ledger transaction recorded.</p>
            )}
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Receiving ledger">
              <li>
                <Link
                  href={receivingLedgerHref({ poCode: r.poCode, sku: r.sku })}
                  className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  <ScrollText className="h-3.5 w-3.5" aria-hidden />
                  {r.poCode ? `${r.sku} on ${r.poCode}` : `${r.sku} receiving`} ledger
                </Link>
              </li>
              {r.poCode ? (
                <li>
                  <Link
                    href={receivingLedgerHref({ poCode: r.poCode })}
                    className="font-medium text-primary hover:underline"
                  >
                    All {r.poCode} transactions
                  </Link>
                </li>
              ) : null}
              {r.poCode ? (
                <li>
                  <Link
                    href={receivingLedgerHref({ poCode: r.poCode, types: ['Cancel Receiving'] })}
                    className="font-medium text-primary hover:underline"
                  >
                    Cancelled receipts
                  </Link>
                </li>
              ) : null}
              <li>
                <Link
                  href={receivingLedgerHref({ user: r.receivedBy })}
                  className="font-medium text-primary hover:underline"
                >
                  By {r.receivedBy}
                </Link>
              </li>
            </ul>
          </section>
          {r.serials.length > 0 ? (
            <section>
              <h3 className="mb-2 text-xs font-semibold text-faint">Serial numbers ({r.serials.length})</h3>
              <ul className="flex flex-wrap gap-1.5">
                {r.serials.map((s) => (
                  <li key={s.primary}>
                    <Badge tone="outline">{s.primary}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {r.siblings.length > 0 ? (
            <section>
              <h3 className="mb-2 text-xs font-semibold text-faint">Other receipts on {r.poCode}</h3>
              <ul className="divide-y divide-border rounded-md border border-border">
                {r.siblings.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                    <button
                      type="button"
                      className="font-medium tabular-nums text-primary hover:underline"
                      onClick={() => onOpenReceipt?.(s.id)}
                    >
                      {s.masterId}
                    </button>
                    <span className="min-w-0 flex-1 truncate text-body">{s.sku}</span>
                    <span className="tabular-nums">{s.quantity.toLocaleString()}</span>
                    <span className="text-faint">{formatZoned(s.receivedAt, r.timeZone)}</span>
                    {s.cancelledAt ? <Badge tone="danger">Cancelled</Badge> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
