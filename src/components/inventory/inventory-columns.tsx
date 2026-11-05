"use client";

import type { ColumnDef } from "@tanstack/react-table";
import type {
  AtpRow,
  LocationInventoryRow,
  TotalInventoryRow,
} from "@/server/repositories/inventory";
import { formatDate, formatNumber } from "@/lib/utils";
import {
  AvailableCell,
  ImageTile,
  IncomingCell,
  QtyCell,
  ReorderStatus,
  SkuLink,
  ZoneChip,
} from "./inventory-cells";
import {
  deriveNextPoEta,
  deriveReorderPoint,
  deriveUom,
} from "./inventory-derive";

/* ============ Total Inventory ============ */

export const totalColumns: ColumnDef<TotalInventoryRow, unknown>[] = [
  {
    id: "image",
    header: "Image",
    size: 56,
    enableSorting: false,
    cell: () => <ImageTile />,
  },
  {
    accessorKey: "clientName",
    header: "Client",
    cell: ({ row }) => (
      <span className="block max-w-[150px] truncate text-secondary">
        {row.original.clientName}
      </span>
    ),
  },
  {
    accessorKey: "sku",
    header: "SKU",
    cell: ({ row }) => (
      <SkuLink
        sku={row.original.sku}
        productId={row.original.productId}
        isKit={row.original.isKit}
      />
    ),
  },
  {
    accessorKey: "productName",
    header: "Product Name",
    cell: ({ row }) => (
      <span className="block max-w-[260px] truncate text-body">
        {row.original.productName}
      </span>
    ),
  },
  {
    accessorKey: "category",
    header: "Category",
    cell: ({ row }) => (
      <span className="text-secondary">{row.original.category}</span>
    ),
  },
  {
    id: "uom",
    header: "UoM",
    size: 70,
    accessorFn: (row) => deriveUom(row.category, row.isKit),
    cell: ({ row }) => (
      <span className="text-secondary">
        {deriveUom(row.original.category, row.original.isKit)}
      </span>
    ),
  },
  {
    accessorKey: "onHand",
    header: "On Hand",
    size: 90,
    cell: ({ row }) => <QtyCell value={row.original.onHand} />,
  },
  {
    accessorKey: "allocated",
    header: "Allocated",
    size: 95,
    cell: ({ row }) => <QtyCell value={row.original.allocated} />,
  },
  {
    accessorKey: "damaged",
    header: "Damaged",
    size: 90,
    cell: ({ row }) => (
      <QtyCell
        value={row.original.damaged}
        className={row.original.damaged > 0 ? "text-danger" : undefined}
      />
    ),
  },
  {
    accessorKey: "available",
    header: "Available",
    size: 95,
    cell: ({ row }) => <AvailableCell value={row.original.available} />,
  },
  {
    id: "reorderPoint",
    header: "Reorder Point",
    size: 110,
    accessorFn: (row) => deriveReorderPoint(row.sku),
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-secondary">
        {formatNumber(deriveReorderPoint(row.original.sku))}
      </div>
    ),
  },
  {
    id: "belowReorder",
    header: "Below Reorder",
    size: 115,
    accessorFn: (row) => row.available < deriveReorderPoint(row.sku),
    cell: ({ row }) => (
      <ReorderStatus
        available={row.original.available}
        reorderPoint={deriveReorderPoint(row.original.sku)}
      />
    ),
  },
];

/* ============ Inventory by Location ============ */

export const byLocationColumns: ColumnDef<LocationInventoryRow, unknown>[] = [
  {
    accessorKey: "locationCode",
    header: "Location Code",
    cell: ({ row }) => (
      <span className="font-mono text-[12px] font-medium text-body">
        {row.original.locationCode}
      </span>
    ),
  },
  {
    accessorKey: "zone",
    header: "Zone",
    size: 90,
    cell: ({ row }) => <ZoneChip zone={row.original.zone} />,
  },
  {
    accessorKey: "sku",
    header: "SKU",
    cell: ({ row }) => <SkuLink sku={row.original.sku} />,
  },
  {
    accessorKey: "productName",
    header: "Product",
    cell: ({ row }) => (
      <span className="block max-w-[240px] truncate text-body">
        {row.original.productName}
      </span>
    ),
  },
  {
    accessorKey: "clientName",
    header: "Client",
    cell: ({ row }) => (
      <span className="block max-w-[140px] truncate text-secondary">
        {row.original.clientName}
      </span>
    ),
  },
  {
    accessorKey: "lotNumber",
    header: "Lot #",
    cell: ({ row }) =>
      row.original.lotNumber ? (
        <span className="font-mono text-[12px] text-secondary">
          {row.original.lotNumber}
        </span>
      ) : (
        <span className="text-faint">—</span>
      ),
  },
  {
    accessorKey: "onHand",
    header: "On Hand",
    size: 90,
    cell: ({ row }) => <QtyCell value={row.original.onHand} />,
  },
  {
    accessorKey: "allocated",
    header: "Allocated",
    size: 95,
    cell: ({ row }) => <QtyCell value={row.original.allocated} />,
  },
  {
    accessorKey: "receivedAt",
    header: "Received",
    cell: ({ row }) => (
      <span className="text-secondary">{formatDate(row.original.receivedAt)}</span>
    ),
  },
];

/* ============ Available to Promise ============ */

export const atpColumns: ColumnDef<AtpRow, unknown>[] = [
  {
    accessorKey: "sku",
    header: "SKU",
    cell: ({ row }) => (
      <SkuLink sku={row.original.sku} productId={row.original.productId} />
    ),
  },
  {
    accessorKey: "productName",
    header: "Product",
    cell: ({ row }) => (
      <span className="block max-w-[260px] truncate text-body">
        {row.original.productName}
      </span>
    ),
  },
  {
    accessorKey: "clientName",
    header: "Client",
    cell: ({ row }) => (
      <span className="block max-w-[150px] truncate text-secondary">
        {row.original.clientName}
      </span>
    ),
  },
  {
    accessorKey: "onHand",
    header: "On Hand",
    size: 90,
    cell: ({ row }) => <QtyCell value={row.original.onHand} />,
  },
  {
    accessorKey: "allocated",
    header: "Allocated",
    size: 95,
    cell: ({ row }) => <QtyCell value={row.original.allocated} />,
  },
  {
    accessorKey: "available",
    header: "Available",
    size: 95,
    cell: ({ row }) => <AvailableCell value={row.original.available} />,
  },
  {
    accessorKey: "incoming",
    header: "Incoming",
    size: 95,
    cell: ({ row }) => <IncomingCell value={row.original.incoming} />,
  },
  {
    accessorKey: "atp",
    header: "ATP Total",
    size: 95,
    cell: ({ row }) => (
      <div className="text-right tabular-nums font-semibold text-foreground">
        {formatNumber(row.original.atp)}
      </div>
    ),
  },
  {
    id: "nextPoEta",
    header: "Next PO ETA",
    size: 110,
    accessorFn: (row) => deriveNextPoEta(row.sku, row.incoming)?.getTime() ?? 0,
    cell: ({ row }) => {
      const eta = deriveNextPoEta(row.original.sku, row.original.incoming);
      return eta ? (
        <span className="text-secondary">{formatDate(eta)}</span>
      ) : (
        <span className="text-faint">—</span>
      );
    },
  },
];
