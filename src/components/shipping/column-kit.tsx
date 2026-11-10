"use client";

/**
 * Small column builder for the M02 grids: one spec line per column (id, label, kind,
 * width) becomes a TanStack column with the shared cells (dates, money, quantities,
 * Yes/No pills) and grid meta (chooser label, alignment, default visibility).
 */
import type { ColumnDef } from "@tanstack/react-table";
import { DATE_TIME_COLUMN_WIDTH, DateCell, MoneyCell, QtyCell, YesNoPill } from "@/components/grid/cells";
import { StatusPill } from "@/components/ui/status-pill";
import { statusTone } from "@/lib/status-colors";

export type ColumnKind = "text" | "datetime" | "date" | "money" | "number" | "integer" | "boolean";

export interface ColumnSpec<T> {
  readonly id: string;
  readonly label: string;
  readonly kind?: ColumnKind;
  readonly width?: number;
  readonly sortable?: boolean;
  readonly hidden?: boolean;
  readonly always?: boolean;
  readonly decimals?: number;
  readonly cell?: (row: T) => React.ReactNode;
  /** Plain value for exports when the cell is custom (defaults to `row[id]`). */
  readonly exportKey?: string;
}

export const dash = <span className="text-faint">—</span>;

export function textCell(value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === "") return dash;
  return <span className="truncate">{String(value)}</span>;
}

function numberCell(value: unknown, decimals: number | undefined): React.ReactNode {
  if (value === null || value === undefined || value === "") return dash;
  const n = Number(value);
  if (!Number.isFinite(n)) return dash;
  if (decimals === undefined) return <QtyCell value={n} />;
  return <span className="block text-right tabular-nums">{n.toFixed(decimals)}</span>;
}

function defaultCell<T>(spec: ColumnSpec<T>, value: unknown, row: T): React.ReactNode {
  switch (spec.kind) {
    case "datetime":
      return <DateCell value={value as string | null} />;
    case "date":
      return <DateCell value={value as string | null} dateOnly />;
    case "money":
      return <MoneyCell value={value as number | null} currency={String((row as Record<string, unknown>).currency ?? "USD")} />;
    case "number":
    case "integer":
      return numberCell(value, spec.decimals);
    case "boolean":
      return <YesNoPill value={Boolean(value)} />;
    default:
      return textCell(value);
  }
}

export function buildColumns<T>(specs: readonly ColumnSpec<T>[]): ColumnDef<T, unknown>[] {
  return specs.map((spec): ColumnDef<T, unknown> => {
    const numeric = spec.kind === "money" || spec.kind === "number" || spec.kind === "integer";
    const width = spec.width ?? (spec.kind === "datetime" ? DATE_TIME_COLUMN_WIDTH : spec.kind === "boolean" ? 110 : numeric ? 104 : 150);
    return {
      id: spec.id,
      accessorKey: spec.id,
      header: spec.label,
      size: width,
      minSize: Math.min(width, 64),
      enableSorting: spec.sortable !== false,
      enableHiding: !spec.always,
      meta: { label: spec.label, defaultVisible: !spec.hidden, alwaysVisible: Boolean(spec.always), align: numeric ? "right" : undefined, clip: !spec.cell },
      cell: ({ row, getValue }) => (spec.cell ? spec.cell(row.original) : defaultCell(spec, getValue(), row.original)),
    };
  });
}

export function exportColumnsOf<T>(specs: readonly ColumnSpec<T>[]): readonly { readonly key: string; readonly label: string }[] {
  return specs.map((s) => ({ key: s.exportKey ?? s.id, label: s.label }));
}

/** Shipping label / Return label pill (blue / purple, BUILD_PLAN 0.5). */
export function LabelTypePill({ type }: { readonly type: string }) {
  const isReturn = type.toLowerCase().startsWith("return");
  const tone = statusTone(isReturn ? "return" : "shipping", "labelType");
  return (
    <span style={{ backgroundColor: tone.bg, color: tone.fg }} className="inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4">
      {isReturn ? "Return label" : "Shipping label"}
    </span>
  );
}

/** Active (green) / Voided (red) label status. */
export function LabelStatusPill({ status }: { readonly status: string }) {
  const tone = status === "Voided" ? statusTone("cancelled", "shipmentOrder") : statusTone("active", "active");
  return (
    <span data-status={status} style={{ backgroundColor: tone.bg, color: tone.fg }} className="inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4">
      {status}
    </span>
  );
}

export { StatusPill };
