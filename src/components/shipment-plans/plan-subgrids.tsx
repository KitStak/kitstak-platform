"use client";

/**
 * Shipment Plan Orders (`/shipment-plans/orders`) and Shipment Plan LPs
 * (`/shipment-plans/lps`): flat views across every plan, with the Logiwa columns and filters.
 */
import { PLAN_LP_FIELDS, PLAN_ORDER_FIELDS, SHIPMENT_PLAN_LPS_GRID_KEY, SHIPMENT_PLAN_ORDERS_GRID_KEY } from "@/lib/grid-defs/shipping/shipment-plans";
import { DataGrid, GridToolbar, LinkCell, useGrid } from "@/components/grid";
import { StatusPill } from "@/components/ui/status-pill";
import { PageHeader } from "@/components/layout/page-header";
import type { ShippingField } from "@/lib/grid-defs/shipping/common";
import { buildColumns, dash, exportColumnsOf, type ColumnSpec } from "@/components/shipping/column-kit";
import { useFilterFields } from "@/components/shipping/shipping-client";
import type { PlanOrderRow } from "./plans-client";

type Row = PlanOrderRow & { readonly planCode: string; readonly orderCode: string; readonly orderStatus: string; readonly planStatus: string; readonly lpNumber?: string };

const planLink = (r: Row) => <LinkCell href={`/shipment-plans/${encodeURIComponent(r.planId)}`}>{r.planCode}</LinkCell>;
const orderLink = (r: Row) => <LinkCell href={`/orders/${encodeURIComponent(r.orderCode)}`}>{r.orderCode}</LinkCell>;
const soPill = (r: Row) => <StatusPill status={r.orderStatus} domain="shipmentOrder" />;
const planPill = (r: Row) => (r.planStatus ? <StatusPill status={r.planStatus} domain="shipmentPlan" /> : dash);

export const PLAN_ORDER_SPECS: readonly ColumnSpec<Row>[] = [
  { id: "planCode", label: "Shipment plan code", width: 150, always: true, cell: planLink },
  { id: "orderCode", label: "Order code", width: 130, cell: orderLink },
  { id: "orderStatus", label: "Order status", width: 140, cell: soPill },
  { id: "planStatus", label: "Status", width: 140, cell: planPill },
  { id: "warehouseCode", label: "Warehouse", width: 96 },
  { id: "customerName", label: "Customer", width: 160 },
  { id: "customerAddress", label: "Customer address", width: 240 },
  { id: "carrierName", label: "Carrier", width: 130 },
  { id: "lpShippingOption", label: "Shipping option of the LPN", width: 180 },
  { id: "clientName", label: "Client", width: 150 },
  { id: "truckPlateNumber", label: "Truck plate number", width: 140 },
  { id: "orderCarrier", label: "Carrier of the shipment order", width: 190 },
  { id: "loadingGate", label: "Loading gate", width: 120 },
  { id: "plannedShipmentAt", label: "Planned shipment date", kind: "datetime" },
  { id: "truckDepartedAt", label: "Truck departed date", kind: "datetime" },
];

export const PLAN_LP_SPECS: readonly ColumnSpec<Row>[] = [
  { id: "planCode", label: "Shipment plan code", width: 150, always: true, cell: planLink },
  { id: "orderCode", label: "Order code", width: 130, cell: orderLink },
  { id: "orderStatus", label: "Order status", width: 140, cell: soPill },
  { id: "lpNumber", label: "LP", width: 130, cell: (r) => <span className="font-semibold">{r.lpNumber}</span> },
  { id: "parentLpNumber", label: "Parent LPN", width: 130 },
  { id: "planStatus", label: "Shipment plan status", width: 160, cell: planPill },
  { id: "warehouseCode", label: "Warehouse", width: 96 },
  { id: "customerName", label: "Customer", width: 160 },
  { id: "customerAddress", label: "Customer address", width: 240 },
  { id: "carrierName", label: "Carrier", width: 130 },
  { id: "shippingService", label: "Shipping option of the SO", width: 180 },
  { id: "clientName", label: "Client", width: 150 },
  { id: "truckPlateNumber", label: "Truck plate number", width: 140 },
  { id: "lpCarrier", label: "Carrier of the LPN", width: 150 },
  { id: "originalLpNumber", label: "Original LP number", width: 150 },
  { id: "loadingGate", label: "Loading gate", width: 120 },
  { id: "plannedShipmentAt", label: "Planned shipment date", kind: "datetime" },
  { id: "truckDepartedAt", label: "Truck departed date", kind: "datetime" },
  { id: "weight", label: "LP actual weight", kind: "number", decimals: 2 },
  { id: "volume", label: "LP actual volume", kind: "number", decimals: 2 },
];

const ORDER_COLUMNS = buildColumns(PLAN_ORDER_SPECS);
const LP_COLUMNS = buildColumns(PLAN_LP_SPECS);

interface SubGridConfig {
  readonly gridKey: string;
  readonly path: string;
  readonly fields: readonly ShippingField[];
  readonly specs: readonly ColumnSpec<Row>[];
  readonly columns: ReturnType<typeof buildColumns<Row>>;
  readonly title: string;
  readonly helper: string;
  readonly search: string;
  readonly empty: string;
  readonly emptyHint: string;
}

const CONFIG: Readonly<Record<"orders" | "lps", SubGridConfig>> = {
  orders: {
    gridKey: SHIPMENT_PLAN_ORDERS_GRID_KEY, path: "/api/shipment-plans/orders", fields: PLAN_ORDER_FIELDS, specs: PLAN_ORDER_SPECS, columns: ORDER_COLUMNS,
    title: "Shipment plan orders", helper: "Every order on a shipment plan, with its live order status and the plan it rides on.",
    search: "Plan code or order code", empty: "No orders on shipment plans yet", emptyHint: "Orders appear here once they are added to a shipment plan.",
  },
  lps: {
    gridKey: SHIPMENT_PLAN_LPS_GRID_KEY, path: "/api/shipment-plans/lps", fields: PLAN_LP_FIELDS, specs: PLAN_LP_SPECS, columns: LP_COLUMNS,
    title: "Shipment plan LPs", helper: "License plates allocated to or shipped from the orders of each shipment plan.",
    search: "Plan code, LP or order code", empty: "No license plates on shipment plans yet", emptyHint: "LPs appear once a plan's orders are allocated or shipped from license plates.",
  },
};

export function PlanSubGridPage({ kind }: { readonly kind: "orders" | "lps" }) {
  const c = CONFIG[kind];
  const fields = useFilterFields(c.fields);
  const g = useGrid<Row>({ gridKey: c.gridKey, path: c.path, fields });
  const hasState = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader title={c.title} helper={c.helper} tabs="shipment-plans" />
      <GridToolbar {...g.toolbarProps} searchPlaceholder={c.search} onRefresh={g.refetch} />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<Row>
          {...g.gridProps}
          selectable={false}
          columns={c.columns}
          exportColumns={exportColumnsOf(c.specs)}
          getRowId={(r) => r.id}
          emptyTitle={hasState ? "Nothing matches this view" : c.empty}
          emptyDescription={hasState ? "Try changing the filters or search term." : c.emptyHint}
        />
      </div>
    </div>
  );
}
