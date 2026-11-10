"use client";

/**
 * Receiving Screen Configuration list (`/settings/screen-configuration/receiving`): grid with
 * filters and refresh; bulk Activate / Deactivate / Delete; row ⋯ Edit · Duplicate ·
 * Activate/Deactivate · Change log · Delete. Create opens the editor page.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, History, Pencil, Plus, Power, PowerOff, Trash2 } from "lucide-react";
import { z } from "zod";
import { DataGrid, DateCell, GridToolbar, useGrid, type BulkAction, type GridColumnDef, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { useApiQuery } from "@/lib/query-client";
import { SCREEN_CONFIG_FIELDS, SCREEN_CONFIGS_GRID_KEY } from "@/lib/grid-defs/admin/screen-configs";
import type { ScreenConfigRow } from "@/server/repositories/screen-configs";
import { EntityChangeLogDrawer, Muted, NO_PERMISSION, toastBulk, toFilterFields, useAction, usePagePerms, type BulkResponse } from "../admin-shared";

const PERMS = ["view", "create", "edit", "delete", "duplicate"] as const;
const BASE = "/settings/screen-configuration/receiving";

const optionsSchema = z.object({
  warehouses: z.array(z.object({ id: z.string(), code: z.string(), name: z.string() })),
  clients: z.array(z.object({ id: z.string(), code: z.string(), name: z.string() })),
  vendors: z.array(z.object({ id: z.string(), name: z.string(), clientId: z.string() })),
  poTypes: z.array(z.string()),
});
export type ScreenConfigOptions = z.infer<typeof optionsSchema>;

export function useScreenConfigOptions(): ScreenConfigOptions & { readonly loading: boolean } {
  const q = useApiQuery<unknown>(["screen-config-options"], "/api/screen-configs/options", { staleTime: 60_000 });
  const parsed = optionsSchema.safeParse(q.data?.data);
  return { ...(parsed.success ? parsed.data : { warehouses: [], clients: [], vendors: [], poTypes: [] }), loading: q.isPending };
}

function columns(onOpen: (id: string) => void): GridColumnDef<ScreenConfigRow>[] {
  return [
    { id: "name", header: "Configuration name", size: 240, meta: { alwaysVisible: true },
      cell: ({ row }) => <button type="button" onClick={() => onOpen(row.original.id)} className="text-left font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{row.original.name}</button> },
    { id: "warehouseName", header: "Warehouse", size: 200, cell: ({ row }) => row.original.warehouseName },
    { id: "operationType", header: "Operation type", size: 130, cell: ({ row }) => row.original.operationType },
    { id: "screenName", header: "Screen name", size: 130, cell: ({ row }) => row.original.screenName },
    { id: "conditions", header: "Applies to", size: 160, enableSorting: false,
      cell: ({ row }) => row.original.conditionCount ? <Badge tone="info" size="sm" shape="pill">{row.original.conditionCount} {row.original.conditionCount === 1 ? "condition" : "conditions"}</Badge> : <Muted>Every purchase order</Muted> },
    { id: "steps", header: "Steps on", size: 100, enableSorting: false, meta: { align: "right" }, cell: ({ row }) => <span className="block text-right tabular-nums">{row.original.enabledSteps}</span> },
    { id: "isActive", header: "Is active", size: 100, cell: ({ row }) => <Badge tone={row.original.isActive ? "success" : "neutral"} size="sm" shape="pill">{row.original.isActive ? "Yes" : "No"}</Badge> },
    { id: "createdAt", header: "Created date", size: 172, cell: ({ row }) => <DateCell value={row.original.createdAt} /> },
    { id: "createdByName", header: "Created by", size: 150, cell: ({ row }) => row.original.createdByName ?? <Muted>System</Muted> },
  ];
}

export function ScreenConfigListPage() {
  const router = useRouter();
  const perms = usePagePerms("settings.screen_configuration", PERMS);
  const options = useScreenConfigOptions();
  const fields = React.useMemo(() => toFilterFields(SCREEN_CONFIG_FIELDS, { warehouseId: options.warehouses.map((w) => ({ value: w.id, label: w.name })) }), [options.warehouses]);
  const g = useGrid<ScreenConfigRow>({ gridKey: SCREEN_CONFIGS_GRID_KEY, path: "/api/screen-configs", fields });
  const [log, setLog] = React.useState<ScreenConfigRow | null>(null);
  const [toDelete, setToDelete] = React.useState<readonly ScreenConfigRow[] | null>(null);
  const [status, setStatus] = React.useState<{ rows: readonly ScreenConfigRow[]; isActive: boolean } | null>(null);
  const action = useAction([["grid", SCREEN_CONFIGS_GRID_KEY], ["screen-configs-count"]]);
  const selected = (ids: readonly string[]) => g.rows.filter((r) => ids.includes(r.id));
  const edit = (id: string) => router.push(`${BASE}/${id}`);
  const create = () => router.push(`${BASE}/new`);
  const cols = React.useMemo(() => columns(edit), []); // eslint-disable-line react-hooks/exhaustive-deps
  const duplicate = async (row: ScreenConfigRow) => {
    const result = await action.run<{ id: string; name: string }>(`/api/screen-configs/${row.id}/duplicate`, "POST");
    if (result) toast.success("Configuration duplicated", `${result.name} was created inactive.`, { action: { label: "Edit", onClick: () => edit(result.id) } });
  };
  const bulkActions: readonly BulkAction[] = [
    { key: "activate", label: "Activate", icon: Power, onSelect: (ids) => setStatus({ rows: selected(ids), isActive: true }), disabledReason: perms.edit ? null : NO_PERMISSION },
    { key: "deactivate", label: "Deactivate", icon: PowerOff, onSelect: (ids) => setStatus({ rows: selected(ids), isActive: false }), disabledReason: perms.edit ? null : NO_PERMISSION },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: (ids) => setToDelete(selected(ids)), disabledReason: perms.delete ? null : NO_PERMISSION },
  ];
  const rowActions = (row: ScreenConfigRow): readonly RowAction[] => [
    { key: "edit", label: "Edit", icon: Pencil, onSelect: () => edit(row.id), disabledReason: perms.edit ? null : NO_PERMISSION },
    { key: "duplicate", label: "Duplicate", icon: Copy, onSelect: () => void duplicate(row), disabledReason: perms.duplicate ? null : NO_PERMISSION },
    row.isActive
      ? { key: "deactivate", label: "Deactivate", icon: PowerOff, onSelect: () => setStatus({ rows: [row], isActive: false }), disabledReason: perms.edit ? null : NO_PERMISSION }
      : { key: "activate", label: "Activate", icon: Power, onSelect: () => setStatus({ rows: [row], isActive: true }), disabledReason: perms.edit ? null : NO_PERMISSION },
    { key: "log", label: "Change log", icon: History, onSelect: () => setLog(row) },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: () => setToDelete([row]), disabledReason: perms.delete ? null : NO_PERMISSION },
  ];
  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Receiving Screen Configuration List"
        breadcrumbs={[{ label: "Settings" }, { label: "Screen Configuration", href: "/settings/screen-configuration" }, { label: "List" }]}
        helper="You can list your screen configuration setups and create new ones."
        actions={<DisabledReason reason={perms.create ? null : NO_PERMISSION}><Button variant="primary" disabled={!perms.create} onClick={create}><Plus className="h-4 w-4" aria-hidden />Create receiving configuration</Button></DisabledReason>} />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search by configuration name" bulkActions={bulkActions} bulkNoun="configuration" />
      <DataGrid<ScreenConfigRow>
        {...g.gridProps}
        columns={cols}
        getRowId={(r) => r.id}
        rowActions={rowActions}
        onRowClick={(r) => edit(r.id)}
        emptyTitle={filtered ? "No configurations match these filters" : "No receiving configurations yet"}
        emptyDescription={filtered ? "Clear a filter or search for another name." : "Without a configuration, receiving uses the product's tracking settings for every step."}
        emptyAction={perms.create && !filtered ? <Button variant="primary" onClick={create}><Plus className="h-4 w-4" />Create receiving configuration</Button> : undefined}
      />
      <EntityChangeLogDrawer open={log !== null} onOpenChange={(o) => !o && setLog(null)} path={log ? `/api/screen-configs/${log.id}/change-log` : null} title={`Configuration change log · ${log?.name ?? ""}`} />
      <ConfirmDialog
        open={status !== null}
        onOpenChange={(o) => !o && setStatus(null)}
        variant={status?.isActive ? "info" : "attention"}
        title={status ? `${status.isActive ? "Activate" : "Deactivate"} ${status.rows.length === 1 ? status.rows[0]?.name : `${status.rows.length} configurations`}?` : ""}
        description={status?.isActive ? "The receiving screen starts using it for matching purchase orders right away." : "Receiving falls back to another matching configuration, or to the product settings."}
        confirmLabel={status?.isActive ? "Yes, activate" : "Yes, deactivate"}
        cancelLabel="No"
        onConfirm={async () => {
          if (!status) return;
          const result = await action.run<BulkResponse>("/api/screen-configs/bulk-status", "POST", { ids: status.rows.map((r) => r.id), isActive: status.isActive });
          if (result) { toastBulk(result, "configuration", status.isActive ? "activated" : "deactivated"); g.clearSelection(); }
          setStatus(null);
        }}
      />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        variant="danger"
        title={`Delete ${toDelete?.length === 1 ? toDelete[0]?.name : `${toDelete?.length ?? 0} configurations`}?`}
        description="Receiving stops using them immediately. This can't be undone."
        confirmLabel="Yes, delete"
        cancelLabel="No"
        records={{ columns: [{ key: "name", label: "Configuration" }, { key: "wh", label: "Warehouse" }, { key: "active", label: "Active" }], rows: (toDelete ?? []).map((r) => ({ name: r.name, wh: r.warehouseName, active: r.isActive ? "Yes" : "No" })) }}
        onConfirm={async () => {
          const result = await action.run<BulkResponse>("/api/screen-configs/bulk-delete", "POST", { ids: (toDelete ?? []).map((r) => r.id) });
          if (result) { toastBulk(result, "configuration", "deleted"); g.clearSelection(); }
          setToDelete(null);
        }}
      />
    </div>
  );
}
