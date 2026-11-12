"use client";

/**
 * Bucket drawer (row click; KitStaks addition — Logiwa has no drill-down): attributes,
 * the allocations holding this stock (linked to orders, jobs and work orders) and the
 * last 50 ledger transactions, with the row actions in the footer.
 */
import * as React from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Link2, Minus, PencilLine, Plus, RefreshCw, Shuffle, SlidersHorizontal, Unlink2 } from "lucide-react";
import { useApiQuery } from "@/lib/query-client";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { UnderlineTabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonText } from "@/components/ui/skeleton";
import { DisabledReason } from "@/components/ui/tooltip";
import { Callout } from "@/components/ui/callout";
import { BucketCard, Fact } from "./bucket-card";
import { formatQty } from "./inventory-shared";
import { useInventoryDates } from "./inventory-dates";
import { filteredListHref } from "@/components/grid/cells";
import { countLockReason, lockedReason, txnLocationText, txnQtyDisplay, type BucketDetail, type BucketRow, type QuantityMode } from "./by-location-types";

type Tab = "attributes" | "allocations" | "transactions";

export interface BucketDrawerProps {
  readonly bucketId: string | null;
  /** The grid row, so the header paints immediately while the detail loads. */
  readonly initialRow?: BucketRow | null;
  readonly onClose: () => void;
  readonly onQuantity: (row: BucketRow, mode: QuantityMode) => void;
  readonly onTransfer: (row: BucketRow) => void;
  readonly can: { readonly add: boolean; readonly adjust: boolean; readonly remove: boolean; readonly transfer: boolean };
}

export function BucketDrawer({ bucketId, initialRow, onClose, onQuantity, onTransfer, can }: BucketDrawerProps) {
  const [tab, setTab] = React.useState<Tab>("attributes");
  const q = useApiQuery<BucketDetail>(["inventory", "bucket", bucketId ?? ""], bucketId ? `/api/inventory/buckets/${bucketId}` : null);
  const detail = q.data?.data;
  const row = detail?.bucket ?? (initialRow && initialRow.id === bucketId ? initialRow : undefined);
  const locked = row ? lockedReason(row) ?? countLockReason(row) : null;
  const noFree = row && row.freeQty <= 0 ? "Every unit in this row is allocated" : null;
  const perm = "You don't have permission for this action";
  const footer = row ? (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {([
        ["add", "Add", Plus, can.add ? locked : perm],
        ["adjust", "Adjust", PencilLine, can.adjust ? locked : perm],
        ["remove", "Remove", Minus, can.remove ? locked ?? noFree : perm],
      ] as const).map(([mode, label, Icon, reason]) => (
        <DisabledReason key={mode} reason={reason}>
          <Button variant="secondary" disabled={reason !== null} onClick={() => onQuantity(row, mode)}><Icon className="h-3.5 w-3.5" aria-hidden />{label}</Button>
        </DisabledReason>
      ))}
      <DisabledReason reason={can.transfer ? locked ?? noFree : perm}>
        <Button variant="primary" disabled={!can.transfer || Boolean(locked ?? noFree)} onClick={() => onTransfer(row)}><Shuffle className="h-3.5 w-3.5" aria-hidden />Transfer product</Button>
      </DisabledReason>
    </div>
  ) : undefined;

  return (
    <Drawer open={bucketId !== null} onOpenChange={(o) => (o ? undefined : onClose())} title={row ? `${row.sku} @ ${row.location}${row.lpNumber ? ` / ${row.lpNumber}` : ""}` : "Inventory row"} width={45} footer={footer}>
      {q.error && !row ? (
        <EmptyState compact title="Couldn't load this inventory row" description={q.error.message} action={<Button onClick={() => void q.refetch()}>Retry</Button>} />
      ) : !row ? <SkeletonText lines={8} /> : (
        <div className="flex flex-col gap-4">
          {/* Initial focus lands on the summary (no fields here), not the close button, so a mouse-opened
              drawer never shows a focus box on the × (keyboard users still Tab to it). */}
          <div tabIndex={-1} data-autofocus aria-label="Inventory row summary" className="rounded-lg outline-none">
            <BucketCard row={row} />
          </div>
          {row.countLockPlan ? (
            <Callout variant="attention" title={`Locked by count plan ${row.countLockPlan}`}>
              Add, Adjust, Remove and Transfer are paused for {row.location} until the count is finished, updated or cancelled.{" "}
              <Link href={`/counts/${encodeURIComponent(row.countLockPlan)}`} className="font-medium text-primary underline-offset-2 hover:underline">Open {row.countLockPlan}</Link>
            </Callout>
          ) : lockedReason(row) ? <Callout variant="info" title={`${row.status} stock`}>{lockedReason(row)}</Callout> : null}
          <UnderlineTabs
            tabs={[
              { key: "attributes", label: "Attributes" },
              { key: "allocations", label: "Allocations", count: detail?.allocations.length },
              { key: "transactions", label: "Transactions", count: detail?.transactions.length },
            ]}
            active={tab}
            onChange={(k) => setTab(k as Tab)}
            ariaLabel="Inventory row details"
            // Keyboard focus shows a neutral ring (brand red reads as an error next to the red active underline).
            className="px-0 [&_[role=tab]:focus-visible]:ring-border-strong [&_[role=tab]:focus-visible]:ring-offset-0"
          />
          {tab === "attributes" ? <Attributes row={row} /> : null}
          {tab !== "attributes" && !detail ? (q.error ? (
            <EmptyState compact title="Couldn't load history" description={q.error.message} action={<Button onClick={() => void q.refetch()}>Retry</Button>} />
          ) : <SkeletonText lines={5} />) : null}
          {tab === "allocations" && detail ? <Allocations detail={detail} /> : null}
          {tab === "transactions" && detail ? <Transactions detail={detail} /> : null}
        </div>
      )}
    </Drawer>
  );
}

