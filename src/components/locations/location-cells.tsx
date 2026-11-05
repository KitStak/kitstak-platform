"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";

/** Location type → semantic soft pill (per design spec color discipline). */
const TYPE_STYLES: Record<string, string> = {
  Picking: "bg-primary-soft text-primary",
  Reserve: "bg-neutral-soft text-neutral",
  Receiving: "bg-info-soft text-info",
  Shipping: "bg-success-soft text-success",
  Returns: "bg-warning-soft text-warning",
  Damaged: "bg-danger-soft text-danger",
  Bulk: "bg-neutral-soft text-neutral",
  Staging: "bg-info-soft text-info",
};

export function TypePill({ type }: { type: string }) {
  const style = TYPE_STYLES[type] ?? "bg-neutral-soft text-neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4",
        style
      )}
    >
      {type}
    </span>
  );
}

/**
 * Deliberately quiet: the zone repeats on every row of a filtered page, so
 * it renders as a borderless gray-50 chip at regular weight. Colored zone
 * treatment is reserved for the zone-letter avatars in the summary cards.
 */
export function ZonePill({ zone }: { zone: string }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded bg-surface-sunken px-1.5 py-0.5 text-[11px] font-normal leading-4 text-secondary">
      Zone {zone}
    </span>
  );
}

/** Red is reserved for critically full bins; amber warns; blue is healthy. */
const UTILIZATION_WARNING_PCT = 75;
const UTILIZATION_DANGER_PCT = 90;

export interface UtilizationTone {
  bar: string;
  text: string;
}

export function utilizationPct(stored: number, capacity: number): number {
  if (capacity <= 0) return 0;
  return Math.min(100, Math.round((stored / capacity) * 100));
}

/**
 * One semantic tone shared by the bar fill and the % text so they never
 * disagree: danger >=90%, warning 75-89%, primary (blue) below.
 */
export function utilizationTone(pct: number): UtilizationTone {
  if (pct >= UTILIZATION_DANGER_PCT) {
    return { bar: "bg-danger", text: "text-danger" };
  }
  if (pct >= UTILIZATION_WARNING_PCT) {
    return { bar: "bg-warning", text: "text-warning" };
  }
  return { bar: "bg-primary", text: "text-primary" };
}

export function UtilizationBar({
  stored,
  capacity,
}: {
  stored: number;
  capacity: number;
}) {
  // Empty bins (0 stored / 0 SKUs) read as "nothing here" rather than a
  // loud 0%: an empty track with a muted em dash.
  if (capacity <= 0 || stored <= 0) {
    return (
      <span className="flex w-28 items-center gap-2">
        <span className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-soft" />
        <span className="w-8 shrink-0 text-right text-[11px] font-medium text-faint">
          —
        </span>
      </span>
    );
  }
  const pct = utilizationPct(stored, capacity);
  const tone = utilizationTone(pct);
  return (
    <span className="flex w-28 items-center gap-2">
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
  );
}

export function ActiveDot({ active }: { active: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium">
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-success" : "bg-border-strong")}
      />
      <span className={active ? "text-body" : "text-faint"}>{active ? "Yes" : "No"}</span>
    </span>
  );
}

export function LocationRowActions({ code }: { code: string }) {
  return (
    <Dropdown
      align="end"
      trigger={() => (
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${code}`}>
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </Button>
      )}
    >
      {(close) => (
        <>
          <DropdownItem onClick={close}>View location</DropdownItem>
          <DropdownItem onClick={close}>Edit location</DropdownItem>
          <DropdownItem onClick={close}>Print label</DropdownItem>
          <DropdownSeparator />
          <DropdownItem destructive onClick={close}>
            Deactivate
          </DropdownItem>
        </>
      )}
    </Dropdown>
  );
}
