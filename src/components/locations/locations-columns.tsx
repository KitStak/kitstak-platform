"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { LocationListRow } from "@/server/repositories/locations";
import { cn, formatNumber } from "@/lib/utils";
import {
  ActiveDot,
  LocationRowActions,
  TypePill,
  UtilizationBar,
  ZonePill,
} from "./location-cells";

function NumberCell({ value, dimZero }: { value: number; dimZero?: boolean }) {
  return (
    <span
      className={cn(
        "block w-full pr-3 text-right tabular-nums",
        dimZero && value === 0 ? "text-faint" : "text-body"
      )}
    >
      {formatNumber(value)}
    </span>
  );
}

export const LOCATION_COLUMNS: ColumnDef<LocationListRow, unknown>[] = [
  {
    accessorKey: "code",
    header: "Location Code",
    size: 130,
    cell: ({ row }) => (
      <span className="cursor-pointer font-mono text-[12.5px] font-medium text-primary hover:underline">
        {row.original.code}
      </span>
    ),
  },
  {
    accessorKey: "warehouseCode",
    header: "Warehouse",
    size: 100,
    cell: ({ row }) => (
      <span className="text-secondary">{row.original.warehouseCode}</span>
    ),
  },
  {
    accessorKey: "zone",
    header: "Zone",
    size: 84,
    cell: ({ row }) => <ZonePill zone={row.original.zone} />,
  },
  {
    accessorKey: "aisle",
    header: "Aisle",
    size: 64,
    cell: ({ row }) => (
      <span className="tabular-nums text-secondary">{row.original.aisle}</span>
    ),
  },
  {
    accessorKey: "bay",
    header: "Bay",
    size: 60,
    cell: ({ row }) => (
      <span className="tabular-nums text-secondary">{row.original.bay}</span>
    ),
  },
  {
    accessorKey: "level",
    header: "Level",
    size: 64,
    cell: ({ row }) => (
      <span className="tabular-nums text-secondary">{row.original.level}</span>
    ),
  },
  {
    accessorKey: "type",
    header: "Type",
    size: 100,
    cell: ({ row }) => <TypePill type={row.original.type} />,
  },
  {
    accessorKey: "capacityUnits",
    header: "Capacity",
    size: 90,
    cell: ({ row }) => <NumberCell value={row.original.capacityUnits} />,
  },
  {
    accessorKey: "storedUnits",
    header: "Stored",
    size: 80,
    cell: ({ row }) => <NumberCell value={row.original.storedUnits} dimZero />,
  },
  {
    id: "utilization",
    header: "Utilization",
    size: 128,
    enableSorting: false,
    cell: ({ row }) => (
      <UtilizationBar
        stored={row.original.storedUnits}
        capacity={row.original.capacityUnits}
      />
    ),
  },
  {
    accessorKey: "skuCount",
    header: "SKUs",
    size: 64,
    cell: ({ row }) => <NumberCell value={row.original.skuCount} dimZero />,
  },
  {
    accessorKey: "isActive",
    header: "Active",
    size: 76,
    cell: ({ row }) => <ActiveDot active={row.original.isActive} />,
  },
  {
    id: "actions",
    header: "",
    size: 44,
    enableSorting: false,
    cell: ({ row }) => <LocationRowActions code={row.original.code} />,
  },
];
