"use client";

/**
 * Location Details (`/counts/locations`, Logiwa 04 §7) and SKU Details (`/counts/skus`,
 * §8): one row per count line. Header: More Details (async detailed export, one row per
 * counted bucket). Bulk: Cancel, Update Inv., Create Recount. SKU Details adds the row
 * Delete (Pending plans). % Difference is a coloured pill.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Ban, ClipboardCheck, Eye, FileSpreadsheet, RotateCcw, Trash2 } from "lucide-react";
import { DataGrid } from "@/components/grid/data-grid";
import { GridToolbar } from "@/components/grid/grid-toolbar";
import { useGrid } from "@/components/grid/use-grid";
import type { RowAction } from "@/components/grid/grid-types";
import { browserTimeZone, exportQueryString, EXPORT_STARTED_MESSAGE } from "@/components/grid/export-button";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Spinner } from "@/components/ui/spinner";
import { CountStatusPill } from "./count-status-pill";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api-client";
import { openTransactionsTray, refreshTransactions } from "@/lib/transactions-events";
import { COUNT_LINE_STATUSES } from "@/lib/enums";
import {
  COUNT_DETAIL_EXPORT_COLUMNS, COUNT_LOCATIONS_GRID_KEY, COUNT_LOCATION_FIELDS, COUNT_PERMISSIONS as P, COUNT_SKUS_GRID_KEY, COUNT_SKU_FIELDS,
} from "@/lib/grid-defs/counts/count-grids";
import { firstReason, lineCancelReason, lineDeleteReason, lineRecountReason, lineUpdateInvReason } from "@/lib/grid-defs/counts/count-math";
import { CountStatusChips } from "./count-status-chips";
import { buildLineColumns, type CountLineRow } from "./counts-columns";
import { errorMessage, runBulkCommand, useFilterFields, useRefreshCounts, useCountCan } from "./counts-client";
import { assertCancelReason, CancelReasonField, RecountDialog, UpdateInventoryDialog } from "./count-dialogs";
import { COUNT_ACTION_INFO, CountBulkBar, type CountBulkAction } from "./count-bulk-bar";

type Kind = "locations" | "skus";

const META = {
  locations: {
    gridKey: COUNT_LOCATIONS_GRID_KEY, path: "/api/counts/locations", fields: COUNT_LOCATION_FIELDS, helper: "Review every location line across count plans, then update inventory, create recounts or cancel lines.",
    search: "Search by location or count code", perms: { view: P.locView, more: P.locMore, cancel: P.locCancel, recount: P.locRecount, update: P.locUpdateInv, del: P.locDelete },
  },
  skus: {
    gridKey: COUNT_SKUS_GRID_KEY, path: "/api/counts/skus", fields: COUNT_SKU_FIELDS, helper: "Review counted and expected quantities per SKU across count plans, then update inventory, recount or cancel.",
    search: "Search by SKU or count code", perms: { view: P.skuView, more: P.skuMore, cancel: P.skuCancel, recount: P.skuRecount, update: P.skuUpdateInv, del: P.skuDelete },
  },
} as const;

type DialogState = { kind: "cancel" | "update" | "recount" | "delete"; rows: readonly CountLineRow[] } | null;

/** Real line ids for a selection (SKU Details rows can be per-SKU slices of one location line). */
const lineIdsOf = (rows: readonly CountLineRow[]): string[] => [...new Set(rows.map((r) => r.lineId ?? r.id))];

const lineLabel = (r: CountLineRow): string => [r.locationCode, r.sku].filter(Boolean).join(" · ") || r.planCode;

interface ExportTask { readonly id: string; readonly status: "queued" | "started" | "completed" | "error"; readonly rowCount: number | null; readonly errorMessage: string | null; readonly fileId: string | null; readonly fileName: string | null }
type ExportState = { readonly phase: "running"; readonly taskId: string } | { readonly phase: "ready"; readonly task: ExportTask } | { readonly phase: "error"; readonly message: string } | null;
const EXPORT_POLL_MS = 2000;
const EXPORT_POLL_MAX = 90;
const downloadHref = (fileId: string) => `/api/files/${encodeURIComponent(fileId)}?download=1`;

/**
 * More Details (Logiwa: async detailed export, result in the Transactions panel). The export runs in
 * the background; this button follows the task to the end and shows the result in place: a status
 * line while it runs, then a Download link with the row count (or the error), plus a toast with
 * Download / Open transactions. The Transactions tray lists the same task.
 */