function Attributes({ row }: { readonly row: BucketRow }) {
  const fmt = useFormat();
  const dates = useInventoryDates();
  const v = (x: string | number | null) => (x === null || x === "" ? "-" : String(x));
  const tracked = (on: number, value: string | null, render: (x: string) => string = (x) => x) =>
    !on ? (value ? `Not tracked (stored ${render(value)})` : "Not tracked") : value ? render(value) : "-";
  return (
    <dl className="grid grid-cols-3 gap-x-4 gap-y-3">
      <Fact label="Warehouse" className="col-span-2">{row.warehouse}</Fact>
      <Fact label="Client">{row.client}</Fact>
      <Fact label="Barcode">{row.barcode}</Fact>
      <Fact label="Product type">{v(row.productType)}</Fact>
      <Fact label="Product group">{v(row.productGroup)}</Fact>
      <Fact label="Inventory status">{row.status}</Fact>
      <Fact label="Damage reason">{v(row.damageReason)}</Fact>
      <Fact label="Damaged qty">{formatQty(row.damagedQty)}</Fact>
      <Fact label="Lot/Batch">{tracked(row.trackLot, row.lotNumber)}</Fact>
      <Fact label="Expiry date">{tracked(row.trackExpiry, row.expiryDate, dates.calendar)}</Fact>
      <Fact label="Production date">{tracked(row.trackProductionDate, row.productionDate, dates.calendar)}</Fact>
      <Fact label="Location">{row.location}</Fact>
      <Fact label="Location type">{v(row.locationType)}</Fact>
      <Fact label="Area type">{v(row.areaType)}</Fact>
      <Fact label="Location group">{v(row.locationGroup)}</Fact>
      <Fact label="Location zone">{v(row.locationZone)}</Fact>
      <Fact label="Walking path">{row.walkingPathPriority}</Fact>
      <Fact label="Replenishment type">{v(row.replenishmentType)}</Fact>
      <Fact label="LPN">{v(row.lpNumber)}</Fact>
      <Fact label="LP type">{v(row.lpType)}</Fact>
      <Fact label="Original LP">{v(row.originalLpNumber)}</Fact>
      <Fact label="Parent LP">{v(row.parentLpNumber)}</Fact>
      <Fact label="Parent LP type">{v(row.parentLpType)}</Fact>
      <Fact label="Original parent LP">{v(row.originalParentLpNumber)}</Fact>
      <Fact label="Pack type">{row.packType}{row.unitsPerPack > 1 ? ` (${row.unitsPerPack} ${row.uomPackType})` : ""}</Fact>
      <Fact label="UOM quantity">{formatQty(row.totalQty)}</Fact>
      <Fact label="Allocated UOM qty">{formatQty(row.allocatedQty)}</Fact>
      <Fact label="Free UOM qty">{formatQty(row.freeQty)}</Fact>
      <Fact label="PO number">{v(row.poNumber)}</Fact>
      <Fact label="Received"><span title={fmt.dateTime(row.receivedAt)}>{fmt.gridDateTime(row.receivedAt)}</span></Fact>
      <Fact label="Mobile cart">{v(row.mobileCart)}</Fact>
    </dl>
  );
}

