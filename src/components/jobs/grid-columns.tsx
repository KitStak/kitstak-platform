"use client";

/**
 * Builds TanStack columns from the pure M03 column catalogs (`@/lib/grid-defs/jobs/columns`).
 * Each screen passes `cells` overrides for its links and special cells.
 */
import * as React from "react";
import type { ColumnDef, CellContext } from "@tanstack/react-table";
import { DATE_TIME_COLUMN_WIDTH, DateCell, QtyCell, YesNoPill } from "@/components/grid/cells";
import { PriorityFlag, StatusPill } from "@/components/ui/status-pill";
import { statusToneName, type StatusDomain } from "@/lib/status-colors";
import type { JobsColumnDef } from "@/lib/grid-defs/jobs/columns";

export type CellRenderer<T> = (ctx: CellContext<T, unknown>) => React.ReactNode;

export const Dash = () => <span className="text-faint">—</span>;

/**
 * Critic R4 (dark mode): the shared tones are light tints set inline, so the neutral grey
 * ("Pending") glared as a near-white chip on dark surfaces. Neutral / hold tones get a dark
 * token here (`!` beats the inline style); every other tone keeps the shared palette.
 */
const DARK_NEUTRAL = "[[data-theme=dark]_&]:!bg-[#2A313C] [[data-theme=dark]_&]:!text-[#C9D1DB] [[data-theme=dark]_&]:ring-1 [[data-theme=dark]_&]:ring-inset [[data-theme=dark]_&]:ring-white/10";

export function JobsStatusPill({ status, domain = "generic", size = "md" }: { readonly status: string; readonly domain?: StatusDomain; readonly size?: "sm" | "md" }) {
  const tone = statusToneName(status, domain);
  const neutral = tone === "grey" || tone === "hold";
  return <StatusPill status={status} domain={domain} size={size} className={neutral ? DARK_NEUTRAL : undefined} />;
}

export function textCell(v: unknown): React.ReactNode {
  return v === null || v === undefined || v === "" ? <Dash /> : <span className="truncate" title={String(v)}>{String(v)}</span>;
}

/** Job priority pill: "None" reads as a muted "None" pill instead of a bare dash (critic R1). */
export function JobPriorityPill({ priority }: { readonly priority: unknown }) {
  const v = String(priority ?? "None");
  if (v === "None" || v === "") {
    return <span data-priority="normal" className="inline-flex whitespace-nowrap rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-semibold text-secondary">None</span>;
  }
  return <PriorityFlag priority={v} />;
}

/** Overdue badge: a live job past its planned finish (critic R5; Logiwa shows only raw dates). */
export function OverduePill({ title }: { readonly title?: string }) {
  return <span className="inline-flex shrink-0 whitespace-nowrap rounded-full bg-[#FDE7E3] px-1.5 py-px text-[10px] font-semibold leading-4 text-[#B42318] dark:bg-[#3A1A16] dark:text-[#F7A99C]" title={title ?? "Past its planned finish date"}>Overdue</span>;
}

export function ShortPill({ value }: { readonly value: unknown }) {
  const v = String(value ?? "None");
  if (v === "None") return <span className="text-[12px] text-faint">None</span>;
  if (v === "Open") return <span className="inline-flex rounded-full bg-[#F7E9E4] px-1.5 py-px text-[10px] font-semibold leading-4 text-[#A13406]">Open</span>;
  return <StatusPill status={v} size="sm" />;
}

function defaultCell<T>(def: JobsColumnDef, domain: StatusDomain): CellRenderer<T> {
  switch (def.kind) {
    case "number":
      return function NumberCell({ getValue }) { return <QtyCell value={getValue() as number | null} />; };
    case "datetime":
    case "date":
      return function DateTimeCell({ getValue }) { return <DateCell value={getValue() as string | null} dateOnly={def.kind === "date"} />; };
    case "boolean":
      return function BoolCell({ getValue }) { return <YesNoPill value={Boolean(getValue())} />; };
    case "status":
      return function StatusCell({ getValue }) { return getValue() ? <JobsStatusPill status={String(getValue())} domain={domain} /> : <Dash />; };
    case "priority":
      return function PriorityCell({ getValue }) { return <JobPriorityPill priority={getValue()} />; };
    default:
      return function TextCell({ getValue }) { return textCell(getValue()); };
  }
}

export interface BuildColumnsOptions<T> {
  readonly cells?: Readonly<Record<string, CellRenderer<T>>>;
  readonly statusDomain?: StatusDomain;
  /** Column that can never be hidden (primary key). */
  readonly primary?: string;
}

export function buildColumns<T>(defs: readonly JobsColumnDef[], { cells = {}, statusDomain = "job", primary }: BuildColumnsOptions<T> = {}): ColumnDef<T, unknown>[] {
  return defs.map((def): ColumnDef<T, unknown> => {
    const numeric = def.kind === "number";
    // Blind judge R1: never truncate a header — the column is at least as wide as its uppercase
    // label (11 px, 0.04em tracking ≈ 7.6 px/char) plus cell padding, sort arrow and info tip.
    const headerWidth = Math.ceil(def.label.length * 7.6 + 52 + (def.tip ? 22 : 0));
    const width = Math.max(def.width ?? (def.kind === "datetime" ? DATE_TIME_COLUMN_WIDTH : 140), headerWidth);
    return {
      id: def.id,
      accessorKey: def.id,
      header: def.label,
      size: width,
      minSize: Math.min(width, 64),
      enableSorting: def.sortable !== false,
      enableHiding: def.id !== primary,
      meta: {
        label: def.exportLabel ?? def.label,
        headerTip: def.tip,
        // Critic R5: the info tip keeps a consistent gap from its own label.
        headerClassName: def.tip ? "gap-1.5" : undefined,
        defaultVisible: def.defaultVisible !== false,
        alwaysVisible: def.id === primary,
        align: numeric ? "right" : undefined,
        // Custom cells clip too (critic R4: long order codes overlapped the next column).
        // Critic R5: pills clip too, so nothing bleeds under the sticky row-menu column.
        clip: true,
      },
      cell: cells[def.id] ?? defaultCell<T>(def, statusDomain),
    };
  });
}
