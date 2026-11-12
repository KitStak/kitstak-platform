"use client";

/**
 * Shipment Plan (`/shipment-plans`): truck / load planning grid. Status pill + status
 * popover (legal transitions only); row ⋯ Show details / Edit / Change log / Delete;
 * bulk Delete, Ship, Print ▾ Manifest/BOL and Picking/Job operations; create/edit drawer.
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Edit3, Eye, FileText, History, ListPlus, Plus, Printer, Trash2, Truck } from "lucide-react";
import { SHIPMENT_PLANS_GRID_KEY, SHIPMENT_PLAN_FIELDS } from "@/lib/grid-defs/shipping/shipment-plans";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { DisabledReason } from "@/components/ui/tooltip";
import { DataGrid, GridToolbar, useGrid, type BulkAction, type RowAction } from "@/components/grid";
import { PlanChangeLogDrawer } from "./plan-change-log-drawer";
import { PageHeader } from "@/components/layout/page-header";
import { useFilterFields, useSeenRows } from "@/components/shipping/shipping-client";
import { PLAN_EXPORT_COLUMNS, planColumns, planHref } from "./plans-columns";
import { PlanDrawer } from "./plan-drawer";
import { usePlanActions } from "./plan-actions";
import type { PlanRow } from "./plans-client";

function PrintMenu({ reason, onManifest }: { readonly reason: string | null; readonly onManifest: () => void }) {
  return (
    <DropdownMenu>
      <DisabledReason reason={reason}>
        <DropdownMenuTrigger asChild disabled={Boolean(reason)}>
          <Button variant="secondary" disabled={Boolean(reason)}>
            <Printer className="h-3.5 w-3.5" aria-hidden />
            Print
            <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
      </DisabledReason>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        <DropdownMenuItem icon={FileText} description="Bill of lading with every order and package" onSelect={onManifest}>Print Manifest / BOL</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PlansPage() {
  const router = useRouter();
  const params = useSearchParams();
  const fields = useFilterFields(SHIPMENT_PLAN_FIELDS);
  const g = useGrid<PlanRow>({ gridKey: SHIPMENT_PLANS_GRID_KEY, path: "/api/shipment-plans", fields });
  const selected = useSeenRows(g.rows, g.selectedIds);
  const [drawer, setDrawer] = React.useState<{ readonly editId: string | null } | null>(params.get("create") === "1" ? { editId: null } : null);
  const [changeLog, setChangeLog] = React.useState<PlanRow | null>(null);

  const refresh = React.useCallback(() => {
    g.refetch();
    g.clearSelection();
  }, [g]);
  const a = usePlanActions({ onChanged: refresh });
  const columns = planColumns({ statusDisabledReason: a.statusReason, onStatus: a.requestStatus, canChangeStatus: a.can.status, canEdit: a.can.edit, onInlineSaved: a.changed, extrasFor: a.departExtra });

  const rowActions = (row: PlanRow): readonly RowAction[] => [
    { key: "details", label: "Show details", icon: Eye, href: planHref(row) },
    { key: "edit", label: "Edit", icon: Edit3, disabledReason: !a.can.edit ? "You don't have permission to edit shipment plans" : row.editBlockedReason, onSelect: () => setDrawer({ editId: row.id }) },
    { key: "log", label: "Change log", icon: History, onSelect: () => setChangeLog(row) },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, disabledReason: a.deleteReason([row]), onSelect: () => a.requestDelete([row]) },
  ];

  // Hidden without the permission; red only once a plan is selected (neutral idle toolbar).
  const bulkActions: readonly BulkAction[] = [
    ...(a.can.delete ? [{ key: "delete", label: "Delete", icon: Trash2, destructive: selected.length > 0 && !a.deleteReason(selected), emptyReason: "Select at least one shipment plan", eligibility: () => a.deleteReason(selected), onSelect: () => a.requestDelete(selected) } satisfies BulkAction] : []),
    ...(a.can.ship ? [{ key: "ship", label: "Ship", icon: Truck, emptyReason: "Select at least one shipment plan", eligibility: () => a.shipReason(selected), onSelect: () => a.requestShip(selected) } satisfies BulkAction] : []),
  ];
  const printReason = selected.length === 0 ? "Select at least one shipment plan" : a.printReason(selected);
  const jobsReason = selected.length === 0 ? "Select at least one shipment plan" : a.jobsReason(selected);
  const hasState = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader
        title="Shipment Plan"
        helper="Plan trucks and loads: group orders, assign a gate and carrier, track loading and ship the whole load at once."
        tabs="shipment-plans"
        actions={a.can.create ? <Button variant="primary" onClick={() => setDrawer({ editId: null })}><Plus className="h-3.5 w-3.5" aria-hidden />Create shipment plan</Button> : null}
      />
      <GridToolbar
        {...g.toolbarProps}
        searchPlaceholder="Plan code or truck plate"
        onRefresh={refresh}
        bulkActions={bulkActions}
        selectedIds={g.selectedIds}
        bulkNoun="shipment plan"
        trailing={
          <>
            {a.can.print ? <PrintMenu reason={printReason} onManifest={() => a.print(selected)} /> : null}
            {a.can.jobs ? (
              <DisabledReason reason={jobsReason}>
                <Button variant="secondary" disabled={Boolean(jobsReason)} onClick={() => a.openJobs(selected)}><ListPlus className="h-3.5 w-3.5" aria-hidden />Picking/job operations</Button>
              </DisabledReason>
            ) : null}
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<PlanRow>
          {...g.gridProps}
          columns={columns}
          exportColumns={PLAN_EXPORT_COLUMNS}
          getRowId={(r) => r.id}
          rowActions={rowActions}
          onRowClick={(r) => router.push(planHref(r))}
          emptyTitle={hasState ? "Could not find any shipment plan" : "No shipment plans yet"}
          emptyDescription={hasState ? "Try changing the filters or search term." : undefined}
          emptyAction={hasState || !a.can.create ? undefined : (
            <EmptyState compact title="" cards={[
              { title: "Plan your first truck", description: "Group orders for one carrier pickup or LTL load.", icon: Truck, onClick: () => setDrawer({ editId: null }) },
              { title: "Orders ready to ship?", description: "See the order backlog first.", icon: Eye, href: "/orders" },
            ]} />
          )}
        />
      </div>
      {drawer ? <PlanDrawer open onOpenChange={(o) => (o ? undefined : setDrawer(null))} editId={drawer.editId} onSaved={refresh} /> : null}
      {changeLog ? <PlanChangeLogDrawer open onOpenChange={(o) => (o ? undefined : setChangeLog(null))} entityId={changeLog.id} entityCode={changeLog.code} /> : null}
      {a.dialogs}
      <span className="sr-only" aria-live="polite">{g.isFetching ? "Loading shipment plans" : `${g.total} shipment plans`}</span>
    </div>
  );
}
