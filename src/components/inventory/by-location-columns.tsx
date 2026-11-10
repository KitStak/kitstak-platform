"use client";

/** Inventory by Location columns (spec 04 §2: 37 data columns + select + actions). */
import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Eye, Lock, Minus, PencilLine, Plus, Shuffle } from "lucide-react";
import { DateCell, ExternalFilterLink, RowMenu, type RowAction } from "@/components/grid";
import { Tooltip } from "@/components/ui/tooltip";
import { BY_LOCATION_TIPS } from "@/lib/grid-defs/inventory/by-location";
import { productFilters } from "./inventory-links";
import { DamagePill, InventoryStatusPill, ProductThumb, Qty, headerWidth } from "./inventory-shared";
import { lockedReason, type BucketRow, type QuantityMode } from "./by-location-types";

type Col = ColumnDef<BucketRow, unknown>;

export interface BucketActionHandlers {
  readonly onDetails: (row: BucketRow) => void;
  readonly onQuantity: (row: BucketRow, mode: QuantityMode) => void;
  readonly onTransfer: (row: BucketRow) => void;
  readonly can: { readonly add: boolean; readonly adjust: boolean; readonly remove: boolean; readonly transfer: boolean };
}

const dash = <span className="text-faint">—</span>;

const text = (id: keyof BucketRow & string, label: string, size = 130, sortable = false, visible = true): Col => ({
  id, accessorKey: id, header: label, size, enableSorting: sortable, meta: { label, defaultVisible: visible },
  cell: ({ row }) => {
    const v = row.original[id];
    return v === null || v === "" ? dash : String(v);
  },
});

const qty = (id: keyof BucketRow & string, label: string, sortable = true): Col => ({
  id, accessorKey: id, header: label, size: headerWidth(label, 110, Boolean(BY_LOCATION_TIPS[id])), enableSorting: sortable, meta: { label, align: "right", headerTip: BY_LOCATION_TIPS[id] },
  cell: ({ row }) => <Qty value={row.original[id] as number} />,
});

function rowActions(row: BucketRow, h: BucketActionHandlers): RowAction[] {
  const noFree = row.freeQty <= 0 ? "Every unit in this row is allocated" : null;
  const perm = "You don't have permission for this action";
  return [
    { key: "details", label: "Show details", icon: Eye, onSelect: () => h.onDetails(row) },
    { key: "add", label: "Add", icon: Plus, onSelect: () => h.onQuantity(row, "add"), disabledReason: h.can.add ? null : perm },
    { key: "adjust", label: "Adjust", icon: PencilLine, onSelect: () => h.onQuantity(row, "adjust"), disabledReason: h.can.adjust ? null : perm },
    { key: "remove", label: "Remove", icon: Minus, onSelect: () => h.onQuantity(row, "remove"), disabledReason: h.can.remove ? (noFree) : perm },
    { key: "transfer", label: "Transfer product", icon: Shuffle, onSelect: () => h.onTransfer(row), disabledReason: h.can.transfer ? noFree : perm },
  ];
}

function ActionsCell({ row, handlers }: { readonly row: BucketRow; readonly handlers: BucketActionHandlers }) {
  const reason = lockedReason(row);
  if (reason) {
    return (
      <Tooltip content={reason}>
        <span tabIndex={0} role="img" aria-label={reason} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
          <Lock className="h-3.5 w-3.5" aria-hidden />
        </span>
      </Tooltip>
    );
  }
  return <RowMenu actions={rowActions(row, handlers)} label={`Actions for ${row.sku} in ${row.location}`} />;
}

export function buildBucketColumns(handlers: BucketActionHandlers): Col[] {
  return [
    { id: "image", header: "Image", size: 60, enableSorting: false, meta: { label: "Image", clip: false, justify: "center" }, cell: ({ row }) => <ProductThumb src={row.original.imageUrl} alt={row.original.sku} /> },
    text("client", "Client", 140, true),
    {
      id: "sku", accessorKey: "sku", header: "SKU", size: 170, meta: { label: "SKU", alwaysVisible: true },
      cell: ({ row }) => <ExternalFilterLink path="/products" filters={productFilters(row.original.sku, row.original.clientId)} label={`Product ${row.original.sku}`}>{row.original.sku}</ExternalFilterLink>,
    },
    text("barcode", "Barcode", 130),
    text("productName", "Product Name", 220, true),
    qty("totalPackQty", "Total Pack Qty"),
    qty("allocatedPackQty", "Allocated Pack Qty"),
    qty("allocatedQty", "Allocated UOM Qty"),
    qty("freePackQty", "Free Quantity"),
    qty("freeQty", "Free UOM Qty"),
    text("packType", "Pack Type", 100, true),
    text("uomPackType", "UOM Pack Type", 110),
    { ...qty("totalQty", "UOM Quantity"), header: "UOM Quantity" },
    text("lotNumber", "Lot/Batch Number", 140, true),
    { id: "expiryDate", accessorKey: "expiryDate", header: "Expiry Date", size: 120, meta: { label: "Expiry Date" }, cell: ({ row }) => <DateCell value={row.original.expiryDate} dateOnly /> },
    text("productType", "Product Type", 130),
    text("productGroup", "Product Group", 130, true),
    text("warehouse", "Warehouse", 190, true),
    { id: "location", accessorKey: "location", header: "Location", size: 130, meta: { label: "Location", alwaysVisible: true }, cell: ({ row }) => <span className="font-medium text-foreground">{row.original.location}</span> },
    text("locationGroup", "Location Group", 130, true),
    text("locationZone", "Location Zone", 120, true),
    text("locationType", "Location Type", 120, true),
    text("areaType", "Area Type", 110, true),
    text("replenishmentType", "Replenishment Location Type", 150, true),
    { ...qty("walkingPathPriority", "Walking Path Priority"), cell: ({ row }) => <Qty value={row.original.walkingPathPriority} muteZero={false} /> },
    text("poNumber", "PO Number", 120),
    text("lpNumber", "LPN", 130, true),
    text("parentLpNumber", "Parent LP", 120),
    text("originalLpNumber", "Original LP Number", 140, false, false),
    text("lpType", "LP Type", 110, true),
    text("parentLpType", "Parent LP Type", 120, false, false),
    text("originalParentLpNumber", "Original Parent LP", 140, false, false),
    text("mobileCart", "Mobile Cart", 110),
    { id: "status", accessorKey: "status", header: "Inventory Status", size: 130, meta: { label: "Inventory Status", clip: false }, cell: ({ row }) => <InventoryStatusPill status={row.original.status} /> },
    { id: "damageReason", accessorKey: "damageReason", header: "Damage Reason", size: 170, meta: { label: "Damage Reason", clip: false }, cell: ({ row }) => <DamagePill reason={row.original.damageReason} /> },
    { id: "receivedAt", accessorKey: "receivedAt", header: "Receiving Date", size: 172, meta: { label: "Receiving Date" }, cell: ({ row }) => <DateCell value={row.original.receivedAt} /> },
    { id: "productionDate", accessorKey: "productionDate", header: "Production Date", size: 130, meta: { label: "Production Date" }, cell: ({ row }) => <DateCell value={row.original.productionDate} dateOnly /> },
    {
      id: "rowActions", header: () => <span className="sr-only">Actions</span>, size: 48, minSize: 48, enableSorting: false, enableResizing: false, enableHiding: false,
      meta: { label: "Actions", sticky: "right", alwaysVisible: true, clip: false, justify: "center", cellPadding: "px-1" },
      cell: ({ row }) => <ActionsCell row={row.original} handlers={handlers} />,
    },
  ];
}
