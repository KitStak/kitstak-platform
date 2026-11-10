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
import { DataGrid, GridToolbar, useGrid, type BulkAction, type RowAction } from "@/components/grid";
import { browserTimeZone, exportQueryString, EXPORT_STARTED_MESSAGE } from "@/components/grid/export-button";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Spinner } from "@/components/ui/spinner";
import { StatusPill } from "@/components/ui/status-pill";
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
import { RecountDialog, UpdateInventoryDialog } from "./count-dialogs";

type Kind = "locations" | "skus";

const META = {
  locations: {
    gridKey: COUNT_LOCATIONS_GRID_KEY, path: "/api/counts/locations", fields: COUNT_LOCATION_FIELDS, helper: "You can create, edit or delete your count locations here.",
    search: "Search by location or count code", perms: { view: P.locView, more: P.locMore, cancel: P.locCancel, recount: P.locRecount, update: P.locUpdateInv, del: P.locDelete },
  },
  skus: {
    gridKey: COUNT_SKUS_GRID_KEY, path: "/api/counts/skus", fields: COUNT_SKU_FIELDS, helper: "You can create, edit or delete your SKU details here.",
    search: "Search by SKU or count code", perms: { view: P.skuView, more: P.skuMore, cancel: P.skuCancel, recount: P.skuRecount, update: P.skuUpdateInv, del: P.skuDelete },
  },
} as const;

type DialogState = { kind: "cancel" | "update" | "recount" | "delete"; rows: readonly CountLineRow[] } | null;

const lineLabel = (r: CountLineRow): string => [r.locationCode, r.sku].filter(Boolean).join(" · ") || r.planCode;

