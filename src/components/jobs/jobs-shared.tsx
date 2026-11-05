"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { JobListRow } from "@/server/repositories/jobs";

export type { JobListRow };

/** Mirrors JOB_STATUSES / JOB_TYPES from the repository (values re-declared
 *  client-side so the server module never enters the browser bundle). */
export const JOB_STATUS_OPTIONS = [
  "Pending",
  "In Progress",
  "Completed",
  "Cancelled",
] as const;

export const JOB_TYPE_OPTIONS = [
  "Single Unit Orders",
  "Multi Item Orders",
  "B2B Order Picking",
  "Cycle Count",
  "Dynamic Replenishment",
] as const;

/** Standard list envelope returned by every /api list route. */
export interface ListEnvelope<T> {
  success: boolean;
  data?: T[];
  error?: string;
  meta?: { total: number; page: number; pageSize: number };
}

/** Small deterministic hash so derived display values are stable per row. */
export function hashOf(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) % 2147483647;
  }
  return h;
}

/** Jobs aren't warehouse-scoped in the schema yet; derive a stable,
 *  believable warehouse from the job code (MLT1 is the default context). */
export function warehouseOf(code: string): string {
  return hashOf(code) % 6 === 0 ? "KS2 – Overflow" : "MLT1 – Main Fulfillment";
}

const AVATAR_TILES = [
  "bg-primary-soft text-primary",
  "bg-info-soft text-info",
  "bg-success-soft text-success",
  "bg-warning-soft text-warning",
  "bg-neutral-soft text-neutral",
] as const;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
  return (first + last).toUpperCase();
}

export function AssigneeCell({ name }: { name: string | null }) {
  if (!name) {
    return <span className="text-[12px] text-faint">Unassigned</span>;
  }
  const tile = AVATAR_TILES[hashOf(name) % AVATAR_TILES.length];
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
          tile
        )}
        aria-hidden
      >
        {initialsOf(name)}
      </span>
      <span className="text-[13px] text-body">{name}</span>
    </span>
  );
}

export function ProgressCell({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <span
      className="inline-flex items-center gap-2"
      title={`${completed.toLocaleString()} of ${total.toLocaleString()} units`}
    >
      <span className="h-1 w-16 overflow-hidden rounded-full bg-neutral-soft">
        <span
          className={cn(
            "block h-full rounded-full transition-[width]",
            clamped >= 100 ? "bg-success" : clamped > 0 ? "bg-primary" : "bg-border-strong"
          )}
          style={{ width: `${clamped}%` }}
        />
      </span>
      <span className="w-9 text-right text-[12px] tabular-nums text-secondary">
        {clamped}%
      </span>
    </span>
  );
}

/** Link-styled job code (Logiwa renders these as links; no detail page yet). */
export function JobCode({ code }: { code: string }) {
  return <span className="font-medium text-primary">{code}</span>;
}
