"use client";

/**
 * Builds TanStack columns from the pure M03 column catalogs (`@/lib/grid-defs/jobs/columns`).
 * Each screen passes `cells` overrides for its links and special cells.
 */
import * as React from "react";
import type { ColumnDef, CellContext } from "@tanstack/react-table";
import { DATE_TIME_COLUMN_WIDTH, DateCell, QtyCell, YesNoPill } from "@/components/grid/cells";
import { PriorityFlag, StatusPill } from "@/components/ui/status-pill";
import type { StatusDomain } from "@/lib/status-colors";
import type { JobsColumnDef } from "@/lib/grid-defs/jobs/columns";

export type CellRenderer<T> = (ctx: CellContext<T, unknown>) => React.ReactNode;

export const Dash = () => <span className="text-faint">—</span>;

export function textCell(v: unknown): React.ReactNode {
  return v === null || v === undefined || v === "" ? <Dash /> : <span className="truncate" title={String(v)}>{String(v)}</span>;
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
      return function StatusCell({ getValue }) { return getValue() ? <StatusPill status={String(getValue())} domain={domain} /> : <Dash />; };
    case "priority":
      return function PriorityCell({ getValue }) { return <PriorityFlag priority={String(getValue() ?? "None")} />; };
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
    const width = def.width ?? (def.kind === "datetime" ? DATE_TIME_COLUMN_WIDTH : 140);
    return {
      id: def.id,
      accessorKey: def.id,
      header: def.label,
      size: width,
      minSize: Math.min(width, 64),
      enableSorting: def.sortable !== false,
      enableHiding: def.id !== primary,
      meta: {
        label: def.label,
        headerTip: def.tip,
        defaultVisible: def.defaultVisible !== false,
        alwaysVisible: def.id === primary,
        align: numeric ? "right" : undefined,
        clip: !["status", "priority", "boolean"].includes(def.kind) && def.kind !== "custom",
      },
      cell: cells[def.id] ?? defaultCell<T>(def, statusDomain),
    };
  });
}
