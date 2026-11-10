"use client";

/** Inventory by Location columns (spec 04 §2: 37 data columns + select + actions). */
import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Eye, Lock, Minus, MoreVertical, PencilLine, Plus, Shuffle } from "lucide-react";
import { DateCell, type RowAction } from "@/components/grid";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { CalendarDateCell, useInventoryDates } from "./inventory-dates";
import { BY_LOCATION_TIPS } from "@/lib/grid-defs/inventory/by-location";
import { DamagePill, InventoryStatusPill, ProductThumb, Qty, headerWidth, SkuLink, rightMeta } from "./inventory-shared";
import { bucketSubLabel, countLockReason, lockedReason, type BucketRow, type QuantityMode } from "./by-location-types";

type Col = ColumnDef<BucketRow, unknown>;

export interface BucketActionHandlers {
  readonly onDetails: (row: BucketRow) => void;
  readonly onQuantity: (row: BucketRow, mode: QuantityMode) => void;
  readonly onTransfer: (row: BucketRow) => void;
  readonly can: { readonly add: boolean; readonly adjust: boolean; readonly remove: boolean; readonly transfer: boolean };
}

const dash = <span className="text-faint">—</span>;

const text = (id: keyof BucketRow & string, label: string, size = 130, sortable = false, visible = true): Col => ({
  id, accessorKey: id, header: label, size: headerWidth(label, size), enableSorting: sortable, meta: { label, defaultVisible: visible },
  cell: ({ row }) => {
    const v = row.original[id];
    return v === null || v === "" ? dash : String(v);
  },
});

const qty = (id: keyof BucketRow & string, label: string, sortable = true, visible = true): Col => ({
  id, accessorKey: id, header: label, size: headerWidth(label, 110, Boolean(BY_LOCATION_TIPS[id])), enableSorting: sortable, meta: { ...rightMeta(label, BY_LOCATION_TIPS[id]), defaultVisible: visible },
  cell: ({ row }) => <Qty value={row.original[id] as number} />,
});

/** Row ⋯ items. Write items are omitted entirely for roles that can't perform them (Logiwa parity: read-only users see Show details only). */
export function rowActions(row: BucketRow, h: BucketActionHandlers): RowAction[] {
  const lock = countLockReason(row);
  const noFree = row.freeQty <= 0 ? "Every unit in this row is allocated" : null;
  const actions: RowAction[] = [{ key: "details", label: "Show details", icon: Eye, onSelect: () => h.onDetails(row) }];
  if (h.can.add) actions.push({ key: "add", label: "Add", icon: Plus, onSelect: () => h.onQuantity(row, "add"), disabledReason: lock });
  if (h.can.adjust) actions.push({ key: "adjust", label: "Adjust", icon: PencilLine, onSelect: () => h.onQuantity(row, "adjust"), disabledReason: lock });
  if (h.can.remove) actions.push({ key: "remove", label: "Remove", icon: Minus, onSelect: () => h.onQuantity(row, "remove"), disabledReason: lock ?? noFree });
  if (h.can.transfer) actions.push({ key: "transfer", label: "Transfer product", icon: Shuffle, onSelect: () => h.onTransfer(row), disabledReason: lock ?? noFree });
  return actions;
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
  return <BucketRowMenu actions={rowActions(row, handlers)} label={`Row actions for ${row.sku} @ ${row.location}`} lockPlan={row.countLockPlan} />;
}

/**
 * Row ⋯ menu with visible disabled reasons: disabled items are muted (text and icon) and
 * carry a short inline subtitle, so a count-locked row never reads as a dead menu.
 */
function BucketRowMenu({ actions, label, lockPlan }: { readonly actions: readonly RowAction[]; readonly label: string; readonly lockPlan: string | null }) {
  const shortReason = (reason: string) => (lockPlan && reason.includes(lockPlan) ? `Locked by count plan ${lockPlan}` : reason);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={(e) => e.stopPropagation()} className="opacity-70 hover:opacity-100 data-[state=open]:bg-neutral-soft data-[state=open]:opacity-100">
          <MoreVertical className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px] max-w-[280px]" onClick={(e) => e.stopPropagation()}>
        {lockPlan ? (
          <div className="mb-1 flex items-center gap-1.5 rounded-md bg-warning-soft px-2 py-1.5 text-[11px] font-medium text-warning" role="note">
            <Lock className="h-3 w-3 shrink-0" aria-hidden /> Locked by count plan {lockPlan}
          </div>
        ) : null}
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.key}
            icon={action.icon}
            disabled={Boolean(action.disabledReason)}
            description={action.disabledReason ? shortReason(action.disabledReason) : undefined}
            className={action.disabledReason ? "opacity-60 [&_svg]:!text-faint" : undefined}
            onSelect={() => action.onSelect?.()}
          >
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Location + count-lock tag + split sub-label ("Lot L1 · LP 9" or "Rcvd 11/09/2026", local day). */
function LocationCell({ row }: { readonly row: BucketRow }) {
  const dates = useInventoryDates();
  const lock = countLockReason(row);
  const sub = bucketSubLabel(row, dates.instantDate, dates.calendar);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-foreground">
      <span className="shrink-0">{row.location}</span>
      {lock ? (
        <Tooltip content={lock}>
          <span tabIndex={0} role="img" aria-label={`Count-locked by ${row.countLockPlan}`} className="inline-flex items-center gap-0.5 rounded bg-warning-soft px-1 py-px text-[10px] font-semibold text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
            <Lock className="h-2.5 w-2.5" aria-hidden />Count
          </span>
        </Tooltip>
      ) : null}
      {sub ? <span className="min-w-0 truncate text-[11px] font-normal text-faint" title={sub}>{sub}</span> : null}
    </span>
  );
}