function MoreDetailsButton({ gridKey, queryString, total, allowed }: { readonly gridKey: string; readonly queryString: string; readonly total: number; readonly allowed: boolean }) {
  const [pending, setPending] = React.useState(false);
  const reason = !allowed ? "You don't have permission to export count details" : total === 0 ? "There are no records to export" : pending ? "Starting export…" : null;
  const run = async () => {
    setPending(true);
    try {
      const params = new URLSearchParams(exportQueryString(queryString));
      params.set("detail", "1");
      await apiFetch("/api/exports", { method: "POST", body: { gridKey, query: params.toString(), timeZone: browserTimeZone(), columns: COUNT_DETAIL_EXPORT_COLUMNS.map((c) => ({ key: c.key, label: c.label })) } });
      toast.show({ variant: "success", title: "Export started", message: `Detailed count file (one row per SKU, lot and LP). ${EXPORT_STARTED_MESSAGE}`, action: { label: "Open transactions", onClick: openTransactionsTray } });
      refreshTransactions();
    } catch (error) {
      toast.error("Export failed", errorMessage(error, "The export could not be started."));
    } finally {
      setPending(false);
    }
  };
  return (
    <DisabledReason reason={reason}>
      <Button variant="secondary" disabled={Boolean(reason)} onClick={() => void run()}>
        {pending ? <Spinner className="h-3.5 w-3.5" /> : <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />}More Details
      </Button>
    </DisabledReason>
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
  };

  const seen = React.useRef(new Map<string, CountLineRow>());
  React.useEffect(() => { for (const r of g.rows) seen.current.set(r.id, r); }, [g.rows]);
  const rowsFor = React.useCallback((ids: readonly string[]) => ids.map((id) => seen.current.get(id) ?? g.rows.find((r) => r.id === id)).filter((r): r is CountLineRow => Boolean(r)), [g.rows]);
  const [dialog, setDialog] = React.useState<DialogState>(null);
  const finish = async () => { g.clearSelection(); await refresh(); };

  const noun = kind === "locations" ? "count location" : "count SKU";
  const bulkActions: BulkAction[] = [
    ...(can.cancel ? [{ key: "cancel", label: "Cancel", icon: Ban, destructive: true, emptyReason: `Select at least one ${noun}`, eligibility: (ids: readonly string[]) => firstReason(rowsFor(ids), (r) => lineCancelReason(r.status)), onSelect: (ids: readonly string[]) => setDialog({ kind: "cancel", rows: rowsFor(ids) }) }] : []),
    ...(can.update ? [{ key: "update", label: "Update Inv.", icon: ClipboardCheck, emptyReason: `Select at least one counted ${noun}`, eligibility: (ids: readonly string[]) => firstReason(rowsFor(ids), (r) => lineUpdateInvReason(r.status)), onSelect: (ids: readonly string[]) => setDialog({ kind: "update", rows: rowsFor(ids) }) }] : []),
    ...(can.recount ? [{ key: "recount", label: "Create Recount", icon: RotateCcw, emptyReason: `Select at least one counted ${noun}`, eligibility: (ids: readonly string[]) => firstReason(rowsFor(ids), (r) => lineRecountReason(r.status)), onSelect: (ids: readonly string[]) => setDialog({ kind: "recount", rows: rowsFor(ids) }) }] : []),
  ];

  const rowActions = (row: CountLineRow): readonly RowAction[] => [
    { key: "details", label: "Show count plan", icon: Eye, href: `/counts/${encodeURIComponent(row.planCode)}` },
    ...(kind === "skus" && can.del ? [{ key: "delete", label: "Delete", icon: Trash2, destructive: true, disabledReason: lineDeleteReason(row.status) ?? (row.planStatus !== "Pending" ? "Only lines of a pending count plan can be deleted" : null), onSelect: () => setDialog({ kind: "delete", rows: [row] }) }] : []),
  ];

  const runCancel = async (rows: readonly CountLineRow[]) => {
    await runBulkCommand("/api/counts/lines/cancel", { ids: rows.map((r) => r.id) }, rows.length === 1 ? "count line" : "count lines", "cancelled");
    await finish();
  };
  const runDelete = async (row: CountLineRow) => {
    try {
      await apiFetch(`/api/counts/lines/${encodeURIComponent(row.id)}`, { method: "DELETE" });
      toast.success("Success", `${row.sku ?? "The line"} is removed from ${row.planCode}.`);
    } catch (error) {
      toast.error("Error", errorMessage(error));
    }
    await finish();
  };

  const records = dialog && (dialog.kind === "cancel" || dialog.kind === "delete") ? {
    columns: [{ key: "line", label: kind === "skus" ? "SKU · location" : "Location" }, { key: "plan", label: "Count code" }, { key: "status", label: "Status" }, { key: "job", label: "Job" }],
    rows: dialog.rows.map((r) => ({ line: lineLabel(r), plan: r.planCode, status: <StatusPill status={r.status} domain="count" size="sm" />, job: r.jobCode ?? "—" })),
  } : undefined;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader title="Count Details" tabs="counts" helper={meta.helper} actions={<MoreDetailsButton gridKey={meta.gridKey} queryString={g.gridProps.queryString} total={g.total} allowed={can.more} />} />
      <CountStatusChips kind={kind} statuses={COUNT_LINE_STATUSES} grid={g.grid} />
      <GridToolbar {...g.toolbarProps} searchPlaceholder={meta.search} bulkNoun={noun} bulkActions={bulkActions} />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<CountLineRow>
          {...g.gridProps}
          columns={columns}
          getRowId={(row) => row.id}
          rowActions={rowActions}
          onRowClick={(row) => router.push(`/counts/${encodeURIComponent(row.planCode)}`)}
          emptyTitle={kind === "locations" ? "No count locations match this view" : "No count SKUs match this view"}
          emptyDescription="Count lines appear here once a count plan is created. Clear the filters or create a count plan from the Count Plan tab."
          emptyAction={<Button variant="secondary" onClick={() => router.push("/counts?new=1")}>Create New Count</Button>}
        />
      </div>

      <ConfirmDialog
        open={dialog?.kind === "cancel"}
        onOpenChange={(o) => !o && setDialog(null)}
        variant="danger"
        icon={Ban}
        title={`Cancel ${dialog?.rows.length ?? 0} count ${dialog?.rows.length === 1 ? "line" : "lines"}?`}
        description="Pending count tasks for these lines are cancelled. When every line of a plan is cancelled, the plan is cancelled and its locations unlock."
        records={records}
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={() => runCancel(dialog?.rows ?? [])}
      />
      <ConfirmDialog
        open={dialog?.kind === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        variant="danger"
        title={`Remove ${dialog?.rows[0]?.sku ?? "this SKU"} from ${dialog?.rows[0]?.planCode ?? "the plan"}?`}
        description="The SKU line is deleted from the pending count plan. This action cannot be undone."
        records={records}
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={() => { const row = dialog?.rows[0]; return row ? runDelete(row) : undefined; }}
      />
      <UpdateInventoryDialog open={dialog?.kind === "update"} onOpenChange={(o) => !o && setDialog(null)} level="line" ids={dialog?.kind === "update" ? dialog.rows.map((r) => r.id) : []} onDone={() => void finish()} />
      <RecountDialog open={dialog?.kind === "recount"} onOpenChange={(o) => !o && setDialog(null)} onDone={() => void finish()}
        lines={dialog?.kind === "recount" ? dialog.rows.map((r) => ({ id: r.id, label: lineLabel(r), planCode: r.planCode, countedQty: r.countedQty, systemQty: r.approvedStockQty ?? r.initialStockQty, warehouseId: r.warehouseId })) : []} />
    </div>
  );
}
