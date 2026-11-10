"use client";

/**
 * Zone summary strip above the Locations grid. Each card shows bins, occupancy and stored
 * units for a zone; clicking toggles the `f.locationZoneId` filter (so it shows as a chip and
 * round-trips through the URL).
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export interface ZoneCardData {
  readonly zoneId: string | null;
  readonly zone: string;
  readonly warehouseCode?: string | null;
  readonly binCount: number;
  readonly occupiedCount: number;
  readonly storedUnits: number;
}

export function occupancyPct(zone: Pick<ZoneCardData, "binCount" | "occupiedCount">): number {
  return zone.binCount === 0 ? 0 : Math.round((zone.occupiedCount / zone.binCount) * 100);
}

function tone(pct: number): { bar: string; text: string } {
  if (pct >= 90) return { bar: "bg-danger", text: "text-danger" };
  if (pct >= 70) return { bar: "bg-warning", text: "text-warning" };
  return { bar: "bg-success", text: "text-success" };
}

function ZoneCard({ zone, active, showWarehouse, onSelect }: { readonly zone: ZoneCardData; readonly active: boolean; readonly showWarehouse: boolean; readonly onSelect: () => void }) {
  const pct = occupancyPct(zone);
  const t = tone(pct);
  const badge = zone.zoneId === null ? "—" : zone.zone.slice(0, 4).toUpperCase();
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      title={`${showWarehouse && zone.warehouseCode ? `${zone.warehouseCode} · ` : ""}${zone.occupiedCount.toLocaleString("en-US")} of ${zone.binCount.toLocaleString("en-US")} bins occupied · ${zone.storedUnits.toLocaleString("en-US")} units`}
      className={cn(
        "flex min-w-[176px] flex-1 basis-0 flex-col gap-2 rounded-lg border bg-surface px-3 py-2.5 text-left shadow-xs transition-[border-color,background-color,transform] duration-150",
        "outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.99]",
        active ? "border-primary bg-primary-soft/50 ring-1 ring-primary/30" : "border-border hover:border-border-strong hover:bg-surface-sunken",
      )}
    >
      <span className="flex items-center gap-2.5">
        <span aria-hidden className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white", zone.zoneId === null ? "bg-neutral" : "bg-primary", badge.length > 2 ? "text-[9px] font-semibold" : "text-[13px] font-bold")}>
          {badge}
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[12px] font-semibold text-foreground">{zone.zoneId === null ? "No zone" : `Zone ${zone.zone}`}</span>
            {showWarehouse && zone.warehouseCode ? <span className="shrink-0 rounded border border-border bg-surface-sunken px-1 text-[10px] font-medium leading-4 text-secondary">{zone.warehouseCode}</span> : null}
          </span>
          <span className="text-[11px] text-faint">{zone.binCount.toLocaleString("en-US")} bins · {zone.storedUnits.toLocaleString("en-US")} units</span>
        </span>
      </span>
      <span className="flex items-center gap-2">
        <span className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-soft">
          <span className={cn("block h-full rounded-full", t.bar)} style={{ width: `${pct}%` }} />
        </span>
        <span className={cn("w-9 shrink-0 text-right text-[11px] font-medium tabular-nums", t.text)}>{pct}%</span>
      </span>
    </button>
  );
}

export function ZoneSummaryStrip({ zones, loading, activeZoneId, onToggle }: { readonly zones: readonly ZoneCardData[]; readonly loading: boolean; readonly activeZoneId: string | null | undefined; readonly onToggle: (zoneId: string | null) => void }) {
  if (!loading && zones.length === 0) return null;
  // Without a single-warehouse filter the strip mixes warehouses: qualify each card with its warehouse.
  const warehouseCount = new Set(zones.map((z) => z.warehouseCode).filter(Boolean)).size;
  const showWarehouse = warehouseCount > 1;
  return (
    <div className="px-6 pt-3" aria-label="Zones">
      <div className="ks-scroll flex gap-2.5 overflow-x-auto pb-1">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[66px] min-w-[176px] flex-1 rounded-lg" />)
          : zones.map((z) => <ZoneCard key={z.zoneId ?? "none"} zone={z} showWarehouse={showWarehouse} active={activeZoneId !== undefined && activeZoneId === z.zoneId} onSelect={() => onToggle(z.zoneId)} />)}
      </div>
    </div>
  );
}
