"use client";

/**
 * Kit Component Inventory Availability (`/inventory/kit-components`, Logiwa 07). Live rows:
 * one per component SKU and warehouse. Included Kits is a tooltip list (links to the kits),
 * Total Order Qty = component lines on open orders + kit demand × BOM + open work order
 * demand, Reorder Qty = max(0, total order qty − total available).
 */
import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGrid, GridToolbar, LinkCell, QtyCell, useGrid } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { Tooltip } from "@/components/ui/tooltip";
import { KIT_COMPONENT_EXPORT_COLUMNS, KIT_COMPONENT_FIELDS, KIT_COMPONENTS_GRID_KEY, type KitComponentRow } from "@/lib/grid-defs/work-orders/kits";
import { useWoFilterFields } from "../work-orders/wo-client";

export const KIT_COMPONENTS_HELPER = "Inventory levels and reorder requirements of kit product components can be monitored in this report.";

const dash = <span className="text-faint">—</span>;
const text = (v: unknown) => (v === null || v === undefined || v === "" ? dash : <span className="truncate">{String(v)}</span>);
const qty = (id: keyof KitComponentRow & string, header: string, tip: string): ColumnDef<KitComponentRow, unknown> => ({
  id, accessorKey: id, header, size: 160, meta: { align: "right", headerTip: tip },
  cell: ({ row }) => <QtyCell value={row.original[id] as number} muteZero />,
});

export function IncludedKits({ kits }: { readonly kits: readonly string[] }) {
  if (kits.length === 0) return dash;
  const label = kits.join(",");
  return (
    <Tooltip content={<ul className="flex flex-col gap-0.5">{kits.map((k) => <li key={k} className="font-medium">{k}</li>)}</ul>}>
      <span className="inline-flex min-w-0 items-center gap-1.5" tabIndex={0}>
        <span className="truncate">{label}</span>
        {kits.length > 1 ? <span className="shrink-0 rounded-full bg-surface-sunken px-1.5 text-[10px] font-semibold text-secondary">{kits.length}</span> : null}
      </span>
    </Tooltip>
  );
}

export function buildKitComponentColumns(): ColumnDef<KitComponentRow, unknown>[] {
  return [
    { id: "warehouseCode", accessorKey: "warehouseCode", header: "Warehouse", size: 110, cell: ({ getValue }) => text(getValue()) },
    { id: "clientName", accessorKey: "clientName", header: "Client", size: 150, cell: ({ getValue }) => text(getValue()) },
    { id: "sku", accessorKey: "sku", header: "Component SKU", size: 170, meta: { alwaysVisible: true }, cell: ({ row }) => <LinkCell href={`/products/${row.original.componentProductId}`}>{row.original.sku}</LinkCell> },
    { id: "name", accessorKey: "name", header: "Component product name", size: 220, cell: ({ getValue }) => text(getValue()) },
    { id: "productType", accessorKey: "productType", header: "Product type", size: 130, cell: ({ getValue }) => text(getValue()) },
    { id: "productGroup", accessorKey: "productGroup", header: "Product group", size: 130, cell: ({ getValue }) => text(getValue()) },
    { id: "includedKitsText", accessorKey: "includedKitsText", header: "Included kits", size: 200, meta: { clip: false }, cell: ({ row }) => <IncludedKits kits={row.original.includedKits} /> },
    qty("totalOrderQty", "Total order quantity", "Open shipment order demand for the component, plus kit demand × BOM qty, plus open work order needs."),
    qty("totalInventoryQty", "Total inventory quantity", "Undamaged stock on hand."),
    qty("totalAvailableQty", "Total available inventory quantity", "On hand minus allocated."),
    {
      id: "reorderQty", accessorKey: "reorderQty", header: "Reorder quantity", size: 140, meta: { align: "right", headerTip: "max(0, total order quantity − total available)." },
      cell: ({ row }) => (row.original.reorderQty > 0 ? <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-semibold tabular-nums text-danger">{row.original.reorderQty.toLocaleString()}</span> : <QtyCell value={0} muteZero />),
    },
  ];
}

export function KitComponentsPage() {
  const fields = useWoFilterFields(KIT_COMPONENT_FIELDS);
  const g = useGrid<KitComponentRow>({ gridKey: KIT_COMPONENTS_GRID_KEY, path: "/api/kits/components", fields });
  const columns = React.useMemo(() => buildKitComponentColumns(), []);
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader title="Kit Component Inventory Availability" helper={KIT_COMPONENTS_HELPER} tabs="inventory" />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search by SKU" />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<KitComponentRow>
          {...g.gridProps}
          columns={columns}
          getRowId={(r) => r.id}
          selectable={false}
          exportColumns={KIT_COMPONENT_EXPORT_COLUMNS}
          emptyTitle="No kit components match this view"
          emptyDescription="Components show here once a kit's components have stock or demand in a warehouse."
        />
      </div>
    </div>
  );
}
