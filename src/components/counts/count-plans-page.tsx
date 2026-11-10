"use client";

/**
 * Count Plan (`/counts`, Logiwa 04 §6). Shared grid (search mode, typed filters, chips,
 * saved views, column chooser, density, page sizes, async xlsx export) plus:
 *   header   Import ▾ (Location / SKU count plan) · Quick count · Create New Count
 *   bulk     Cancel (unlocks locations) · Update Inv. (variance summary) · Create Job
 *   row ⋯    Show Details · Edit (Pending) · Change Log · Delete (Pending, no jobs)
 * Status chips above the grid filter by status in one click (KitStaks addition).
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Ban, ChevronDown, ClipboardCheck, ClipboardList, Eye, FileSpreadsheet, History, Pencil, Plus, Trash2, Upload, Zap } from "lucide-react";
import { DataGrid, GridToolbar, useGrid, type BulkAction, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { ChangeLogDrawer } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StatusPill } from "@/components/ui/status-pill";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/lib/format";
import { COUNT_PERMISSIONS as P, COUNT_PLANS_GRID_KEY, COUNT_PLAN_FIELDS } from "@/lib/grid-defs/counts/count-grids";
import { firstReason, planCancelReason, planCreateJobReason, planDeleteReason, planEditReason, planUpdateInvReason } from "@/lib/grid-defs/counts/count-math";
import { COUNT_PLAN_STATUSES } from "@/lib/enums";
import { toast } from "@/components/ui/toast";
import { CountPlanDrawer, type DrawerMode } from "./count-plan-drawer";
import { CountStatusChips } from "./count-status-chips";
import { buildPlanColumns, type CountPlanRow } from "./counts-columns";
import { errorMessage, runBulkCommand, useFilterFields, useRefreshCounts, useCountCan } from "./counts-client";
import { CreateCountJobModal } from "./create-count-job-modal";
import { UpdateInventoryDialog } from "./count-dialogs";
import { InstantCountModal } from "./instant-count-modal";

export const COUNT_PLAN_HELPER = "You can create, edit or delete your count plans here.";

type DialogState =
  | { kind: "cancel" | "delete" | "update" | "job"; rows: readonly CountPlanRow[] }
  | null;

function HeaderActions({ canCreate, canImport, canInstant, onCreate, onInstant }: { readonly canCreate: boolean; readonly canImport: boolean; readonly canInstant: boolean; readonly onCreate: () => void; readonly onInstant: () => void }) {
  return (
    <>
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
  };

  const seen = React.useRef(new Map<string, CountPlanRow>());
  React.useEffect(() => { for (const r of g.rows) seen.current.set(r.id, r); }, [g.rows]);
  const rowsFor = React.useCallback((ids: readonly string[]) => ids.map((id) => seen.current.get(id) ?? g.rows.find((r) => r.id === id)).filter((r): r is CountPlanRow => Boolean(r)), [g.rows]);

  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [drawer, setDrawer] = React.useState<{ mode: DrawerMode; planId: string | null } | null>(search.get("new") === "1" ? { mode: "create", planId: null } : null);
  const [instant, setInstant] = React.useState(false);
  const [logFor, setLogFor] = React.useState<CountPlanRow | null>(null);

  const finish = async () => { g.clearSelection(); await refresh(); };

  const bulkActions: BulkAction[] = [
    ...(can.cancel ? [{ key: "cancel", label: "Cancel", icon: Ban, destructive: true, emptyReason: "Select at least one count plan", eligibility: (ids: readonly string[]) => firstReason(rowsFor(ids), (r) => planCancelReason(r.status)), onSelect: (ids: readonly string[]) => setDialog({ kind: "cancel", rows: rowsFor(ids) }) }] : []),
    ...(can.update ? [{ key: "update", label: "Update Inv.", icon: ClipboardCheck, emptyReason: "Select at least one counted plan", eligibility: (ids: readonly string[]) => firstReason(rowsFor(ids), (r) => planUpdateInvReason(r.status, r.countedLineCount)), onSelect: (ids: readonly string[]) => setDialog({ kind: "update", rows: rowsFor(ids) }) }] : []),
    ...(can.job ? [{ key: "job", label: "Create Job", icon: ClipboardList, emptyReason: "Select at least one pending count plan", eligibility: (ids: readonly string[]) => firstReason(rowsFor(ids), (r) => planCreateJobReason(r.status)), onSelect: (ids: readonly string[]) => setDialog({ kind: "job", rows: rowsFor(ids) }) }] : []),
  ];

  const rowActions = (row: CountPlanRow): readonly RowAction[] => [
    { key: "details", label: "Show details", icon: Eye, href: `/counts/${encodeURIComponent(row.code)}` },
    ...(can.edit ? [{ key: "edit", label: "Edit", icon: Pencil, disabledReason: planEditReason(row.status), onSelect: () => setDrawer({ mode: "edit", planId: row.id }) }] : []),
    { key: "log", label: "Change log", icon: History, onSelect: () => setLogFor(row) },
    ...(can.del ? [{ key: "delete", label: "Delete", icon: Trash2, destructive: true, disabledReason: planDeleteReason(row.status) ?? (row.jobCodes ? "This count plan has jobs; cancel it instead" : null), onSelect: () => setDialog({ kind: "delete", rows: [row] }) }] : []),
  ];

  const runCancel = async (rows: readonly CountPlanRow[]) => {
    await runBulkCommand("/api/counts/cancel", { ids: rows.map((r) => r.id) }, rows.length === 1 ? "count plan" : "count plans", "cancelled");
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
    rows: dialog.rows.map((r) => ({ code: r.code, status: <StatusPill status={r.status} domain="count" size="sm" />, type: r.countType, lock: r.lockLocations ? `${r.locationCount} ${r.locationCount === 1 ? "location" : "locations"}` : "No", created: fmt.dateTime(r.createdAt) })),
  } : undefined;
  const locking = dialog?.kind === "cancel" ? dialog.rows.filter((r) => r.lockLocations).length : 0;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader title="Count Details" tabs="counts" helper={COUNT_PLAN_HELPER}
        actions={<HeaderActions canCreate={can.create} canImport={can.imp} canInstant={can.instant} onCreate={() => setDrawer({ mode: "create", planId: null })} onInstant={() => setInstant(true)} />} />
      <CountStatusChips kind="plans" statuses={COUNT_PLAN_STATUSES} grid={g.grid} />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search by count code" bulkNoun="count plan" bulkActions={bulkActions} />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<CountPlanRow>
          {...g.gridProps}
          columns={columns}
          getRowId={(row) => row.id}
          rowActions={rowActions}
          onRowClick={(row) => router.push(`/counts/${encodeURIComponent(row.code)}`)}
          emptyTitle="No count plans match this view"
          emptyDescription="Clear the filters, run a quick count, or create a count plan for the locations or SKUs you want to verify."
          emptyAction={can.create ? <Button variant="primary" onClick={() => setDrawer({ mode: "create", planId: null })}><Plus className="h-3.5 w-3.5" aria-hidden />Create New Count</Button> : undefined}
        />
      </div>

      <ConfirmDialog
        open={dialog?.kind === "cancel"}
        onOpenChange={(o) => !o && setDialog(null)}
        variant="danger"
        icon={Ban}
        title={`Cancel ${dialog?.rows.length ?? 0} count ${dialog?.rows.length === 1 ? "plan" : "plans"}?`}
        description={`Open lines and pending count tasks are cancelled. Counted lines that were not posted are discarded.${locking ? ` ${locking === 1 ? "Its" : "Their"} locked locations unlock right away.` : ""}`}
        records={confirmRecords}
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={() => runCancel(dialog?.rows ?? [])}
      />
      <ConfirmDialog
        open={dialog?.kind === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        variant="danger"
        title={`Delete count plan ${dialog?.rows[0]?.code ?? ""}?`}
        description="The plan and its lines are removed. This action cannot be undone."
        records={confirmRecords}
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={() => { const row = dialog?.rows[0]; return row ? runDelete(row) : undefined; }}
      />
      <UpdateInventoryDialog open={dialog?.kind === "update"} onOpenChange={(o) => !o && setDialog(null)} level="plan" ids={dialog?.kind === "update" ? dialog.rows.map((r) => r.id) : []} onDone={() => void finish()} />
      <CreateCountJobModal open={dialog?.kind === "job"} onOpenChange={(o) => !o && setDialog(null)} plans={dialog?.kind === "job" ? dialog.rows : []} onDone={() => void finish()} />
      <CountPlanDrawer open={drawer !== null} onOpenChange={(o) => !o && setDrawer(null)} mode={drawer?.mode ?? "create"} planId={drawer?.planId ?? null} onSaved={() => void finish()} />
      <InstantCountModal open={instant} onOpenChange={setInstant} onDone={() => void refresh()} />
      {logFor ? <ChangeLogDrawer open onOpenChange={(o) => !o && setLogFor(null)} entityType="count_plan" entityId={logFor.id} entityCode={logFor.code} /> : null}
    </div>
  );
}
