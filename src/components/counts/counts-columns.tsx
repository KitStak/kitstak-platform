"use client";

/**
 * Count grid columns (M07): Count Plan, Location Details, SKU Details (Logiwa 04 §6–§8
 * column sets, in Logiwa order). Codes are links; job codes open the job; % Difference is
 * a coloured pill.
 */
import type { ColumnDef } from "@tanstack/react-table";
import { Lock } from "lucide-react";
import { DATE_TIME_COLUMN_WIDTH, DateCell, LinkCell, QtyCell, YesNoPill } from "@/components/grid/cells";
import { StatusPill } from "@/components/ui/status-pill";
import { Tooltip } from "@/components/ui/tooltip";
import type { CountLineListRow, CountPlanListRow } from "@/lib/grid-defs/counts/count-rows";
import { lineHoldsLock, LOCKING_PLAN_STATUSES } from "@/lib/grid-defs/counts/count-math";
import { DifferenceBadge } from "./count-badges";

export type CountPlanRow = CountPlanListRow;
export type CountLineRow = CountLineListRow;

const dash = <span className="text-faint">—</span>;
const text = (v: unknown) => (v === null || v === undefined || v === "" ? dash : <span className="truncate">{String(v)}</span>);

type Kind = "text" | "int" | "datetime" | "bool";

interface ColSpec<T> {
  readonly id: string;
  readonly label: string;
  readonly kind?: Kind;
  readonly width?: number;
  readonly hidden?: boolean;
  readonly sortable?: boolean;
  readonly always?: boolean;
  readonly cell?: ColumnDef<T, unknown>["cell"];
  readonly tip?: string;
  readonly clip?: boolean;
}

function build<T>(specs: readonly ColSpec<T>[]): ColumnDef<T, unknown>[] {
  return specs.map((s) => {
    const kind = s.kind ?? "text";
    const width = s.width ?? (kind === "datetime" ? DATE_TIME_COLUMN_WIDTH : kind === "bool" ? 104 : kind === "int" ? 112 : 140);
    const cell: ColumnDef<T, unknown>["cell"] = s.cell ?? (({ getValue }) => {
      const v = getValue();
      if (kind === "int") return <QtyCell value={v as number | null} />;
      if (kind === "datetime") return <DateCell value={v as string | null} />;
      if (kind === "bool") return <YesNoPill value={Boolean(v)} />;
      return text(v);
    });
    return {
      id: s.id, accessorKey: s.id, header: s.label, size: width, minSize: Math.min(width, 64), enableSorting: s.sortable !== false, enableHiding: !s.always,
      meta: { label: s.label, defaultVisible: !s.hidden, alwaysVisible: s.always, align: kind === "int" ? "right" : undefined, headerTip: s.tip, clip: s.clip ?? !["status", "difference"].includes(s.id) },
      cell,
    } as ColumnDef<T, unknown>;
  });
}

function jobLinks(codes: string | null) {
  if (!codes) return dash;
  return <span className="truncate">{codes}</span>;
}

/* ------------------------------------------------------------------ plans */
export function buildPlanColumns(): ColumnDef<CountPlanRow, unknown>[] {
  return build<CountPlanRow>([
    {
      id: "code", label: "Count Code", width: 190, always: true,
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <LinkCell href={`/counts/${encodeURIComponent(row.original.code)}`}>{row.original.code}</LinkCell>
          {row.original.lockLocations && LOCKING_PLAN_STATUSES.includes(row.original.status) ? (
            <Tooltip content="Lock Locations is on: moves in and out of these locations are blocked until the count is done">
              <Lock className="h-3 w-3 shrink-0 text-warning" aria-label="Locations locked" />
            </Tooltip>
          ) : null}
        </span>
      ),
    },
    { id: "warehouseCode", label: "Warehouse", width: 104 },
    { id: "jobCodes", label: "Job Code", width: 170, cell: ({ row }) => jobLinks(row.original.jobCodes) },
    { id: "startedAt", label: "Count Started Time", kind: "datetime" },
    { id: "completedAt", label: "Count Completed Time", kind: "datetime" },
    { id: "skuCount", label: "Number of SKU", kind: "int" },
    { id: "countedSkuCount", label: "Counted SKU", kind: "int" },
    { id: "locationCount", label: "Number of Location", kind: "int", width: 132 },
    { id: "countedLocationCount", label: "Counted Locations", kind: "int", width: 132 },
    { id: "createdAt", label: "Created Time", kind: "datetime" },
    { id: "status", label: "Status", width: 140, cell: ({ row }) => <StatusPill status={row.original.status} domain="count" /> },
    { id: "countType", label: "Count Type", width: 104 },
    { id: "isAi", label: "AI Count Plan", kind: "bool", width: 112 },
    { id: "operationType", label: "Count Operation Type", width: 156 },
    { id: "createdByName", label: "Created By", width: 150 },
    {
      id: "countObject", label: "Count Object", width: 200, sortable: false,
      cell: ({ row }) => {
        const extra = row.original.countObjectTotal - (row.original.countObject?.split(", ").length ?? 0);
        return row.original.countObject ? <span className="truncate">{row.original.countObject}{extra > 0 ? <span className="text-faint"> +{extra}</span> : null}</span> : dash;
      },
    },
    { id: "scheduledAt", label: "Scheduled Count Date", kind: "datetime", hidden: true },
    { id: "inventoryUpdatedAt", label: "Inventory Updated Date Time", kind: "datetime", width: 196 },
    { id: "inventoryUpdatedByName", label: "Inventory Update User", width: 160 },
  ]);
}

