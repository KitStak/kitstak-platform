"use client";

/** Client entry points for every M13 report route (each is configuration on ReportGridPage). */
import * as React from "react";
import { Download, Info } from "lucide-react";
import { Callout } from "@/components/ui/callout";
import { CHANNEL_SALES_DEF, ORDER_INVENTORY_DEF } from "@/lib/grid-defs/reports/orders";
import {
  REPLENISHMENT_DEF, SERIAL_RECEIPTS_DEF, SERIAL_SHIPMENTS_DEF, SERIAL_TRACKING_DEF, SNAPSHOT_DEF, SNAPSHOT_DEFAULT_FILTER, TO_REPLENISH_TIP,
} from "@/lib/grid-defs/reports/inventory";
import { CHANGE_LOG_DEF, EXPORT_HISTORY_DEF, MISSING_LOG_DEF, SERIAL_TRANSACTIONS_DEF, TRANSACTION_HISTORY_DEF } from "@/lib/grid-defs/reports/logs";
import { PO_RECEIVING_DEF, USER_PERFORMANCE_DEF, USER_PERFORMANCE_DEFAULT_FILTER } from "@/lib/grid-defs/reports/receiving";
import { ReportGridPage } from "./report-grid-page";
import type { ReportRow } from "./report-cells";

export function ChannelSalesReport() {
  return (
    <ReportGridPage
      def={CHANNEL_SALES_DEF}
      banner={<Callout variant="info" title="Shipped orders only">Sold quantity, order count and revenue come from shipped, partially shipped and delivered orders. Click an order count to open those orders.</Callout>}
      emptyDescription="Rows appear once an order ships, or a product is listed on a sales channel."
    />
  );
}

export function OrderInventoryReport() {
  return <ReportGridPage def={ORDER_INVENTORY_DEF} emptyDescription="Rows appear while stock is allocated to an open shipment order or work order." />;
}

export function SerialTrackingReport() {
  return <ReportGridPage def={SERIAL_TRACKING_DEF} tabs="serial" emptyDescription="Serials appear once a serial-tracked product is received." />;
}

export function SerialShipmentsReport() {
  return <ReportGridPage def={SERIAL_SHIPMENTS_DEF} tabs="serial" emptyDescription="Rows appear once an order with serial-tracked products ships." />;
}

export function SerialReceiptsReport() {
  return <ReportGridPage def={SERIAL_RECEIPTS_DEF} tabs="serial" emptyDescription="Rows appear once a serial-tracked product is received." />;
}

export function ReplenishmentReport() {
  return (
    <ReportGridPage
      def={REPLENISHMENT_DEF}
      banner={<Callout variant="info" title="How To Replenish is calculated">{TO_REPLENISH_TIP} Set min/max levels on the product&apos;s Replenishment tab.</Callout>}
      emptyDescription="Rows appear for products that have min/max replenishment levels in a warehouse."
    />
  );
}

export function InventorySnapshotReport() {
  return <ReportGridPage def={SNAPSHOT_DEF} defaultQuery={SNAPSHOT_DEFAULT_FILTER} emptyDescription="Snapshots are taken every night around 00:02. Widen the Snapshot Date filter to see older days." />;
}

export function ChangeLogReport() {
  return <ReportGridPage def={CHANGE_LOG_DEF} emptyDescription="Every create, update and delete on a business record is written here." />;
}

export function TransactionHistoryReport() {
  return <ReportGridPage def={TRANSACTION_HISTORY_DEF} tabs="transactions" emptyDescription="Every receipt, allocation, pick, pack, move, count and shipment writes a transaction here." />;
}

export function SerialTransactionsReport() {
  return <ReportGridPage def={SERIAL_TRANSACTIONS_DEF} tabs="transactions" emptyDescription="Rows appear once a serial-tracked unit moves." />;
}

export function MissingLogReport() {
  return <ReportGridPage def={MISSING_LOG_DEF} emptyDescription="Rows appear when a picker reports stock missing at a location." />;
}

export function PoReceivingReport() {
  return <ReportGridPage def={PO_RECEIVING_DEF} emptyDescription="Rows appear once a purchase order starts receiving." />;
}

export function UserPerformanceReport() {
  return (
    <ReportGridPage
      def={USER_PERFORMANCE_DEF}
      defaultQuery={USER_PERFORMANCE_DEFAULT_FILTER}
      emptyDescription="Rows appear once users complete picking, packing, sorting, replenishment, receiving, count or return work. Try a longer period."
    />
  );
}

function DownloadLink({ row }: { readonly row: ReportRow }) {
  const href = typeof row.downloadHref === "string" ? row.downloadHref : null;
  if (!href) {
    const status = String(row.status ?? "");
    return <span className="inline-flex items-center gap-1 text-[12px] text-faint" title={status === "error" ? "The export failed, so there is no file" : "The file is still being generated"}><Info className="h-3.5 w-3.5" aria-hidden />{status === "error" ? "No file" : "Preparing"}</span>;
  }
  return (
    <a href={href} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" download>
      <Download className="h-3.5 w-3.5" aria-hidden />Download
    </a>
  );
}

const EXPORT_OVERRIDES = { action: (row: ReportRow) => <DownloadLink row={row} /> };
export const EXPORT_POLL_MS = 5_000;
/** Poll while any export is still being generated ("Preparing"). */
export const isExportPreparing = (rows: readonly ReportRow[]): boolean => rows.some((r) => r.status !== "completed" && r.status !== "error");

export function ExportHistoryReport() {
  const rowActions = React.useCallback((row: ReportRow) => {
    const href = typeof row.downloadHref === "string" ? row.downloadHref : undefined;
    return [{
      key: "download",
      label: "Download",
      icon: Download,
      ...(href ? { onSelect: () => { window.location.assign(href); } } : { disabledReason: row.status === "error" ? "The export failed, so there is no file to download" : "The file is still being generated" }),
    }];
  }, []);
  return (
    <ReportGridPage
      def={EXPORT_HISTORY_DEF}
      cellOverrides={EXPORT_OVERRIDES}
      refetchInterval={EXPORT_POLL_MS}
      pollWhile={isExportPreparing}
      rowActions={rowActions}
      emptyTitle="No exports yet"
      emptyDescription="Use Export As Excel at the bottom of any grid. The file shows up here and in the Transactions tray."
    />
  );
}