function MoreDetailsButton({ gridKey, queryString, total, allowed }: { readonly gridKey: string; readonly queryString: string; readonly total: number; readonly allowed: boolean }) {
  const [pending, setPending] = React.useState(false);
  const [state, setState] = React.useState<ExportState>(null);
  const running = state?.phase === "running";
  const reason = !allowed ? "You don't have permission to export count details" : total === 0 ? "There are no records to export" : pending ? "Starting export…" : running ? "The detailed export is still running" : null;

  React.useEffect(() => {
    if (state?.phase !== "running") return;
    let stopped = false;
    let polls = 0;
    const tick = async () => {
      if (stopped) return;
      polls += 1;
      try {
        const res = await apiFetch<ExportTask>(`/api/background-tasks/${encodeURIComponent(state.taskId)}`);
        const task = res;
        if (stopped) return;
        if (task.status === "completed") {
          setState({ phase: "ready", task });
          refreshTransactions();
          toast.show({ variant: "success", title: "Detailed export ready", message: `${task.fileName ?? "Count details"} · ${task.rowCount ?? 0} rows.`, action: task.fileId ? { label: "Download", onClick: () => { window.location.href = downloadHref(task.fileId as string); } } : { label: "Open transactions", onClick: openTransactionsTray } });
          return;
        }
        if (task.status === "error") {
          setState({ phase: "error", message: task.errorMessage ?? "The export failed." });
          refreshTransactions();
          toast.error("Detailed export failed", task.errorMessage ?? "The export failed. Retry it from Excel Export History.");
          return;
        }
      } catch {
        // A transient poll error keeps polling; the tray still shows the task.
      }
      if (polls >= EXPORT_POLL_MAX) { setState({ phase: "error", message: "Still running. Check the Transactions panel for the file." }); return; }
      timer = window.setTimeout(() => void tick(), EXPORT_POLL_MS);
    };
    let timer = window.setTimeout(() => void tick(), EXPORT_POLL_MS);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [state]);

  const run = async () => {
    setPending(true);
    try {
      const params = new URLSearchParams(exportQueryString(queryString));
      params.set("detail", "1");
      const task = await apiFetch<ExportTask>("/api/exports", { method: "POST", body: { gridKey, query: params.toString(), timeZone: browserTimeZone(), columns: COUNT_DETAIL_EXPORT_COLUMNS.map((c) => ({ key: c.key, label: c.label })) } });
      toast.show({ variant: "success", title: "Export started", message: `Detailed count file (one row per SKU, lot and LP). ${EXPORT_STARTED_MESSAGE}`, action: { label: "Open transactions", onClick: openTransactionsTray } });
      refreshTransactions();
      if (task?.id) setState({ phase: "running", taskId: task.id });
    } catch (error) {
      toast.error("Export failed", errorMessage(error, "The export could not be started."));
    } finally {
      setPending(false);
    }
  };
  return (
    <span className="flex items-center gap-2">
      <DisabledReason reason={reason}>
        <Button variant="secondary" disabled={Boolean(reason)} onClick={() => void run()}>
          {pending || running ? <Spinner className="h-3.5 w-3.5" /> : <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />}More Details
        </Button>
      </DisabledReason>
      <span role="status" aria-live="polite" className="text-xs text-secondary" data-testid="more-details-status">
        {state?.phase === "running" ? "Preparing the detailed file…"
          : state?.phase === "ready" ? (state.task.fileId
            ? <a href={downloadHref(state.task.fileId)} className="font-semibold text-primary hover:underline">Download ({state.task.rowCount ?? 0} rows)</a>
            : <button type="button" onClick={openTransactionsTray} className="font-semibold text-primary hover:underline">Open transactions</button>)
            : state?.phase === "error" ? <span className="text-danger">{state.message}</span> : null}
      </span>
    </span>
  );
}

export function CountLinesPage({ kind }: { readonly kind: Kind }) {
  const meta = META[kind];
  const router = useRouter();
  const refresh = useRefreshCounts();
  const fields = useFilterFields(meta.fields);
  const g = useGrid<CountLineRow>({ gridKey: meta.gridKey, path: meta.path, fields });
  const columns = React.useMemo(() => buildLineColumns(kind), [kind]);
  const can = {
    more: useCountCan(meta.perms.more).allowed, cancel: useCountCan(meta.perms.cancel).allowed, recount: useCountCan(meta.perms.recount).allowed,
    update: useCountCan([meta.perms.update, P.updateInv], "any").allowed, del: useCountCan(meta.perms.del).allowed,
    create: useCountCan(P.create).allowed,
  };
  const readOnly = !can.cancel && !can.recount && !can.update && !can.del;
  const helper = readOnly ? (kind === "locations" ? "Review every location line across count plans: status, expected and counted quantities, and differences." : "Review expected and counted quantities per SKU across count plans, with their status and differences.") : meta.helper;

  const seen = React.useRef(new Map<string, CountLineRow>());
  React.useEffect(() => { for (const r of g.rows) seen.current.set(r.id, r); }, [g.rows]);
  const rowsFor = React.useCallback((ids: readonly string[]) => ids.map((id) => seen.current.get(id) ?? g.rows.find((r) => r.id === id)).filter((r): r is CountLineRow => Boolean(r)), [g.rows]);
  const [dialog, setDialog] = React.useState<DialogState>(null);
  const finish = async () => { g.clearSelection(); await refresh(); };

  const noun = kind === "locations" ? "count location" : "count SKU";
  const bulkActions: CountBulkAction[] = [
    ...(can.cancel ? [{ key: "cancel", label: "Cancel", icon: Ban, info: COUNT_ACTION_INFO.cancel, emptyReason: `Select at least one ${noun}`, eligibility: (ids: readonly string[]) => firstReason(rowsFor(ids), (r) => lineCancelReason(r.status)), onSelect: (ids: readonly string[]) => setDialog({ kind: "cancel", rows: rowsFor(ids) }) }] : []),
    ...(can.update ? [{ key: "update", label: "Update Inv.", icon: ClipboardCheck, info: COUNT_ACTION_INFO.updateInv, emptyReason: `Select at least one counted ${noun}`, eligibility: (ids: readonly string[]) => firstReason(rowsFor(ids), (r) => lineUpdateInvReason(r.status)), onSelect: (ids: readonly string[]) => setDialog({ kind: "update", rows: rowsFor(ids) }) }] : []),
    ...(can.recount ? [{ key: "recount", label: "Create Recount", icon: RotateCcw, info: COUNT_ACTION_INFO.recount, emptyReason: `Select at least one counted ${noun}`, eligibility: (ids: readonly string[]) => firstReason(rowsFor(ids), (r) => lineRecountReason(r.status, r.operationType)), onSelect: (ids: readonly string[]) => setDialog({ kind: "recount", rows: rowsFor(ids) }) }] : []),
  ];

  const rowActions = (row: CountLineRow): readonly RowAction[] => [
    { key: "details", label: "Show count plan", icon: Eye, href: `/counts/${encodeURIComponent(row.planCode)}` },
    ...(can.del ? [{ key: "delete", label: "Delete", icon: Trash2, destructive: true, disabledReason: (row.lineId && row.lineId !== row.id ? "This SKU was counted inside a location line; delete the location line on Location Details" : null) ?? lineDeleteReason(row.status) ?? (row.planStatus !== "Pending" ? "Only lines of a pending count plan can be deleted" : null), onSelect: () => setDialog({ kind: "delete", rows: [row] }) }] : []),
  ];

  const [cancelNote, setCancelNote] = React.useState("");
  const discards = dialog?.kind === "cancel" ? new Set(dialog.rows.filter((r) => r.status === "Count Completed").map((r) => r.lineId ?? r.id)).size : 0;
  const runCancel = async (rows: readonly CountLineRow[]) => {
    assertCancelReason(discards, cancelNote);
    await runBulkCommand("/api/counts/lines/cancel", { ids: lineIdsOf(rows), reason: cancelNote.trim() || null }, rows.length === 1 ? "count line" : "count lines", "cancelled");
    setCancelNote("");
    await finish();
  };
  const runDelete = async (row: CountLineRow) => {
    try {
      await apiFetch(`/api/counts/lines/${encodeURIComponent(row.lineId ?? row.id)}`, { method: "DELETE" });
      toast.success("Success", `${(kind === "locations" ? row.locationCode : row.sku) ?? row.sku ?? "The line"} is removed from ${row.planCode}.`);
    } catch (error) {
      toast.error("Error", errorMessage(error));
    }
    await finish();
  };

  const records = dialog && (dialog.kind === "cancel" || dialog.kind === "delete") ? {
    columns: [{ key: "line", label: kind === "skus" ? "SKU · location" : "Location" }, { key: "plan", label: "Count code" }, { key: "status", label: "Status" }, { key: "job", label: "Job" }],
    rows: dialog.rows.map((r) => ({ line: lineLabel(r), plan: r.planCode, status: <CountStatusPill status={r.status} domain="count" size="sm" />, job: r.jobCode ?? "—" })),
  } : undefined;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader title={kind === "locations" ? "Count Location Details" : "Count SKU Details"} tabs="counts" helper={helper} actions={<MoreDetailsButton gridKey={meta.gridKey} queryString={g.gridProps.queryString} total={g.total} allowed={can.more} />} />
      <CountStatusChips kind={kind} statuses={COUNT_LINE_STATUSES} grid={g.grid} gridFetching={g.isFetching} />
      <GridToolbar {...g.toolbarProps} searchPlaceholder={meta.search} trailing={<CountBulkBar actions={bulkActions} selectedIds={g.toolbarProps.selectedIds} noun={noun} />} />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<CountLineRow>
          {...g.gridProps}
          columns={columns}
          getRowId={(row) => row.id}
          selectable={can.cancel || can.update || can.recount}
          rowActions={rowActions}
          onRowClick={(row) => router.push(`/counts/${encodeURIComponent(row.planCode)}`)}
          emptyTitle={kind === "locations" ? "No count locations match this view" : "No count SKUs match this view"}
          emptyDescription={kind === "skus" ? "Every SKU in scope of a count plan appears here with its status and expected quantity, before and after counting. Clear the filters or create a count plan." : "Count lines appear here once a count plan is created. Clear the filters or create a count plan from the Count Plan tab."}
          emptyAction={can.create ? <Button variant="secondary" onClick={() => router.push("/counts?new=1")}>Create New Count</Button> : undefined}
        />
      </div>

      <ConfirmDialog
        open={dialog?.kind === "cancel"}
        onOpenChange={(o) => { if (!o) { setDialog(null); setCancelNote(""); } }}
        variant="danger"
        icon={Ban}
        title={`Cancel ${dialog?.rows.length ?? 0} count ${dialog?.rows.length === 1 ? "line" : "lines"}?`}
        description="Pending count tasks for these lines are cancelled. When every line of a plan is cancelled, the plan is cancelled and its locations unlock."
        records={records}
        confirmLabel={dialog?.rows.length === 1 ? "Cancel line" : "Cancel lines"}
        cancelLabel={dialog?.rows.length === 1 ? "Keep line" : "Keep lines"}
        onConfirm={() => runCancel(dialog?.rows ?? [])}
      >
        <CancelReasonField discards={discards} value={cancelNote} onChange={setCancelNote} />
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog?.kind === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        variant="danger"
        title={`Remove ${(kind === "locations" ? dialog?.rows[0]?.locationCode : dialog?.rows[0]?.sku) ?? (kind === "locations" ? "this location" : "this SKU")} from ${dialog?.rows[0]?.planCode ?? "the plan"}?`}
        description={`The ${kind === "locations" ? "location" : "SKU"} line is deleted from the pending count plan. A plan needs at least one line. This action cannot be undone.`}
        records={records}
        confirmLabel="Remove line"
        cancelLabel="Keep line"
        onConfirm={() => { const row = dialog?.rows[0]; return row ? runDelete(row) : undefined; }}
      />
      <UpdateInventoryDialog open={dialog?.kind === "update"} onOpenChange={(o) => !o && setDialog(null)} level="line" ids={dialog?.kind === "update" ? lineIdsOf(dialog.rows) : []} onDone={() => void finish()} />
      <RecountDialog open={dialog?.kind === "recount"} onOpenChange={(o) => !o && setDialog(null)} onDone={() => void finish()}
        lines={dialog?.kind === "recount" ? dialog.rows.filter((r, i, all) => all.findIndex((x) => (x.lineId ?? x.id) === (r.lineId ?? r.id)) === i).map((r) => ({ id: r.lineId ?? r.id, label: lineLabel(r), planCode: r.planCode, countedQty: r.countedQty, systemQty: r.approvedStockQty ?? r.initialStockQty, warehouseId: r.warehouseId })) : []} />
    </div>
  );
}
