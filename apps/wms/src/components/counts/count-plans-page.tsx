"use client";

/**
 * Count Plan (`/counts`, Logiwa 04 §6). Shared grid (search mode, typed filters, chips,
 * saved views, column chooser, density, page sizes, async xlsx export) plus:
 *   header   Import ▾ (Location / SKU count plan) · Quick count · Create New Count
 *   bulk     Cancel (unlocks locations) · Update Inv. (variance summary) · Create Job
 *   row ⋯    Show Details · Edit (full when Pending, name + description otherwise) · Change Log · Delete (Pending, no jobs)
 * Status chips above the grid filter by status in one click (KitStaks addition).
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery, type ApiQueryData } from "@/lib/query-client";
import Link from "next/link";
import { Ban, BarChart3, PanelRight, CalendarClock, ChevronDown, ClipboardCheck, ClipboardList, Eye, MoreHorizontal, ScanLine, FileSpreadsheet, History, Pencil, Plus, Trash2, Upload, Zap } from "lucide-react";
import { DataGrid } from "@/components/grid/data-grid";
import { GridToolbar } from "@/components/grid/grid-toolbar";
import { useGrid } from "@/components/grid/use-grid";
import type { RowAction } from "@/components/grid/grid-types";
import { PageHeader } from "@/components/layout/page-header";
import { ChangeLogDrawer } from "@/components/shared/change-log-drawer";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CountStatusPill } from "./count-status-pill";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/lib/format";
import { COUNT_PERMISSIONS as P, COUNT_PLANS_GRID_KEY, COUNT_PLAN_FIELDS } from "@/lib/grid-defs/counts/count-grids";
import { firstReason, planCancelReason, planCreateJobReason, planDeleteReason, planEditReason, planLockedReason, planNameLockedReason, planUpdateInvReason } from "@/lib/grid-defs/counts/count-math";
import { COUNT_PLAN_STATUSES } from "@/lib/enums";
import { toast } from "@/components/ui/toast";
import { CountPlanDrawer, type DrawerMode } from "./count-plan-drawer";
import { CountStatusChips } from "./count-status-chips";
import { buildPlanColumns, type CountPlanRow } from "./counts-columns";
import { errorMessage, runBulkCommand, useFilterFields, useRefreshCounts, useCountCan, COUNT_QUERY_TIMEOUT_MS } from "./counts-client";
import { CreateCountJobModal } from "./create-count-job-modal";
import { assertCancelReason, CancelReasonField, UpdateInventoryDialog } from "./count-dialogs";
import { COUNT_ACTION_INFO, CountBulkBar, type CountBulkAction } from "./count-bulk-bar";
import { InstantCountModal } from "./instant-count-modal";
import { CountAccuracyDrawer } from "./count-accuracy-drawer";

export const COUNT_PLAN_HELPER = "Create, edit or cancel count plans by location or SKU, assign count jobs and post counted results to inventory.";
/** Read-only roles (no create / edit / cancel / update rights) get neutral copy instead of verbs they can't use. */
export const COUNT_PLAN_HELPER_READONLY = "Review count plans by location or SKU, their count jobs and the counted results posted to inventory.";

type DialogState =
  | { kind: "cancel" | "delete" | "update" | "job"; rows: readonly CountPlanRow[] }
  | null;