/* ------------------------------------------------------------------ lines */
const lineCommon = (kind: "locations" | "skus" | "plan"): ColSpec<CountLineRow>[] => [
  {
    id: "locationCode", label: "Location", width: 140, always: kind === "locations",
    cell: ({ row }) => (row.original.locationCode
      ? <span className="flex items-center gap-1 font-semibold text-foreground">{row.original.locationCode}{lineHoldsLock(row.original.lockLocations, row.original.planStatus, row.original.status) ? <Lock className="h-3 w-3 text-warning" aria-label="Locked by this count" /> : null}</span>
      : <Tooltip content="Resolved when a job is created"><span className="text-faint">Not resolved</span></Tooltip>),
  },
  { id: "warehouseCode", label: "Warehouse", width: 104, hidden: kind === "plan" },
  { id: "jobCode", label: "Job Code", width: 120, cell: ({ row }) => (row.original.jobId && row.original.jobCode ? <LinkCell href={`/jobs/${encodeURIComponent(row.original.jobId)}`}>{row.original.jobCode}</LinkCell> : dash) },
  { id: "planCode", label: "Count Code", width: 170, hidden: kind === "plan", cell: ({ row }) => <LinkCell href={`/counts/${encodeURIComponent(row.original.planCode)}`}>{row.original.planCode}</LinkCell> },
  { id: "operationType", label: "Count Operation Type", width: 156, hidden: kind === "plan" },
  { id: "createdByName", label: "Created By", width: 150, hidden: kind === "plan" },
  { id: "startedAt", label: "Count Started Time", kind: "datetime" },
  { id: "completedAt", label: "Count Completed Time", kind: "datetime" },
  { id: "status", label: "Status", width: 140, cell: ({ row }) => <StatusPill status={row.original.status} domain="count" /> },
];

const qtyCols: ColSpec<CountLineRow>[] = [
  { id: "initialStockQty", label: "Initial Stock Qty", kind: "int", width: 124, tip: "On hand when the job was created" },
  { id: "approvedStockQty", label: "Approved Stock Qty", kind: "int", width: 136, tip: "System quantity at the moment of the count" },
  { id: "approvedCountQty", label: "Approved Count Qty", kind: "int", width: 136, tip: "Counted quantity accepted for the inventory update" },
  { id: "countedQty", label: "Counted Qty", kind: "int", width: 108 },
];

const tailCols = (kind: "locations" | "skus" | "plan"): ColSpec<CountLineRow>[] => [
  { id: "isRecountLine", label: "Recount Line", kind: "bool" },
  { id: "recounted", label: kind === "skus" ? "Recounted SKU" : "Recounted Location", kind: "bool", width: 140 },
  { id: "difference", label: "% Difference", width: 120, cell: ({ row }) => <DifferenceBadge value={row.original.difference} /> },
  { id: "countUserName", label: "Count User", width: 150 },
  { id: "note", label: "Note", width: 180, sortable: false },
  { id: "inventoryUpdatedAt", label: "Inventory Updated Date Time", kind: "datetime", width: 196 },
  { id: "inventoryUpdatedByName", label: "Inventory Update User", width: 160 },
];

export function buildLineColumns(kind: "locations" | "skus" | "plan"): ColumnDef<CountLineRow, unknown>[] {
  if (kind === "skus") {
    const common = lineCommon(kind);
    const loc = common[0] as ColSpec<CountLineRow>;
    return build<CountLineRow>([
      { id: "sku", label: "SKU Code", width: 170, always: true, cell: ({ row }) => <span className="truncate font-semibold text-foreground" title={row.original.productName ?? undefined}>{row.original.sku}</span> },
      { id: "planCode", label: "Count Plan Code", width: 170, cell: ({ row }) => <LinkCell href={`/counts/${encodeURIComponent(row.original.planCode)}`}>{row.original.planCode}</LinkCell> },
      { id: "operationType", label: "Count Operation Type", width: 156 },
      { id: "createdByName", label: "Created By", width: 150 },
      { id: "warehouseCode", label: "Warehouse", width: 104 },
      common[2] as ColSpec<CountLineRow>,
      loc,
      ...common.slice(6),
      { id: "initialStockQty", label: "Initial Stock Qty", kind: "int", width: 124 },
      qtyCols[1] as ColSpec<CountLineRow>, qtyCols[2] as ColSpec<CountLineRow>, qtyCols[3] as ColSpec<CountLineRow>,
      ...tailCols(kind),
    ]);
  }
  const product: ColSpec<CountLineRow>[] = kind === "plan" ? [{ id: "sku", label: "SKU", width: 150, cell: ({ row }) => text(row.original.sku) }] : [];
  return build<CountLineRow>([
    ...lineCommon(kind).slice(0, 1), ...product, ...lineCommon(kind).slice(1),
    { id: "skuCount", label: "Num. of SKU", kind: "int", width: 104 },
    ...qtyCols, ...tailCols(kind),
  ]);
}
