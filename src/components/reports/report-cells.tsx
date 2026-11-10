"use client";

/**
 * Column factory for the report shell: turns a pure `ReportColumn` spec into a
 * TanStack column with the right cell (links, pills, money, dates, difference pills).
 */
import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DateCell, LinkCell, MoneyCell, QtyCell, YesNoPill } from "@/components/grid";
import { StatusPill } from "@/components/ui/status-pill";
import { differenceTone, TONES, type StatusTone } from "@/lib/status-colors";
import { useFormat } from "@/lib/format";
import type { ReportColumn } from "@/lib/grid-defs/reports/types";

export type ReportRow = Readonly<Record<string, unknown>>;

const LOCAL_TONES: Readonly<Record<string, StatusTone>> = {
  create: TONES.green,
  update: TONES.blue,
  delete: TONES.red,
  stock: TONES.green,
  allocated: TONES.blue,
  picked: TONES.readyBlue,
  sorted: TONES.indigo,
  packed: TONES.purple,
  loaded: TONES.purple,
  received: TONES.green,
  shipped: TONES.teal,
  updated: TONES.blue,
  "receipt cancelled": TONES.red,
  "shipment order cancelled": TONES.red,
};

const Empty = () => <span className="text-faint">—</span>;

export function ReportPill({ status, domain }: { readonly status: string; readonly domain?: ReportColumn["pill"] }) {
  if (domain) return <StatusPill status={status} domain={domain} />;
  const tone = LOCAL_TONES[status.toLowerCase()];
  if (!tone) return <StatusPill status={status} />;
  return (
    <span data-status={status} style={{ backgroundColor: tone.bg, color: tone.fg }} className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 whitespace-nowrap">
      {status}
    </span>
  );
}

/** Receiving difference pill (spec 07): negative red, positive green, blank at zero. */
export function DiffPill({ value }: { readonly value: number | null | undefined }) {
  const fmt = useFormat();
  if (value === null || value === undefined || value === 0) return <span className="text-faint">—</span>;
  const tone = differenceTone(value);
  return (
    <span data-diff={value < 0 ? "negative" : "positive"} style={{ backgroundColor: tone.bg, color: tone.fg }} className="inline-flex rounded-[5px] px-1.5 py-0.5 text-[11px] font-bold tabular-nums">
      {value > 0 ? "+" : ""}{fmt.quantity(value)}
    </span>
  );
}

function Initials({ name }: { readonly name: string }) {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  const ini = ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
  return <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">{ini}</span>;
}

function renderValue(c: ReportColumn, row: ReportRow): React.ReactNode {
  const v = row[c.id];
  switch (c.kind) {
    case "number":
      return <span className="block text-right"><QtyCell value={typeof v === "number" ? v : null} muteZero /></span>;
    case "decimal":
      return typeof v === "number" ? <span className="block text-right tabular-nums">{v.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span> : <Empty />;
    case "money":
      return <MoneyCell value={typeof v === "number" ? v : null} />;
    case "datetime":
      return <DateCell value={typeof v === "string" ? v : null} />;
    case "date":
      return <DateCell value={typeof v === "string" ? v : null} dateOnly />;
    case "pill":
      return typeof v === "string" && v ? <ReportPill status={v} domain={c.pill} /> : <Empty />;
    case "diff":
      return <span className="block text-right"><DiffPill value={typeof v === "number" ? v : null} /></span>;
    case "yesNo":
      return <YesNoPill value={Boolean(v)} />;
    case "user":
      return typeof v === "string" && v ? (
        <span className="inline-flex min-w-0 items-center gap-1.5"><Initials name={v} /><span className="truncate">{v}</span></span>
      ) : <Empty />;
    default:
      if (v === null || v === undefined || v === "") return <Empty />;
      if (c.kind === "strong") {
        return typeof v === "number" ? <span className="block text-right font-semibold tabular-nums">{v.toLocaleString("en-US")}</span> : <span className="font-semibold">{String(v)}</span>;
      }
      return <span className={c.kind === "mono" ? "font-mono text-[12px]" : undefined}>{String(v)}</span>;
  }
}

const RIGHT_KINDS = new Set(["number", "decimal", "money", "diff"]);

export function buildReportColumns(
  columns: readonly ReportColumn[],
  overrides: Readonly<Record<string, (row: ReportRow) => React.ReactNode>> = {},
): ColumnDef<ReportRow, unknown>[] {
  return columns.map((c) => ({
    id: c.id,
    accessorFn: (row) => row[c.id],
    header: c.label,
    size: c.width ?? 140,
    minSize: 60,
    enableSorting: c.sortable !== false,
    meta: {
      label: c.label,
      ...(c.tip ? { headerTip: c.tip } : {}),
      ...(c.alwaysVisible ? { alwaysVisible: true } : {}),
      ...(c.defaultHidden ? { defaultVisible: false } : {}),
      ...(RIGHT_KINDS.has(c.kind ?? "") || (c.kind === "strong" && c.exportType === "integer") ? { align: "right" as const } : {}),
      ...(c.kind === "pill" || c.kind === "diff" || c.kind === "yesNo" ? { clip: false } : {}),
    },
    cell: ({ row }) => {
      const custom = overrides[c.id];
      if (custom) return custom(row.original);
      const content = renderValue(c, row.original);
      const href = c.hrefKey ? row.original[c.hrefKey] : null;
      return typeof href === "string" && href ? <LinkCell href={href}>{content}</LinkCell> : content;
    },
  }));
}
