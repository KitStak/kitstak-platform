"use client";

/**
 * End Of The Day (`/shipments/end-of-day`): one row per carrier account, ship date and
 * warehouse. Rows follow the labels live (create +1, void −1). Bulk: Print custom report,
 * Print end of the day report (confirm → close → PDF) and Reprint.
 */
import * as React from "react";
import { FileBarChart, FileText, ListChecks, Printer, RotateCcw } from "lucide-react";
import { EOD_FIELDS, EOD_GRID_KEY, closeBlockReason, reprintBlockReason } from "@/lib/grid-defs/shipping/end-of-day";
import { formatDate } from "@/lib/format";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { DataGrid, GridToolbar, filteredListHref, useGrid, type BulkAction, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import type { EodRow } from "@/server/repositories/end-of-day";
import { buildColumns, exportColumnsOf, type ColumnSpec } from "./column-kit";
import { bulkToast, useHydratedPermissions, errorMessage, openFile, openFileWhenReady, postJson, useFilterFields, useSeenRows, type BulkOutcome } from "./shipping-client";

const PERM = { close: "fulfillment.end_of_day.print_end_of_the_day_report", custom: "fulfillment.end_of_day.print_custom_report" } as const;

interface PrintResult extends BulkOutcome {
  readonly fileId: string | null;
}

export function packagesHref(row: Pick<EodRow, "carrierPrefix" | "warehouseCode" | "shipDate">): string {
  return filteredListHref("/shipments", [
    { field: "labelCreatedAt", op: "date", date: { kind: "custom", from: row.shipDate, to: row.shipDate } },
    { field: "carrierPrefix", op: "in", values: [row.carrierPrefix] },
    { field: "warehouseCode", op: "in", values: [row.warehouseCode] },
  ]);
}

const SPECS: readonly ColumnSpec<EodRow>[] = [
  { id: "carrierPrefix", label: "Prefix", width: 120, always: true, cell: (r) => <span className="font-semibold">{r.carrierPrefix || "—"}</span> },
  { id: "carrierCode", label: "Carrier", width: 120, cell: (r) => <span title={r.carrierName}>{r.carrierCode}</span> },
  { id: "warehouseCode", label: "Ship from", width: 180, cell: (r) => <span className="truncate">{r.warehouseCode} · {r.shipFrom}</span> },
  { id: "shipDate", label: "Ship date", width: 120, cell: (r) => <span className="tabular-nums">{formatDate(`${r.shipDate}T12:00:00`)}</span> },
  { id: "closeDate", label: "Close date", kind: "datetime" },
  { id: "isPrinted", label: "Report printed?", kind: "boolean", width: 128 },
  {
    id: "totalPackages", label: "Total package", kind: "integer", width: 120,
    cell: (r) => (
      <a href={packagesHref(r)} onClick={(e) => e.stopPropagation()} className="block text-right font-semibold tabular-nums text-primary hover:underline" title="Show these packages in Carrier shipment details">
        {r.totalPackages}
      </a>
    ),
  },
  { id: "voidedPackages", label: "Voided", kind: "integer", width: 88, hidden: true },
  { id: "status", label: "Status", width: 96, cell: (r) => <StatusPill status={r.status} domain="eod" /> },
];

const COLUMNS = buildColumns(SPECS);
const EXPORT_COLUMNS = exportColumnsOf(SPECS);

export function EndOfDayPage() {
  const permissions = useHydratedPermissions();
  const fields = useFilterFields(EOD_FIELDS);
  const g = useGrid<EodRow>({ gridKey: EOD_GRID_KEY, path: "/api/end-of-day", fields });
  const selected = useSeenRows(g.rows, g.selectedIds);
  const [closing, setClosing] = React.useState<readonly EodRow[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const canClose = permissions.has(PERM.close);
  const canCustom = permissions.has(PERM.custom);

  const refresh = () => {
    g.refetch();
    g.clearSelection();
  };

  const labels = (rows: readonly EodRow[]) => new Map(rows.map((r) => [r.id, `${r.carrierPrefix} ${r.shipDate}`]));

  const print = async (path: string, rows: readonly EodRow[], verb: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await openFileWhenReady(() => postJson<PrintResult>(path, { ids: rows.map((r) => r.id) }));
      bulkToast(result, verb, ["manifest", "manifests"], labels(rows));
      refresh();
    } catch (error) {
      toast.error("Couldn't print the report", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const rowActions = (row: EodRow): readonly RowAction[] => [
    { key: "packages", label: "Show packages", icon: ListChecks, href: packagesHref(row) },
    { key: "report", label: "Open printed report", icon: FileText, disabledReason: row.reportFileId ? null : "This manifest has no printed report yet", onSelect: () => openFile(row.reportFileId) },
    { key: "close", label: "Print end of the day report", icon: Printer, disabledReason: !canClose ? "You don't have permission to close manifests" : closeBlockReason([row]), onSelect: () => setClosing([row]) },
    { key: "reprint", label: "Reprint", icon: RotateCcw, disabledReason: !canClose ? "You don't have permission to reprint" : reprintBlockReason([row]), onSelect: () => void print("/api/end-of-day/reprint", [row], "reprinted") },
  ];

  const bulkActions: readonly BulkAction[] = [
    {
      key: "custom", label: "Print custom report", icon: FileBarChart, emptyReason: "Select at least one manifest",
      disabledReason: !canCustom ? "You don't have permission to print custom reports" : busy ? "Printing…" : null,
      onSelect: () => void print("/api/end-of-day/print-custom", selected, "included in the custom report"),
    },
    {
      key: "close", label: "Print end of the day report", icon: Printer, emptyReason: "Select at least one manifest",
      disabledReason: !canClose ? "You don't have permission to close manifests" : busy ? "Printing…" : null,
      eligibility: () => closeBlockReason(selected),
      onSelect: () => setClosing(selected),
    },
    {
      key: "reprint", label: "Reprint", icon: RotateCcw, emptyReason: "Select at least one manifest",
      disabledReason: !canClose ? "You don't have permission to reprint" : busy ? "Printing…" : null,
      eligibility: () => reprintBlockReason(selected),
      onSelect: () => void print("/api/end-of-day/reprint", selected, "reprinted"),
    },
  ];

  const hasState = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  const total = (closing ?? []).reduce((s, r) => s + r.totalPackages, 0);

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader title="End of the day" helper="Monitor total packages per carrier account, warehouse and day, then close the manifest for carrier pickup and reconciliation." tabs="shipments" />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Carrier prefix, carrier or warehouse" onRefresh={refresh} bulkActions={bulkActions} selectedIds={g.selectedIds} bulkNoun="manifest" />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<EodRow>
          {...g.gridProps}
          columns={COLUMNS}
          exportColumns={EXPORT_COLUMNS}
          getRowId={(r) => r.id}
          rowActions={rowActions}
          emptyTitle={hasState ? "No manifests match this view" : "No manifests yet"}
          emptyDescription={hasState ? "Try changing the filters or search term." : "A manifest opens automatically for each carrier account and day as soon as the first shipping label is created."}
        />
      </div>
      <ConfirmDialog
        open={closing !== null}
        onOpenChange={(o) => (o ? undefined : setClosing(null))}
        variant="attention"
        icon={Printer}
        title={closing && closing.length > 1 ? `Close ${closing.length} manifests and print the report?` : "Close this manifest and print the report?"}
        description={`The close date is set, the report is marked printed and ${total} ${total === 1 ? "package" : "packages"} are handed to the carrier. Labels created afterwards open a new manifest.`}
        records={closing ? {
          columns: [{ key: "prefix", label: "Prefix" }, { key: "carrier", label: "Carrier" }, { key: "from", label: "Ship from" }, { key: "date", label: "Ship date" }, { key: "total", label: "Total package" }],
          rows: closing.map((r) => ({ prefix: r.carrierPrefix, carrier: r.carrierCode, from: r.warehouseCode, date: formatDate(`${r.shipDate}T12:00:00`), total: r.totalPackages })),
        } : undefined}
        cancelLabel="No"
        confirmLabel="Yes, close and print"
        onConfirm={() => print("/api/end-of-day/close", closing ?? [], "closed")}
      />
      <span className="sr-only" aria-live="polite">{g.isFetching ? "Loading manifests" : `${g.total} manifests`}</span>
    </div>
  );
}