function HeaderActions({ canCreate, canImport, canInstant, canSchedule, canHandheld, onCreate, onInstant, onAccuracy }: { readonly canCreate: boolean; readonly canImport: boolean; readonly canInstant: boolean; readonly canSchedule: boolean; readonly canHandheld: boolean; readonly onCreate: () => void; readonly onInstant: () => void; readonly onAccuracy: () => void }) {
  /* Under xl the secondary actions fold into a More menu so the title and helper keep their width (critic r5). */
  return (
    <>
      {(
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" className="xl:hidden" aria-label="More count actions"><MoreHorizontal className="h-3.5 w-3.5" aria-hidden />More<ChevronDown className="h-3.5 w-3.5" aria-hidden /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[240px]">
            {canInstant ? <DropdownMenuItem icon={Zap} onSelect={onInstant} description="Count one location or SKU now">Quick count</DropdownMenuItem> : null}
            <DropdownMenuItem icon={BarChart3} onSelect={onAccuracy} description="Inventory record accuracy from posted counts">Accuracy</DropdownMenuItem>
            {canImport ? <DropdownMenuItem href="/imports/count-location" icon={FileSpreadsheet} description="One row per location to count">Import location count plan</DropdownMenuItem> : null}
            {canImport ? <DropdownMenuItem href="/imports/count-sku" icon={FileSpreadsheet} description="One row per SKU to count">Import SKU count plan</DropdownMenuItem> : null}
            {canSchedule ? <DropdownMenuItem href="/jobs/wave-rules" icon={CalendarClock} description="Cycle Count wave rules">Recurring counts</DropdownMenuItem> : null}
            {canHandheld ? <DropdownMenuItem href="/counts/scan" icon={ScanLine} description="Scanner layout for floor counting">Handheld count</DropdownMenuItem> : null}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <div className="hidden items-center gap-2 xl:flex">
      {canHandheld ? <Link href="/counts/scan" className={buttonVariants({ variant: "ghost" })} title="Scanner layout for floor counting"><ScanLine className="h-3.5 w-3.5" aria-hidden />Handheld</Link> : null}
      {canSchedule ? (
        <Link href="/jobs/wave-rules" className={buttonVariants({ variant: "ghost" })} title="Recurring cycle counts run from Cycle Count wave rules"><CalendarClock className="h-3.5 w-3.5" aria-hidden />Recurring counts</Link>
      ) : null}
      <Button variant="secondary" onClick={onAccuracy}><BarChart3 className="h-3.5 w-3.5" aria-hidden />Accuracy</Button>
      {canImport ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary"><Upload className="h-3.5 w-3.5" aria-hidden />Import<ChevronDown className="h-3.5 w-3.5" aria-hidden /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[240px]">
            <DropdownMenuItem href="/imports/count-location" icon={FileSpreadsheet} description="One row per location to count">Import location count plan</DropdownMenuItem>
            <DropdownMenuItem href="/imports/count-sku" icon={FileSpreadsheet} description="One row per SKU to count">Import SKU count plan</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {canInstant ? <Button variant="secondary" onClick={onInstant}><Zap className="h-3.5 w-3.5" aria-hidden />Quick count</Button> : null}
      </div>
      {canCreate ? <Button variant="primary" onClick={onCreate}><Plus className="h-3.5 w-3.5" aria-hidden />Create New Count</Button> : null}
    </>
  );
}

export function CountPlansPage() {
  const router = useRouter();
  const search = useSearchParams();
  const fmt = useFormat();
  const refresh = useRefreshCounts();
  const fields = useFilterFields(COUNT_PLAN_FIELDS);
  const g = useGrid<CountPlanRow>({ gridKey: COUNT_PLANS_GRID_KEY, path: "/api/counts", fields });
  const columns = React.useMemo(() => buildPlanColumns(), []);
  const can = {
    create: useCountCan(P.create).allowed, edit: useCountCan(P.edit).allowed, del: useCountCan(P.delete).allowed, cancel: useCountCan(P.cancel).allowed,
    update: useCountCan(P.updateInv).allowed, job: useCountCan(P.createJob).allowed, imp: useCountCan(P.import).allowed,
    instant: useCountCan([P.create, P.mobileInstant], "any").allowed,
    schedule: useCountCan("automation.wave_rules.view").allowed,
    // Handheld is the floor counting screen: only for users who hold the mobile cycle count page.
    handheld: useCountCan(P.mobileCount).allowed,
  };
  const [accuracy, setAccuracy] = React.useState(false);
  /* Warm the next code + default warehouse so Create New Count opens fully prefilled (critic r5). */
  useApiQuery<{ code: string; defaultWarehouseId?: string | null }>(["count-next-code"], can.create ? "/api/counts/next-code" : null, { timeoutMs: COUNT_QUERY_TIMEOUT_MS });

  const seen = React.useRef(new Map<string, CountPlanRow>());
  React.useEffect(() => { for (const r of g.rows) seen.current.set(r.id, r); }, [g.rows]);
  const rowsFor = React.useCallback((ids: readonly string[]) => ids.map((id) => seen.current.get(id) ?? g.rows.find((r) => r.id === id)).filter((r): r is CountPlanRow => Boolean(r)), [g.rows]);

  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [drawer, setDrawer] = React.useState<{ mode: DrawerMode; planId: string | null } | null>(search.get("new") === "1" ? { mode: "create", planId: null } : null);
  const [instant, setInstant] = React.useState(false);
  const [logFor, setLogFor] = React.useState<CountPlanRow | null>(null);

  const finish = async () => { g.clearSelection(); await refresh(); };
  const qc = useQueryClient();
  /** New plan shows at the top of page 1 at once (Logiwa parity); the refetch then confirms it. */
  const onPlanSaved = (saved: CountPlanRow) => {
    if (drawer?.mode === "create" && g.grid.query.page <= 1) {
      qc.setQueriesData<ApiQueryData<CountPlanRow[]>>({ queryKey: ["grid", COUNT_PLANS_GRID_KEY] }, (old) => (old && Array.isArray(old.data) ? { ...old, data: [saved, ...old.data.filter((r) => r.id !== saved.id)] } : old));
    }
    void finish();
  };
  /** Row click opens the plan in place: Edit Count for editors (full edit when Pending, name + description otherwise), read-only for the rest. */
  const quickView = (row: CountPlanRow) => setDrawer({ mode: can.edit && !planLockedReason(row.status) ? "edit" : "view", planId: row.id });

  const bulkActions: CountBulkAction[] = [
    ...(can.cancel ? [{ key: "cancel", label: "Cancel", icon: Ban, info: COUNT_ACTION_INFO.cancel, emptyReason: "Select at least one count plan", eligibility: (ids: readonly string[]) => firstReason(rowsFor(ids), (r) => planCancelReason(r.status)), onSelect: (ids: readonly string[]) => setDialog({ kind: "cancel", rows: rowsFor(ids) }) }] : []),
    ...(can.update ? [{ key: "update", label: "Update Inv.", icon: ClipboardCheck, info: COUNT_ACTION_INFO.updateInv, emptyReason: "Select at least one counted plan", eligibility: (ids: readonly string[]) => firstReason(rowsFor(ids), (r) => planUpdateInvReason(r.status, r.countedLineCount)), onSelect: (ids: readonly string[]) => setDialog({ kind: "update", rows: rowsFor(ids) }) }] : []),
    ...(can.job ? [{ key: "job", label: "Create Job", icon: ClipboardList, info: COUNT_ACTION_INFO.createJob, emptyReason: "Select at least one pending count plan", eligibility: (ids: readonly string[]) => firstReason(rowsFor(ids), (r) => planCreateJobReason(r.status, r.orphanedLineCount ?? 0)), onSelect: (ids: readonly string[]) => setDialog({ kind: "job", rows: rowsFor(ids) }) }] : []),
  ];

  const rowActions = (row: CountPlanRow): readonly RowAction[] => [
    { key: "quick", label: "Quick view", icon: PanelRight, onSelect: () => quickView(row) },
    { key: "details", label: "Open count details", icon: Eye, href: `/counts/${encodeURIComponent(row.code)}` },
    { key: "view", label: "Show Details (read-only)", icon: Eye, onSelect: () => setDrawer({ mode: "view", planId: row.id }) },
    ...(can.edit ? [{ key: "edit", label: planNameLockedReason(row.status) ? "Edit description" : planEditReason(row.status) ? "Edit name & description" : "Edit", icon: Pencil, disabledReason: null, onSelect: () => setDrawer({ mode: "edit", planId: row.id }) }] : []),
    { key: "log", label: "Change log", icon: History, onSelect: () => setLogFor(row) },
    ...(can.del ? [{ key: "delete", label: "Delete", icon: Trash2, destructive: true, disabledReason: planDeleteReason(row.status) ?? (row.jobCodes ? "This count plan has jobs; cancel it instead" : null), onSelect: () => setDialog({ kind: "delete", rows: [row] }) }] : []),
  ];

  const [cancelNote, setCancelNote] = React.useState("");
  const discards = dialog?.kind === "cancel" ? dialog.rows.reduce((s, r) => s + (r.countedLineCount ?? 0), 0) : 0;
  const runCancel = async (rows: readonly CountPlanRow[]) => {
    assertCancelReason(discards, cancelNote);
    await runBulkCommand("/api/counts/cancel", { ids: rows.map((r) => r.id), reason: cancelNote.trim() || null }, rows.length === 1 ? "count plan" : "count plans", "cancelled");
    setCancelNote("");
    await finish();
  };

  const runDelete = async (row: CountPlanRow) => {
    try {
      await apiFetch(`/api/counts/${encodeURIComponent(row.id)}`, { method: "DELETE", query: { version: row.version } });
      toast.success("Success", `Count plan ${row.code} is deleted.`);
    } catch (error) {
      toast.error("Error", errorMessage(error));
    }
    await finish();
  };

  const confirmRecords = dialog && (dialog.kind === "cancel" || dialog.kind === "delete") ? {
    columns: [{ key: "code", label: "Count code" }, { key: "status", label: "Status" }, { key: "type", label: "Count type" }, { key: "lock", label: "Locked locations" }, { key: "created", label: "Created" }],
    rows: dialog.rows.map((r) => ({ code: r.code, status: <CountStatusPill status={r.status} domain="count" size="sm" />, type: r.countType, lock: r.lockLocations ? `${r.locationCount} ${r.locationCount === 1 ? "location" : "locations"}` : "No", created: fmt.gridDateTime(r.createdAt) })),
  } : undefined;
  const locking = dialog?.kind === "cancel" ? dialog.rows.filter((r) => r.lockLocations).length : 0;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader title="Count Plan" tabs="counts" helper={can.create || can.edit || can.cancel || can.update || can.job ? COUNT_PLAN_HELPER : COUNT_PLAN_HELPER_READONLY}
        actions={<HeaderActions canCreate={can.create} canImport={can.imp} canInstant={can.instant} canSchedule={can.schedule} canHandheld={can.handheld} onCreate={() => setDrawer({ mode: "create", planId: null })} onInstant={() => setInstant(true)} onAccuracy={() => setAccuracy(true)} />} />
      <CountStatusChips kind="plans" statuses={COUNT_PLAN_STATUSES} grid={g.grid} gridFetching={g.isFetching} />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search by count code" trailing={<CountBulkBar actions={bulkActions} selectedIds={g.toolbarProps.selectedIds} noun="count plan" />} />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<CountPlanRow>
          {...g.gridProps}
          columns={columns}
          getRowId={(row) => row.id}
          selectable={can.cancel || can.update || can.job}
          rowActions={rowActions}
          onRowClick={(row) => { router.prefetch(`/counts/${encodeURIComponent(row.code)}`); quickView(row); }}
          emptyTitle="No count plans match this view"
          emptyDescription="Clear the filters, run a quick count, or create a count plan for the locations or SKUs you want to verify."
          emptyAction={can.create ? <Button variant="primary" onClick={() => setDrawer({ mode: "create", planId: null })}><Plus className="h-3.5 w-3.5" aria-hidden />Create New Count</Button> : undefined}
        />
      </div>

      <ConfirmDialog
        open={dialog?.kind === "cancel"}
        onOpenChange={(o) => { if (!o) { setDialog(null); setCancelNote(""); } }}
        variant="danger"
        icon={Ban}
        title={`Cancel ${dialog?.rows.length ?? 0} count ${dialog?.rows.length === 1 ? "plan" : "plans"}?`}
        description={`Open lines and pending count tasks are cancelled. Counted lines that were not posted are discarded.${locking ? ` ${locking === 1 ? "Its" : "Their"} locked locations unlock right away.` : ""} This action cannot be undone.`}
        records={confirmRecords}
        confirmLabel={dialog?.rows.length === 1 ? "Cancel count plan" : "Cancel count plans"}
        cancelLabel={dialog?.rows.length === 1 ? "Keep plan" : "Keep plans"}
        onConfirm={() => runCancel(dialog?.rows ?? [])}
      >
        <CancelReasonField discards={discards} value={cancelNote} onChange={setCancelNote} />
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog?.kind === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        variant="danger"
        title={`Delete count plan ${dialog?.rows[0]?.code ?? ""}?`}
        description="The plan and its lines are removed. This action cannot be undone."
        records={confirmRecords}
        confirmLabel="Delete plan"
        cancelLabel="Keep plan"
        onConfirm={() => { const row = dialog?.rows[0]; return row ? runDelete(row) : undefined; }}
      />
      <UpdateInventoryDialog open={dialog?.kind === "update"} onOpenChange={(o) => !o && setDialog(null)} level="plan" ids={dialog?.kind === "update" ? dialog.rows.map((r) => r.id) : []} onDone={() => void finish()} />
      <CreateCountJobModal open={dialog?.kind === "job"} onOpenChange={(o) => !o && setDialog(null)} plans={dialog?.kind === "job" ? dialog.rows : []} onDone={() => void finish()} />
      <CountPlanDrawer open={drawer !== null} onOpenChange={(o) => !o && setDrawer(null)} mode={drawer?.mode ?? "create"} planId={drawer?.planId ?? null} onSaved={onPlanSaved} />
      <CountAccuracyDrawer open={accuracy} onOpenChange={setAccuracy} />
      <InstantCountModal open={instant} onOpenChange={setInstant} onDone={() => void refresh()} />
      {logFor ? <ChangeLogDrawer open onOpenChange={(o) => !o && setLogFor(null)} entityType="count_plan" entityId={logFor.id} entityCode={logFor.code} /> : null}
    </div>
  );
}
