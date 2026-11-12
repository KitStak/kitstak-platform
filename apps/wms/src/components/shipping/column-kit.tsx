"use client";

/**
 * Small column builder for the M02 grids: one spec line per column (id, label, kind,
 * width) becomes a TanStack column with the shared cells (dates, money, quantities,
 * Yes/No pills) and grid meta (chooser label, alignment, default visibility).
 */
import type { ColumnDef } from "@tanstack/react-table";
import { DATE_TIME_COLUMN_WIDTH, DateCell, MoneyCell, QtyCell, YesNoPill } from "@/components/grid/cells";
import { StatusPill } from "@/components/ui/status-pill";
import { formatGridDateTime } from "@/lib/format";
import { pillStyle, statusTone } from "@/lib/status-colors";

/** One module-wide date-time format: zero-padded, no seconds ("11/05/2026 9:15 AM"). */
export const shipDateTime = (value: string | Date | null | undefined): string => (value ? formatGridDateTime(value) : "—");
/** Date-only twin of shipDateTime ("11/05/2026"); a bare YYYY-MM-DD is read as that calendar day. */
export const shipDay = (value: string | null | undefined): string => {
  if (!value) return "—";
  const v = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) ? `${value}T12:00:00` : value;
  return formatGridDateTime(v).split(" ")[0] ?? "—";
};

/**
 * Date-time in a warehouse's time zone with the zone label ("11/10/2026 4:29 AM EST"), the same clock the
 * End Of The Day PDF prints. Falls back to the viewer's zone when the zone id is unknown.
 */
export function formatInZone(value: string | Date | null | undefined, timeZone: string | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const make = (tz?: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" });
  let fmt: Intl.DateTimeFormat;
  try { fmt = make(timeZone || undefined); } catch { fmt = make(); }
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value])) as Record<string, string>;
  return `${p.month}/${p.day}/${p.year} ${p.hour}:${p.minute} ${p.dayPeriod ?? ""} ${p.timeZoneName ?? ""}`.replace(/\s+/g, " ").trim();
}

const CARRIER_MARKS: Readonly<Record<string, { readonly bg: string; readonly fg: string; readonly text: string }>> = {
  UPS: { bg: "#4B2E1E", fg: "#FFB500", text: "UPS" },
  USPS: { bg: "#1F3B6E", fg: "#FFFFFF", text: "USPS" },
  FEDEX: { bg: "#4D148C", fg: "#FF6200", text: "Fx" },
  DHL: { bg: "#FFCC00", fg: "#D40511", text: "DHL" },
  AMAZON: { bg: "#232F3E", fg: "#FF9900", text: "a" },
  ONTRAC: { bg: "#0B4F9C", fg: "#FFFFFF", text: "OT" },
};

/** Carrier mark + name, so the dock can scan the column (Logiwa shows a logo next to the carrier). */
export function CarrierMark({ code, title }: { readonly code: string; readonly title?: string }) {
  const key = code.toUpperCase().replace(/[^A-Z]/g, "");
  const mark = CARRIER_MARKS[key] ?? { bg: "var(--color-neutral-soft, #EEF0F3)", fg: "var(--color-body, #344054)", text: key.slice(0, 2) || "?" };
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={title ?? code}>
      <span aria-hidden style={{ backgroundColor: mark.bg, color: mark.fg }} className="inline-flex h-[18px] min-w-[26px] shrink-0 items-center justify-center rounded px-1 text-2xs font-extrabold leading-none tracking-tight">
        {mark.text}
      </span>
      {mark.text.toUpperCase() === key ? <span className="sr-only">{code}</span> : <span className="shrink-0 whitespace-nowrap">{code}</span>}
    </span>
  );
}

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
  /** Smallest width the user can resize the column to (defaults to 64 px or the width). */
  readonly minWidth?: number;
  readonly cell?: (row: T) => React.ReactNode;
  /** Plain value for exports when the cell is custom (defaults to `row[id]`). */
  readonly exportKey?: string;
}

export const dash = <span className="text-faint">—</span>;

export function textCell(value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === "") return dash;
  return <span className="block min-w-0 truncate" title={String(value)}>{String(value)}</span>;
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

/** Width an 11 px semibold uppercase header needs (≈7.2 px per glyph) plus padding and the sort arrow. */
export const headerMinWidth = (label: string): number => Math.ceil(label.length * 7.2) + 36;

export function buildColumns<T>(specs: readonly ColumnSpec<T>[]): ColumnDef<T, unknown>[] {
  return specs.map((spec): ColumnDef<T, unknown> => {
    const numeric = spec.kind === "money" || spec.kind === "number" || spec.kind === "integer";
    // Never narrower than its uppercase header (plus sort arrow and padding), so labels such as
    // "IS ALLOW SATURDAY DELIVERY" don't run into the next header.
    const width = Math.max(spec.width ?? (spec.kind === "datetime" ? DATE_TIME_COLUMN_WIDTH : spec.kind === "boolean" ? 110 : numeric ? 104 : 150), headerMinWidth(spec.label));
    return {
      id: spec.id,
      accessorKey: spec.id,
      header: spec.label,
      size: width,
      minSize: spec.minWidth ?? Math.min(width, 64),
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
    <span style={pillStyle(tone)} className="inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-semibold leading-4">
      {isReturn ? "Return label" : "Shipping label"}
    </span>
  );
}

/** Active (green) / Voided (red) label status. */
export function LabelStatusPill({ status }: { readonly status: string }) {
  const tone = status === "Voided" ? statusTone("cancelled", "shipmentOrder") : statusTone("active", "active");
  return (
    <span data-status={status} style={pillStyle(tone)} className="inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-semibold leading-4">
      {status}
    </span>
  );
}

export { StatusPill };