function Allocations({ detail }: { readonly detail: BucketDetail }) {
  const fmt = useFormat();
  if (detail.allocations.length === 0) {
    return <EmptyState compact icon={SlidersHorizontal} title="Nothing allocated" description="Every unit in this row is free to move, remove or change." />;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-2xs text-faint"><tr><th className="py-1">Document</th><th>Job</th><th>Status</th><th className="text-right">Qty</th><th className="text-right">Since</th></tr></thead>
      <tbody>
        {detail.allocations.map((a) => (
          <tr key={a.id} className="border-t border-border">
            <td className="py-1.5">
              {a.orderCode ? <Link className="font-medium text-primary hover:underline" href={`/orders/${encodeURIComponent(a.orderCode)}`}>{a.orderCode}</Link>
                : a.workOrderId ? <Link className="font-medium text-primary hover:underline" href={`/work-orders/${a.workOrderId}`}>{a.workOrderCode ?? "Work order"}</Link> : "-"}
            </td>
            <td>{a.jobId ? <Link className="text-primary hover:underline" href={`/jobs/${a.jobId}`}>{a.jobCode ?? "Job"}</Link> : "-"}</td>
            <td>{a.status}</td>
            <td className="text-right tabular-nums">{formatQty(a.qty)}</td>
            <td className="text-right text-secondary">{fmt.gridDateTime(a.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Transaction History pre-filtered to this row's SKU, warehouse and client. With `direction`, it is also
 * scoped to this row's location: "in" = To Location, "out" = From Location (the report has no
 * bucket id or From-OR-To filter, so the two halves of the location's ledger are two links).
 */
export function bucketHistoryHref(row: Pick<BucketRow, "sku" | "warehouseId" | "clientId" | "location">, direction?: "in" | "out"): string {
  return filteredListHref("/reports/transaction-history", [
    { field: "sku", op: "eq", value: row.sku },
    { field: "warehouseId", op: "in", values: [row.warehouseId] },
    { field: "clientId", op: "in", values: [row.clientId] },
    ...(direction ? [{ field: direction === "in" ? "targetLocation" : "sourceLocation", op: "eq" as const, value: row.location }] : []),
  ]);
}

const TXN_ICON = { in: ArrowUpRight, out: ArrowDownRight, reserve: Link2, release: Unlink2, change: RefreshCw } as const;

function Transactions({ detail }: { readonly detail: BucketDetail }) {
  const fmt = useFormat();
  if (detail.transactions.length === 0) return <EmptyState compact title="No transactions yet" description="Ledger history appears here after the first movement." />;
  return (
    <div className="flex flex-col gap-2">
    <nav aria-label="Open in Transaction History" className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs">
      <span className="text-secondary">Transaction History:</span>
      <Link href={bucketHistoryHref(detail.bucket, "in")} className="font-medium text-primary underline-offset-2 hover:underline">Into {detail.bucket.location}</Link>
      <Link href={bucketHistoryHref(detail.bucket, "out")} className="font-medium text-primary underline-offset-2 hover:underline">Out of {detail.bucket.location}</Link>
      <Link href={bucketHistoryHref(detail.bucket)} className="font-medium text-primary underline-offset-2 hover:underline">All {detail.bucket.sku}</Link>
    </nav>
    <ol className="flex flex-col divide-y divide-border">
      {detail.transactions.map((t) => {
        const d = txnQtyDisplay(t, formatQty);
        const Icon = TXN_ICON[d.kind];
        return (
          <li key={t.id} className="flex items-start gap-3 py-2 text-sm">
            <span className={cn("mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full", d.tone === "out" ? "bg-danger-soft text-danger" : d.tone === "in" ? "bg-success-soft text-success" : "bg-neutral-soft text-neutral")}>
              <Icon className="h-3.5 w-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-foreground">{t.type}</span>
                <span className={cn("tabular-nums font-semibold", d.tone === "out" ? "text-danger" : d.tone === "in" ? "text-success" : "text-secondary")}>{d.label}</span>
                {txnLocationText(t.fromLocation, t.toLocation) ? <span className="text-secondary">{txnLocationText(t.fromLocation, t.toLocation)}</span> : null}
                {t.fromStatus && t.toStatus && t.fromStatus !== t.toStatus ? <span className="text-secondary">{t.fromStatus} → {t.toStatus}</span> : null}
              </div>
              <div className="text-xs text-secondary">
                {[t.reason, t.note, t.orderCode, t.jobCode].filter(Boolean).join(" · ") || " "}
              </div>
            </div>
            <div className="shrink-0 text-right text-xs text-secondary">
              <div>{fmt.gridDateTime(t.at)}</div>
              <div className="text-faint">{t.user ?? t.source}</div>
            </div>
          </li>
        );
      })}
    </ol>
    </div>
  );
}
