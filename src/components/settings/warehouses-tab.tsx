"use client";

import * as React from "react";
import { MapPin, MoreHorizontal, Warehouse } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import type { WarehouseCard } from "./types";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-[88px] flex-col items-end gap-0.5">
      <span className="text-[14px] font-semibold tabular-nums text-foreground">
        {value}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-faint">
        {label}
      </span>
    </div>
  );
}

function WarehouseRow({ warehouse }: { warehouse: WarehouseCard }) {
  return (
    <Card className="flex items-center gap-4 px-5 py-4 transition-shadow hover:shadow-sm">
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
          warehouse.isDefault
            ? "bg-primary-soft text-primary"
            : "bg-neutral-soft text-neutral"
        )}
      >
        <Warehouse className="h-5 w-5" aria-hidden />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="truncate text-[14px] font-semibold text-primary hover:underline focus-visible:underline focus-visible:outline-none"
          >
            {warehouse.code} — {warehouse.name}
          </button>
          {warehouse.isDefault ? (
            <span className="inline-flex items-center rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-primary">
              Default
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-secondary">
          <MapPin className="h-3 w-3 shrink-0 text-faint" aria-hidden />
          {warehouse.addressLine}, {warehouse.city}, {warehouse.state}
        </p>
      </div>

      <div className="hidden items-center gap-6 sm:flex">
        <Stat label="Zones" value={formatNumber(warehouse.zoneCount)} />
        <Stat label="Bin Locations" value={formatNumber(warehouse.binCount)} />
        <Stat label="Capacity" value={`${formatNumber(warehouse.capacityUnits)} u`} />
      </div>

      <Dropdown
        align="end"
        trigger={() => (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${warehouse.code}`}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </Button>
        )}
      >
        <DropdownItem>Edit Warehouse</DropdownItem>
        <DropdownItem>Manage Locations</DropdownItem>
        <DropdownItem disabled={warehouse.isDefault}>Set as Default</DropdownItem>
        <DropdownSeparator />
        <DropdownItem destructive>Deactivate</DropdownItem>
      </Dropdown>
    </Card>
  );
}

export interface WarehousesTabProps {
  warehouses: WarehouseCard[];
}

export function WarehousesTab({ warehouses }: WarehousesTabProps) {
  return (
    <div className="flex flex-col gap-3 px-6 py-4">
      <p className="text-[12px] text-faint">
        Warehouses define the physical sites KitStak allocates, picks and ships
        from. The default warehouse is preselected on new orders and receipts.
      </p>
      {warehouses.map((warehouse) => (
        <WarehouseRow key={warehouse.id} warehouse={warehouse} />
      ))}
    </div>
  );
}