export function buildBucketColumns(handlers: BucketActionHandlers): Col[] {
  return [
    { id: "image", header: "Image", size: 72, enableSorting: false, meta: { label: "Image", clip: false, justify: "center" }, cell: ({ row }) => <ProductThumb src={row.original.imageUrl} alt={row.original.sku} /> },
    text("client", "Client", 140, true),
    {
      id: "sku", accessorKey: "sku", header: "SKU", size: 170, meta: { label: "SKU", alwaysVisible: true },
      cell: ({ row }) => <SkuLink sku={row.original.sku} clientId={row.original.clientId} />,
    },
    // Location is the defining column of this page: keep it next to SKU so it is on screen at 1440px.
    { id: "location", accessorKey: "location", header: "Location", size: 240, meta: { label: "Location", alwaysVisible: true }, cell: ({ row }) => <LocationCell row={row.original} /> },
    text("barcode", "Barcode", 130, false, false),
    text("productName", "Product Name", 220, true),
    qty("totalPackQty", "Total Pack Qty"),
    qty("allocatedPackQty", "Allocated Pack Qty"),
    qty("allocatedQty", "Allocated UOM Qty", true, false),
    qty("freePackQty", "Free Quantity"),
    qty("freeQty", "Free UOM Qty", true, false),
    text("packType", "Pack Type", 100, true),
    text("uomPackType", "UOM Pack Type", 110, false, false),
    { ...qty("totalQty", "UOM Quantity", true, false), header: "UOM Quantity" },
    text("lotNumber", "Lot/Batch Number", 140, true),
    { id: "expiryDate", accessorKey: "expiryDate", header: "Expiry Date", size: 120, meta: { label: "Expiry Date" }, cell: ({ row }) => <CalendarDateCell value={row.original.expiryDate} tracked={Boolean(row.original.trackExpiry)} /> },
    text("productType", "Product Type", 130, false, false),
    text("productGroup", "Product Group", 130, true, false),
    text("warehouse", "Warehouse", 190, true),
    text("locationGroup", "Location Group", 130, true, false),
    text("locationZone", "Location Zone", 120, true),
    text("locationType", "Location Type", 120, true, false),
    text("areaType", "Area Type", 110, true, false),
    text("replenishmentType", "Replenishment Location Type", 150, true, false),
    { ...qty("walkingPathPriority", "Walking Path Priority", true, false), cell: ({ row }) => <Qty value={row.original.walkingPathPriority} muteZero={false} /> },
    text("poNumber", "PO Number", 120, false, false),
    text("lpNumber", "LPN", 130, true),
    text("parentLpNumber", "Parent LP", 120, false, false),
    text("originalLpNumber", "Original LP Number", 140, false, false),
    text("lpType", "LP Type", 110, true, false),
    text("parentLpType", "Parent LP Type", 120, false, false),
    text("originalParentLpNumber", "Original Parent LP", 140, false, false),
    text("mobileCart", "Mobile Cart", 110, false, false),
    { id: "status", accessorKey: "status", header: "Inventory Status", size: headerWidth("Inventory Status", 130), meta: { label: "Inventory Status", clip: false }, cell: ({ row }) => <InventoryStatusPill status={row.original.status} /> },
    { id: "damageReason", accessorKey: "damageReason", header: "Damage Reason", size: 170, meta: { label: "Damage Reason", clip: false }, cell: ({ row }) => <DamagePill reason={row.original.damageReason} /> },
    { id: "receivedAt", accessorKey: "receivedAt", header: "Receiving Date", size: 172, meta: { label: "Receiving Date" }, cell: ({ row }) => <DateCell value={row.original.receivedAt} /> },
    { id: "productionDate", accessorKey: "productionDate", header: "Production Date", size: 140, meta: { label: "Production Date", defaultVisible: false }, cell: ({ row }) => <CalendarDateCell value={row.original.productionDate} tracked={Boolean(row.original.trackProductionDate)} /> },
    {
      id: "rowActions", header: () => <span className="sr-only">Actions</span>, size: 48, minSize: 48, enableSorting: false, enableResizing: false, enableHiding: false,
      meta: { label: "Actions", sticky: "right", alwaysVisible: true, clip: false, justify: "center", cellPadding: "px-1" },
      cell: ({ row }) => <ActionsCell row={row.original} handlers={handlers} />,
    },
  ];
}
