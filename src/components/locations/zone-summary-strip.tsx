"use client";

import * as React from "react";
import type { ZoneSummaryRow } from "@/server/repositories/locations";
import { cn, formatNumber } from "@/lib/utils";
import { Skeleton } from "@/components/ui/card";
import { utilizationPct, utilizationTone } from "./location-cells";

export interface ZoneSummaryStripProps {
  zones: ZoneSummaryRow[];
  loading: boolean;
  activeZone: string;
  onZoneSelect: (zone: string) => void;
}

const SKELETON_CARD_COUNT = 6;

/**
 * Human-readable card labels. The chip already carries the raw zone code,
 * so special zones get real names instead of repeating it ("Zone RECV"),
 * and storage zones get a short role descriptor.
 */
const ZONE_LABELS: Record<string, string> = {
  A: "Zone A — Fast pick",
  B: "Zone B — Case pick",
  C: "Zone C — Slow pick",
  D: "Zone D — Overflow",
  RECV: "Receiving",
  RET: "Returns",
  SHIP: "Shipping",
};

function zoneLabel(zone: string): string {
  return ZONE_LABELS[zone] ?? `Zone ${zone}`;
}

function ZoneCard({
  zone,
  active,
  onSelect,
}: {
  zone: ZoneSummaryRow;
  active: boolean;
  onSelect: (zone: string) => void;
}) {
  const pct = utilizationPct(zone.storedUnits, zone.capacityUnits);
  const tone = utilizationTone(pct);
  // Multi-letter tokens (RECV, RET, SHIP) get a smaller, slightly tightened
  // face so they keep >=3px of horizontal padding per side inside the badge
  // and match the optical weight of the single-letter A–D badges.
  const isSpecialZoneCode = zone.zone.length > 1;
  return (
    <button
      type="button"
      onClick={() => onSelect(zone.zone)}
      aria-pressed={active}
      title={`${formatNumber(zone.storedUnits)} of ${formatNumber(zone.capacityUnits)} units stored`}
      className={cn(
        // flex-1 basis-0 with a 168px floor lets all 7 cards share a 1440px
        // viewport without clipping; narrower viewports fall back to the
        // container's horizontal scroll.
        "flex min-w-[168px] flex-1 basis-0 flex-col gap-2.5 rounded-lg border bg-surface px-3.5 py-3 text-left shadow-xs transition-colors",
        "outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        active
          ? "border-primary bg-primary-soft/40"
          : "border-border hover:border-border-strong hover:bg-surface-sunken"
      )}
    >
      <span className="flex items-center gap-2.5">
        <span
          aria-hidden
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-blue-600 text-white",
            isSpecialZoneCode
              ? "text-[8px] font-semibold tracking-[-0.01em]"
              : "text-[13px] font-bold"
          )}
        >
          {zone.zone}
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span
            className="truncate text-[12px] font-semibold text-foreground"
            title={zoneLabel(zone.zone)}
          >
            {zoneLabel(zone.zone)}
          </span>
          <span className="text-[11px] text-faint">
            {formatNumber(zone.binCount)} bins
          </span>
        </span>
      </span>
      <span className="flex items-center gap-2">
        <span className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-soft">
          <span
            className={cn("block h-full rounded-full", tone.bar)}
            style={{ width: `${pct}%` }}
          />
        </span>
        <span
          className={cn(
            "w-8 shrink-0 text-right text-[11px] font-medium tabular-nums",
            tone.text
          )}
        >
          {pct}%
        </span>
      </span>
    </button>
  );
}

/** Horizontal strip of per-zone capacity cards above the locations grid. */
export function ZoneSummaryStrip({
  zones,
  loading,
  activeZone,
  onZoneSelect,
}: ZoneSummaryStripProps) {
  if (!loading && zones.length === 0) return null;
  return (
    <div className="px-6 pt-4">
      <div className="ks-scroll flex gap-3 overflow-x-auto pb-1">
        {loading
          ? Array.from({ length: SKELETON_CARD_COUNT }).map((_, i) => (
              <div
                key={i}
                className="flex min-w-[168px] flex-1 basis-0 flex-col gap-2.5 rounded-lg border border-border bg-surface px-3.5 py-3 shadow-xs"
              >
                <div className="flex items-center gap-2.5">
                  <Skeleton className="h-8 w-8 rounded-md" />
                  <div className="flex flex-col gap-1.5">
                    <Skeleton className="h-3 w-14" />
                    <Skeleton className="h-2.5 w-10" />
                  </div>
                </div>
                <Skeleton className="h-1 w-full rounded-full" />
              </div>
            ))
          : zones.map((zone) => (
              <ZoneCard
                key={zone.zone}
                zone={zone}
                active={activeZone === zone.zone}
                onSelect={(z) => onZoneSelect(activeZone === z ? "" : z)}
              />
            ))}
      </div>
    </div>
  );
}
