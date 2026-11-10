"use client";

/** Carrier Shipment Details columns: the 41 Logiwa columns, one row per package / label. */
import { LinkCell } from "@/components/grid/cells";
import { StatusPill } from "@/components/ui/status-pill";
import type { ShipmentListRow } from "@/server/repositories/shipping";
import { LabelStatusPill, LabelTypePill, buildColumns, dash, exportColumnsOf, textCell, type ColumnSpec } from "./column-kit";

export type ShipmentRow = ShipmentListRow & {
  readonly orderStatus: string;
  readonly labelType: string;
  readonly labelFileId: string | null;
  readonly carrierCode: string;
  readonly packageSeq: number | null;
  readonly packageCount: number;
  readonly masterTrackingNumber: string | null;
  readonly actualShipmentAt: string | null;
  readonly labelCreatedAt: string;
};

function trackingCell(row: ShipmentRow): React.ReactNode {
  const multi = row.packageCount > 1;
  const number = <span className="font-mono text-[12px]">{row.trackingNumber}</span>;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {row.trackingUrl ? (
        <a href={row.trackingUrl} target="_blank" rel="noopener noreferrer" className="truncate text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
          {number}
        </a>
      ) : (
        <span className="truncate">{number}</span>
      )}
      {multi ? (
        <span className="shrink-0 rounded bg-surface-sunken px-1 text-[10px] font-semibold text-secondary" title={row.isMaster ? "Master package" : "Child package"}>
          {row.isMaster ? "Master" : `Pkg ${row.packageSeq ?? "?"}/${row.packageCount}`}
        </span>
      ) : null}
    </span>
  );
}

export const SHIPMENT_COLUMN_SPECS: readonly ColumnSpec<ShipmentRow>[] = [
  { id: "warehouseCode", label: "Warehouse", width: 96 },
  { id: "locationCode", label: "Inventory location", width: 170 },
  { id: "clientName", label: "Client", width: 150 },
  { id: "orderCode", label: "Order code", width: 130, always: true, cell: (r) => <LinkCell href={`/orders/${encodeURIComponent(r.orderCode)}`}>{r.orderCode}</LinkCell> },
  { id: "orderStatus", label: "Order status", width: 140, cell: (r) => <StatusPill status={r.orderStatus} domain="shipmentOrder" /> },
  { id: "customerName", label: "Customer", width: 170 },
  { id: "products", label: "Products", width: 200, sortable: false },
  { id: "customerAddress", label: "Customer address", width: 240, sortable: false },
  { id: "labelCreatedAt", label: "Label create date", kind: "datetime" },
  { id: "carrierExpectedDeliveryAt", label: "Carrier expected delivery date", kind: "datetime" },
  { id: "carrier", label: "Carrier", width: 150 },
  { id: "serviceName", label: "Shipment method", width: 150 },
  { id: "isRateShopped", label: "Rate shopping", kind: "boolean" },
  { id: "rateShoppingName", label: "Rate shopping name", width: 150 },
  { id: "rate", label: "Rate", kind: "money" },
  { id: "labelType", label: "Label type", width: 124, cell: (r) => <LabelTypePill type={r.labelType} /> },
  { id: "masterTrackingNumber", label: "Master tracking number", width: 190, cell: (r) => (r.masterTrackingNumber ? <span className="truncate font-mono text-[12px]">{r.masterTrackingNumber}</span> : dash) },
  { id: "trackingNumber", label: "Tracking number", width: 220, cell: trackingCell },
  { id: "actualShipmentAt", label: "Actual shipment date", kind: "datetime" },
  { id: "deliveredAt", label: "Delivery date", kind: "datetime" },
  { id: "voidedAt", label: "Void date/time", kind: "datetime" },
  { id: "insuranceType", label: "Insurance type", width: 120 },
  { id: "insuranceValue", label: "Insurance value", kind: "money" },
  { id: "confirmationType", label: "Confirmation type", width: 140 },
  { id: "weight", label: "Weight", kind: "number", decimals: 2 },
  { id: "height", label: "Height", kind: "number", decimals: 2 },
  { id: "width", label: "Width", kind: "number", decimals: 2 },
  { id: "length", label: "Length", kind: "number", decimals: 2 },
  { id: "dimensionUnit", label: "Dimension unit", width: 110 },
  { id: "packageCode", label: "Shipment package type", width: 160 },
  { id: "weightUnit", label: "Weight unit", width: 100 },
  { id: "shippingCost", label: "Shipping cost", kind: "money" },
  { id: "zone", label: "Zone", width: 72 },
  { id: "otherCost", label: "Other cost", kind: "money" },
  { id: "currency", label: "Currency", width: 88 },
  { id: "allowSaturdayDelivery", label: "Is allow Saturday delivery", kind: "boolean", width: 150 },
  { id: "labelStatus", label: "Label status", width: 110, cell: (r) => <LabelStatusPill status={r.labelStatus} /> },
  { id: "scheduledPickupAt", label: "Scheduled pickup date", kind: "datetime" },
  { id: "actualPickupAt", label: "Actual pickup date", kind: "datetime" },
  { id: "parentLpNumber", label: "Inventory parent LPN", width: 150 },
  { id: "externalReference", label: "External reference", width: 150, cell: (r) => textCell(r.externalReference) },
];

export const SHIPMENT_COLUMNS = buildColumns(SHIPMENT_COLUMN_SPECS);
export const SHIPMENT_EXPORT_COLUMNS = exportColumnsOf(SHIPMENT_COLUMN_SPECS);
