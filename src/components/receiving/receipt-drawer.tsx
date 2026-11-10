"use client";

/**
 * Receipt detail drawer (Master ID link; KitStaks addition). What was received, where,
 * with which attributes, the ledger transaction, serials and the other receipts of the
 * same purchase order. Cancel reverses the receipt through the ledger.
 */
import * as React from "react";
import Link from "next/link";
import { Ban, ExternalLink, PackageCheck } from "lucide-react";
import { KvList, type KvItem } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Drawer } from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { DisabledReason } from "@/components/ui/tooltip";
import { useFormat } from "@/lib/format";
import { useApiQuery } from "@/lib/query-client";
import type { ReceiptRow } from "./receipt-columns";
import { errorMessage, ProductThumb } from "./receiving-shared";

export interface ReceiptDetail extends ReceiptRow {
  readonly serials: readonly { readonly primary: string; readonly secondary: string | null; readonly status: string }[];
  readonly transaction: { readonly id: string; readonly type: string; readonly at: string; readonly uomQty: number } | null;
  readonly siblings: readonly { readonly id: string; readonly masterId: number; readonly sku: string; readonly quantity: number; readonly receivedAt: string; readonly cancelledAt: string | null }[];
}

export const receiptKey = (id: string) => ["receipt", id] as const;

export function ReceiptDrawer({ receiptId, onOpenChange, onCancel, canCancel, onOpenReceipt }: {
  readonly receiptId: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCancel?: (row: ReceiptRow) => void;
  readonly canCancel: boolean;
  readonly onOpenReceipt?: (id: string) => void;
}) {
  const fmt = useFormat();
  const q = useApiQuery<ReceiptDetail>(receiptKey(receiptId ?? ""), receiptId ? `/api/receipts/${receiptId}` : null, { retry: false });
  const r = q.data?.data;

  const facts: KvItem[] = (r
    ? [
        { label: "Receiving type", value: r.type },
        { label: "Purchase order", value: r.purchaseOrderId && r.poCode ? <Link className="text-primary hover:underline" href={`/receiving/${r.purchaseOrderId}`}>{r.poCode}</Link> : "—" },
        { label: "PO status", value: r.poStatus ? <StatusPill status={r.poStatus} domain="purchaseOrder" size="sm" /> : "—" },
        { label: "Quantity", value: `${r.quantity.toLocaleString()} ${r.packType}${r.uomQuantity !== r.quantity ? ` (${r.uomQuantity.toLocaleString()} ${r.uomPackType})` : ""}` },
        { label: "Location", value: r.locationCode },
        { label: "LPN", value: r.lpNumber ? `${r.lpNumber}${r.lpType ? ` · ${r.lpType}` : ""}` : "—" },
        { label: "Lot/batch number", value: r.lotNumber ?? "—" },
        { label: "Expiry date", value: r.expiryDate ? fmt.date(r.expiryDate) : "—" },
        { label: "Production date", value: r.productionDate ? fmt.date(r.productionDate) : "—" },
        { label: "Damage reason", value: r.damageReason ? <Badge tone="warning" size="sm">{r.damageReason}</Badge> : "—" },
        { label: "Received", value: `${fmt.dateTime(r.receivedAt)} · ${r.receivedBy}` },
        { label: "Client / warehouse", value: `${r.clientName} · ${r.warehouseName}` },
        { label: "Note", value: r.note ?? "—" },
      ]
    : []).map((f) => ({ ...f, key: f.label }));

  const cancelReason = !canCancel ? "You don't have permission to cancel receipts" : r?.cancelBlockedReason ?? null;

  return (
    <Drawer
      open={receiptId !== null}
      onOpenChange={onOpenChange}
      width={35}
      title={
        <span className="flex items-center gap-2">
          <PackageCheck className="h-4 w-4 text-primary" aria-hidden />
          Receipt {r ? r.masterId : ""}
          {r?.cancelledAt ? <Badge tone="danger" size="sm">Cancelled</Badge> : null}
        </span>
      }
      description={r ? `${r.sku} · ${r.productName}` : undefined}
      footer={
        r && onCancel ? (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
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
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-6 w-full" />)}
        </div>
      ) : q.error || !r ? (
        <Callout variant="error" title="Couldn't load the receipt" action={<Button size="sm" variant="secondary" onClick={() => void q.refetch()}>Retry</Button>}>
          {errorMessage(q.error)}
        </Callout>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-sunken p-3">
            <ProductThumb url={r.imageUrl} label={r.sku} size={44} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-foreground">{r.sku}</p>
              <p className="truncate text-[12px] text-secondary">{r.productName}</p>
              <p className="text-[11px] text-faint">Barcode {r.barcode}</p>
            </div>
            <div className="text-right">
              <p className="text-[22px] font-bold leading-6 tabular-nums text-foreground">{r.quantity.toLocaleString()}</p>
              <p className="text-[11px] text-faint">{r.packType}</p>
            </div>
          </div>
          {r.cancelledAt ? (
            <Callout variant="attention" title="This receipt was cancelled">
              Cancelled {fmt.dateTime(r.cancelledAt)}{r.cancelledBy ? ` by ${r.cancelledBy}` : ""}. The inventory was reversed.
            </Callout>
          ) : null}
          <KvList items={facts} />
          {r.damageImageFileId ? (
            <a href={`/api/files/${r.damageImageFileId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-primary hover:underline">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              Open damage photo
            </a>
          ) : null}
          <section>
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-faint">Ledger transaction</h3>
            {r.transaction ? (
              <p className="text-[12px] text-body">
                {r.transaction.type} · {r.transaction.uomQty > 0 ? "+" : ""}{r.transaction.uomQty.toLocaleString()} units · {fmt.dateTime(r.transaction.at)}{" "}
                <Link href={`/reports/transaction-history?f.receiptId=eq:${r.id}`} className="text-primary hover:underline">Transaction history</Link>
              </p>
            ) : <p className="text-[12px] text-faint">No ledger transaction recorded.</p>}
          </section>
          {r.serials.length > 0 ? (
            <section>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-faint">Serial numbers ({r.serials.length})</h3>
              <ul className="flex flex-wrap gap-1.5">
                {r.serials.map((s) => <li key={s.primary}><Badge tone="outline" size="md">{s.primary}</Badge></li>)}
              </ul>
            </section>
          ) : null}
          {r.siblings.length > 0 ? (
            <section>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-faint">Other receipts on {r.poCode}</h3>
              <ul className="divide-y divide-border rounded-md border border-border">
                {r.siblings.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[12px]">
                    <button type="button" className="font-medium tabular-nums text-primary hover:underline" onClick={() => onOpenReceipt?.(s.id)}>{s.masterId}</button>
                    <span className="min-w-0 flex-1 truncate text-body">{s.sku}</span>
                    <span className="tabular-nums">{s.quantity.toLocaleString()}</span>
                    <span className="text-faint">{fmt.date(s.receivedAt)}</span>
                    {s.cancelledAt ? <Badge tone="danger" size="sm">Cancelled</Badge> : null}
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
