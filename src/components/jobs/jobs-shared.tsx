"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
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

/** Link-styled job code (Logiwa renders these as links; no detail page yet).
 *  tabular-nums + tracking-normal so job codes and wave numbers — the two
 *  code columns sitting side by side — set with identical numeral spacing. */
export function JobCode({ code }: { code: string }) {
  return (
    <span className="font-medium tabular-nums tracking-normal text-primary">
      {code}
    </span>
  );
}

/**
 * Jobs-local grid search. The shared GridSearch is fixed at 240px and its
 * placeholder clips mid-phrase with no ellipsis; this variant is 280px wide
 * and guards the placeholder with nowrap + hidden overflow + ellipsis.
 */
export function JobsGridSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
        aria-hidden
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 w-[280px] overflow-hidden text-ellipsis whitespace-nowrap rounded-md border border-border-strong/70 bg-surface pl-8 pr-7 text-[13px] text-body transition-colors placeholder:overflow-hidden placeholder:text-ellipsis placeholder:whitespace-nowrap placeholder:text-faint hover:border-border-strong focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-faint transition-colors hover:text-secondary"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

export interface GridOverflowFade {
  top: number;
  height: number;
}

/**
 * Watches the grid's horizontal scroller (the shared DataGrid's table
 * wrapper) and reports where to draw a right-edge fade while more columns
 * remain off-screen; returns null once scrolled fully right or when the
 * columns fit. Read-only DOM observation — the shared grid is untouched.
 */
export function useGridOverflowFade(
  rootRef: React.RefObject<HTMLDivElement | null>
): GridOverflowFade | null {
  const [fade, setFade] = React.useState<GridOverflowFade | null>(null);

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const table = root.querySelector("table");
    const scroller = table?.parentElement;
    if (!table || !scroller) return;

    const update = () => {
      const hasMoreRight =
        scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1;
      if (!hasMoreRight) {
        setFade(null);
        return;
      }
      const next: GridOverflowFade = {
        top:
          scroller.getBoundingClientRect().top - root.getBoundingClientRect().top,
        height: scroller.clientHeight,
      };
      setFade((prev) =>
        prev && prev.top === next.top && prev.height === next.height ? prev : next
      );
    };

    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    observer.observe(table);
    return () => {
      scroller.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [rootRef]);

  return fade;
}
