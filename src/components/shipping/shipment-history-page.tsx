"use client";

/**
 * Shipment History (`/shipments/history`): every ledger Shipment and remove-inventory
 * transaction, one row per SKU × lot × LPN (32 Logiwa columns, 19 filters). Read-only
 * report: order codes and SKUs link to their records; export as Excel.
 */
import { SHIPMENT_HISTORY_FIELDS, SHIPMENT_HISTORY_GRID_KEY } from "@/lib/grid-defs/shipping/shipment-history";
import { DataGrid, GridToolbar, LinkCell, useGrid } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import type { ShipmentHistoryRow } from "@/server/repositories/shipping-history";
import { ExportHistoryButton } from "./export-history-button";
import { buildColumns, dash, exportColumnsOf, type ColumnSpec } from "./column-kit";
import { useFilterFields } from "./shipping-client";

type Row = ShipmentHistoryRow & { readonly orderCode: string | null; readonly reference: string | null; readonly adjustmentReason: string | null; readonly sku: string | null; readonly shipmentType: string; readonly masterOrderCode: string | null; readonly packageWeight: number | null };

const orderLink = (code: string | null) => (code ? <LinkCell href={`/orders/${encodeURIComponent(code)}`}>{code}</LinkCell> : dash);

function typePill(type: string) {
  const isRemove = type === "Remove Inventory";
  return (
    <span className={isRemove ? "inline-flex whitespace-nowrap rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning" : "inline-flex whitespace-nowrap rounded-full bg-info-soft px-2 py-0.5 text-[11px] font-semibold text-info"}>
      {type}
    </span>
  );
}

const SPECS: readonly ColumnSpec<Row>[] = [
  {
    id: "orderCode", label: "Order code", width: 130, always: true,
    // Remove-inventory rows carry no order: show the adjustment reference instead of a bare dash.
    cell: (r) => (r.orderId && r.orderCode ? orderLink(r.orderCode) : r.reference ? <span className="truncate font-mono text-[12px] text-secondary" title="Remove inventory adjustment">{r.reference}</span> : dash),
    exportKey: "reference",
  },
  { id: "shipmentType", label: "Shipment type", width: 140, cell: (r) => typePill(r.shipmentType) },
  { id: "adjustmentReason", label: "Adjustment reason", width: 170 },
  { id: "originalOrderCode", label: "Original order code", width: 150, cell: (r) => orderLink((r.originalOrderCode as string | null) ?? null) },
  { id: "storeOrderNumber", label: "Store order number", width: 150 },
  { id: "sku", label: "SKU", width: 140, cell: (r) => (r.sku ? <LinkCell href={`/products/${encodeURIComponent(r.productId)}`}>{r.sku}</LinkCell> : dash) },
  { id: "productName", label: "Product name", width: 200 },
  { id: "barcode", label: "Barcode", width: 140 },
  { id: "poNumber", label: "PO number", width: 120 },
  { id: "lotNumber", label: "Lot/batch number", width: 140 },
  { id: "trackingNumber", label: "Tracking number", width: 190, cell: (r) => (r.trackingNumber ? <span className="truncate font-mono text-[12px]">{String(r.trackingNumber)}</span> : dash) },
  { id: "expiryDate", label: "Expiry date", kind: "date", width: 120 },
  { id: "quantity", label: "Quantity", kind: "integer", width: 96 },
  { id: "packType", label: "Pack type", width: 100 },
  { id: "uomPackType", label: "UOM pack type", width: 120 },
  { id: "shipmentPackage", label: "Shipment package", width: 150 },
  { id: "kitSku", label: "Kit SKU name", width: 140 },
  { id: "retailerName", label: "Retailer", width: 140 },
  { id: "packageWeight", label: "Package weight", width: 120, cell: (r) => (typeof r.packageWeight === "number" ? <span className="block text-right tabular-nums">{r.packageWeight} oz</span> : dash) },
  { id: "masterOrderCode", label: "Master shipment order code", width: 180, cell: (r) => orderLink(r.masterOrderCode) },
  { id: "isBackOrder", label: "Is back order", kind: "boolean" },
  { id: "shipmentDate", label: "Shipment date", kind: "datetime" },
  { id: "note", label: "Note", width: 200 },
  { id: "clientName", label: "Client", width: 150 },
  { id: "warehouseCode", label: "Warehouse", width: 96 },
  { id: "locationCode", label: "Location", width: 120 },
  { id: "lpNumber", label: "LPN", width: 130 },
  { id: "originalLpNumber", label: "Original LP number", width: 150 },
  { id: "originalParentLp", label: "Original parent LP", width: 150 },
  { id: "parentLpNumber", label: "Parent LP", width: 130 },
  { id: "parentLpType", label: "Parent LP type", width: 120 },
  { id: "receivingDate", label: "Receiving date", kind: "datetime" },
  { id: "productionDate", label: "Production date", kind: "date", width: 130 },
];

const COLUMNS = buildColumns(SPECS);
const EXPORT_COLUMNS = exportColumnsOf(SPECS);

export function ShipmentHistoryPage() {
  const fields = useFilterFields(SHIPMENT_HISTORY_FIELDS);
  const g = useGrid<Row>({ gridKey: SHIPMENT_HISTORY_GRID_KEY, path: "/api/shipments/history", fields });
  const hasState = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader title="Shipment History" helper="Every unit that left inventory — shipped orders and remove-inventory actions — by SKU, lot and LPN, straight from the ledger." />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Order code, SKU, tracking or store order #" onRefresh={g.refetch} trailing={<ExportHistoryButton gridKey="shipment-history" />} />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<Row>
          {...g.gridProps}
          columns={COLUMNS}
          exportColumns={EXPORT_COLUMNS}
          getRowId={(r) => r.id}
          emptyTitle={hasState ? "No shipments match this view" : "Nothing has shipped yet"}
          emptyDescription={hasState ? "Try changing the filters or search term." : "Rows appear once orders ship or inventory is removed."}
        />
      </div>
      <span className="sr-only" aria-live="polite">{g.isFetching ? "Loading shipment history" : `${g.total} rows`}</span>
    </div>
  );
}
