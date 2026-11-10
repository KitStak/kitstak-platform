"use client";

/**
 * Package detail drawer (KitStaks addition): label facts, packed items and every package
 * of the same multi-package shipment, with the same actions as the row menu.
 */
import Link from "next/link";
import { Download, ExternalLink, Printer, XCircle } from "lucide-react";
import { useApiQuery } from "@/lib/query-client";
import { formatDateTime } from "@/lib/format";
import { Button, buttonVariants } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { DisabledReason } from "@/components/ui/tooltip";
import { KvList } from "@/components/shared/kv-list";
import { StatusPill } from "@/components/ui/status-pill";
import type { ShipmentDetail } from "@/server/repositories/shipping";
import { LabelStatusPill, LabelTypePill } from "./column-kit";
import type { ShipmentRow } from "./shipments-columns";

export interface ShipmentActions {
  readonly onDownload: (row: ShipmentRow) => void;
  readonly onReprint: (row: ShipmentRow) => void;
  readonly onVoid: (row: ShipmentRow) => void;
  readonly canVoid: boolean;
  readonly canReprint: boolean;
}

type Detail = ShipmentDetail & ShipmentRow;

const money = (v: unknown, currency: unknown) => (typeof v === "number" ? `${v.toFixed(2)} ${String(currency ?? "USD")}` : null);

function Body({ d, actions }: { readonly d: Detail; readonly actions: ShipmentActions }) {
  const voidReason = !actions.canVoid ? "You don't have permission to void labels" : d.voidBlockedReason;
  const reprintReason = !actions.canReprint ? "You don't have permission to reprint labels" : d.labelStatus === "Voided" ? "Voided labels can't be reprinted" : !d.labelFileId ? "No label file is stored for this package" : null;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <LabelTypePill type={d.labelType} />
        <LabelStatusPill status={d.labelStatus} />
        <StatusPill status={d.orderStatus} domain="shipmentOrder" />
      </div>
      <div className="flex flex-wrap gap-2">
        <DisabledReason reason={reprintReason}>
          <Button variant="secondary" disabled={Boolean(reprintReason)} onClick={() => actions.onDownload(d)}><Download className="h-3.5 w-3.5" aria-hidden />Download label</Button>
        </DisabledReason>
        <DisabledReason reason={reprintReason}>
          <Button variant="secondary" disabled={Boolean(reprintReason)} onClick={() => actions.onReprint(d)}><Printer className="h-3.5 w-3.5" aria-hidden />Reprint</Button>
        </DisabledReason>
        {d.trackingUrl ? (
          <a className={buttonVariants({ variant: "secondary" })} href={d.trackingUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" aria-hidden />Track</a>
        ) : null}
        <DisabledReason reason={voidReason}>
          <Button variant="danger" disabled={Boolean(voidReason)} onClick={() => actions.onVoid(d)}><XCircle className="h-3.5 w-3.5" aria-hidden />Void label</Button>
        </DisabledReason>
      </div>
      <section className="rounded-lg border border-border p-4">
        <h3 className="mb-3 text-[13px] font-semibold">Label</h3>
        <KvList items={[
          { key: "order", label: "Order", value: <Link className="text-primary hover:underline" href={`/orders/${encodeURIComponent(d.orderCode)}`}>{d.orderCode}</Link> },
          { key: "carrier", label: "Carrier", value: d.carrier },
          { key: "service", label: "Shipment method", value: d.serviceName as string },
          { key: "tracking", label: "Tracking number", value: <span className="font-mono">{d.trackingNumber}</span> },
          { key: "master", label: "Master tracking number", value: d.masterTrackingNumber ? <span className="font-mono">{d.masterTrackingNumber}</span> : null },
          { key: "created", label: "Label create date", value: formatDateTime(d.labelCreatedAt) },
          { key: "shipped", label: "Actual shipment date", value: d.actualShipmentAt ? formatDateTime(d.actualShipmentAt) : null },
          { key: "voided", label: "Void date/time", value: d.voidedAt ? formatDateTime(d.voidedAt as string) : null },
          { key: "rate", label: "Rate", value: money(d.rate, d.currency) },
          { key: "cost", label: "Shipping cost", value: money(d.shippingCost, d.currency) },
          { key: "weight", label: "Weight", value: typeof d.weight === "number" ? `${d.weight} ${String(d.weightUnit ?? "")}`.trim() : null },
          { key: "dims", label: "Dimensions", value: d.length ? `${String(d.length)} × ${String(d.width)} × ${String(d.height)} ${String(d.dimensionUnit ?? "")}` : null },
          { key: "address", label: "Ship to", value: `${d.customerName as string} · ${d.customerAddress}`, full: true },
        ]} />
      </section>
      <section className="rounded-lg border border-border p-4">
        <h3 className="mb-3 text-[13px] font-semibold">Items in this package</h3>
        {d.items.length === 0 ? <p className="text-[12px] text-secondary">No items were recorded for this package.</p> : (
          <table className="w-full text-[12px]">
            <thead className="text-left text-[11px] uppercase text-faint"><tr><th className="py-1">SKU</th><th>Product</th><th>Lot</th><th className="text-right">Qty</th></tr></thead>
            <tbody>{d.items.map((i) => <tr key={i.id} className="border-t border-border"><td className="py-1.5 font-medium">{i.sku}</td><td className="truncate">{i.productName}</td><td>{i.lotNumber ?? "—"}</td><td className="text-right tabular-nums">{i.quantity} {i.packType}</td></tr>)}</tbody>
          </table>
        )}
      </section>
      {d.siblings.length > 1 ? (
        <section className="rounded-lg border border-border p-4">
          <h3 className="mb-3 text-[13px] font-semibold">Packages in this shipment ({d.siblings.length})</h3>
          <ul className="flex flex-col gap-1.5 text-[12px]">
            {d.siblings.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span className="font-mono">{s.packageSeq}. {s.trackingNumber}{s.id === d.id ? <span className="ml-2 font-sans text-faint">(this package)</span> : null}</span>
                <LabelStatusPill status={s.labelStatus} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function ShipmentDetailDrawer({ id, onClose, actions }: { readonly id: string | null; readonly onClose: () => void; readonly actions: ShipmentActions }) {
  const q = useApiQuery<Detail>(["shipment", id ?? ""], id ? `/api/shipments/${encodeURIComponent(id)}` : null, { staleTime: 0 });
  const d = q.data?.data;
  return (
    <Drawer open={id !== null} onOpenChange={(o) => (o ? undefined : onClose())} width={45} title={d ? `Package ${d.trackingNumber}` : "Package"} description={d ? `${d.orderCode} · ${d.carrier}` : undefined}>
      {q.isError ? (
        <EmptyState title="Couldn't load this package" description={q.error.message} action={<Button onClick={() => void q.refetch()}>Retry</Button>} />
      ) : !d ? (
        <div className="flex flex-col gap-3"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-48 w-full" /><Skeleton className="h-32 w-full" /></div>
      ) : (
        <Body d={d} actions={actions} />
      )}
    </Drawer>
  );
}
