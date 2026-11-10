"use client";

/** Rate Shopping Presets (`/automation/rate-shopping`, spec 06 §6): grid, bulk Delete, row ⋯ Edit · Change log · Delete. */
import * as React from "react";
import { History, Pencil, Plus, Trash2 } from "lucide-react";
import { DataGrid, GridToolbar, useGrid, type BulkAction, type GridColumnDef, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { DisabledReason } from "@/components/ui/tooltip";
import { RATE_SHOPPING_FIELDS, RATE_SHOPPING_GRID_KEY } from "@/lib/grid-defs/integrations/rate-shopping";
import type { PresetRow } from "@/server/repositories/rate-shopping";
import { EntityChangeLogDrawer, Muted, NO_PERMISSION, YesNo, toastBulk, toFilterFields, useAction, useClientOptions, usePagePerms, useWarehouseOptions, type BulkResponse } from "@/components/integrations/shared/shared";
import { PresetDrawer } from "./preset-drawer";

const PERMS = ["view", "create", "edit", "delete", "change_log"] as const;

export function RateShoppingPage() {
  const perms = usePagePerms("automation.rate_shopping", PERMS);
  const warehouses = useWarehouseOptions();
  const clients = useClientOptions();
  const fields = React.useMemo(() => toFilterFields(RATE_SHOPPING_FIELDS, { warehouseId: warehouses.short, clientId: clients }), [warehouses.short, clients]);
  const g = useGrid<PresetRow>({ gridKey: RATE_SHOPPING_GRID_KEY, path: "/api/rate-shopping-presets", fields });
  const [drawer, setDrawer] = React.useState<{ open: boolean; editId: string | null }>({ open: false, editId: null });
  const [log, setLog] = React.useState<PresetRow | null>(null);
  const [toDelete, setToDelete] = React.useState<readonly PresetRow[] | null>(null);
  const action = useAction([["grid", RATE_SHOPPING_GRID_KEY]]);
  const edit = (id: string) => setDrawer({ open: true, editId: id });

  const COLUMNS: GridColumnDef<PresetRow>[] = [
    { id: "name", header: "Preset name", size: 200, meta: { alwaysVisible: true }, cell: ({ row }) => (
      <button type="button" className="truncate font-medium text-primary hover:underline focus-visible:outline-none focus-visible:underline" onClick={(e) => { e.stopPropagation(); edit(row.original.id); }}>{row.original.name}</button>
    ) },
    { id: "method", header: "Rate calculation method", size: 200, cell: ({ row }) => row.original.method },
    { id: "description", header: "Description", size: 240, cell: ({ row }) => <span className="truncate" title={row.original.description}>{row.original.description}</span> },
    { id: "showErrors", header: "Show error messages", size: 170, cell: ({ row }) => <YesNo value={row.original.showErrors} /> },
    { id: "useAllServices", header: "Use all available services", size: 210, cell: ({ row }) => <YesNo value={row.original.useAllServices} /> },
    { id: "serviceCount", header: "Shipping options", size: 140, meta: { align: "right" }, cell: ({ row }) => <div className="text-right tabular-nums">{row.original.useAllServices ? <Muted>All</Muted> : row.original.serviceCount}</div> },
    { id: "isActive", header: "Status", size: 100, cell: ({ row }) => <StatusPill status={row.original.isActive ? "Active" : "Inactive"} domain="active" /> },
    { id: "transitDays", header: "Transit time", size: 110, meta: { align: "right" }, cell: ({ row }) => <div className="text-right tabular-nums">{row.original.transitDays ? `${row.original.transitDays} days` : <Muted />}</div> },
    { id: "clientCode", header: "Client", size: 180, cell: ({ row }) => row.original.clientName },
    { id: "warehouseCode", header: "Warehouse", size: 110, cell: ({ row }) => row.original.warehouseCode },
  ];

  const bulkActions: readonly BulkAction[] = [
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: (ids) => setToDelete(g.rows.filter((r) => ids.includes(r.id))), disabledReason: perms.delete ? null : NO_PERMISSION },
  ];
  const rowActions = (row: PresetRow): readonly RowAction[] => [
    { key: "edit", label: "Edit", icon: Pencil, onSelect: () => edit(row.id), disabledReason: perms.edit ? null : NO_PERMISSION },
    { key: "log", label: "Change log", icon: History, onSelect: () => setLog(row), disabledReason: perms.change_log ? null : NO_PERMISSION },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: () => setToDelete([row]), disabledReason: perms.delete ? null : NO_PERMISSION },
  ];
  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  const create = () => setDrawer({ open: true, editId: null });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Rate Shopping Presets" helper="Rate shopping presets can be created, viewed and edited on this screen."
        actions={<DisabledReason reason={perms.create ? null : NO_PERMISSION}><Button variant="primary" disabled={!perms.create} onClick={create}><Plus className="h-4 w-4" aria-hidden />Create Rate Shopping Preset</Button></DisabledReason>} />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search by name" bulkActions={bulkActions} bulkNoun="preset" />
      <DataGrid<PresetRow>
        {...g.gridProps}
        columns={COLUMNS}
        getRowId={(r) => r.id}
        rowActions={rowActions}
        onRowClick={(r) => (perms.edit ? edit(r.id) : undefined)}
        emptyTitle={filtered ? "No presets match these filters" : "No rate shopping presets yet"}
        emptyDescription={filtered ? "Clear a filter or search for another name." : "Create a preset to let labels pick the cheapest or fastest service automatically."}
        emptyAction={perms.create && !filtered ? <Button variant="primary" onClick={create}><Plus className="h-4 w-4" />Create rate shopping preset</Button> : undefined}
      />
      <PresetDrawer open={drawer.open} editId={drawer.editId} onOpenChange={(o) => setDrawer((d) => ({ ...d, open: o }))} onSaved={() => g.refetch()} />
      <EntityChangeLogDrawer open={log !== null} onOpenChange={(o) => !o && setLog(null)} path={log ? `/api/rate-shopping-presets/${log.id}/change-log` : null} title={`Change log · ${log?.name ?? ""}`} />
      <ConfirmDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)} variant="danger"
        title={`Delete ${toDelete?.length === 1 ? `preset ${toDelete[0]?.name}` : `${toDelete?.length ?? 0} presets`}?`}
        description="Presets set on open orders are skipped; set them inactive instead." confirmLabel="Yes, delete" cancelLabel="No"
        records={{ columns: [{ key: "name", label: "Preset" }, { key: "method", label: "Method" }, { key: "client", label: "Client" }], rows: (toDelete ?? []).map((r) => ({ name: r.name, method: r.method, client: r.clientName })) }}
        onConfirm={async () => {
          const result = await action.run<BulkResponse>("/api/rate-shopping-presets/bulk-delete", "POST", { ids: (toDelete ?? []).map((r) => r.id) });
          if (result) { toastBulk(result, "preset", "deleted"); g.clearSelection(); }
          setToDelete(null);
        }} />
    </div>
  );
}
