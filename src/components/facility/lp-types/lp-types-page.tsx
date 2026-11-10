"use client";

/**
 * LP Types (`/settings/lp-types`, LP tab group): 21-column grid, Create (3-step wizard),
 * bulk Delete, row ⋯ Show details · Edit · Change log · Delete (blocked while LP numbers exist).
 */
import * as React from "react";
import { Eye, History, Pencil, Plus, Trash2 } from "lucide-react";
import { DataGrid, GridToolbar, LinkCell, useGrid, type BulkAction, type GridColumnDef, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { DisabledReason } from "@/components/ui/tooltip";
import { useApiQuery } from "@/lib/query-client";
import { LP_TYPE_FIELDS, LP_TYPE_PARAMETERS, LP_TYPES_GRID_KEY } from "@/lib/grid-defs/facility/lp-types";
import type { LpTypeDetail, LpTypeRow } from "@/server/repositories/lp-types";
import { DetailList, EntityChangeLogDrawer, Muted, NO_PERMISSION, Num, StatRow, toastBulk, toFilterFields, useAction, usePagePerms, useWarehouseOptions, YesNo, type BulkResponse } from "@/components/facility/facility-shared";
import { LpTypeWizardDrawer } from "./lp-type-wizard";

const PERMS = ["view", "create", "edit", "delete"] as const;
const hidden = { defaultVisible: false } as const;
const right = (v: number, decimals = 2) => <div className="text-right"><Num value={v} decimals={decimals} /></div>;

const PARAM_COLUMNS: GridColumnDef<LpTypeRow>[] = LP_TYPE_PARAMETERS.map((p) => ({
  id: p.key, header: p.label, size: 150, meta: p.key === "suitableForParentLp" || p.key === "onlyOneSku" ? {} : hidden,
  cell: ({ row }) => <YesNo value={row.original[p.key]} />,
}));

const COLUMNS: GridColumnDef<LpTypeRow>[] = [
  { id: "code", header: "Code", size: 120, meta: { alwaysVisible: true }, cell: ({ row }) => <span className="font-medium text-foreground">{row.original.code}</span> },
  { id: "description", header: "Description", size: 200, cell: ({ row }) => row.original.description ?? <Muted /> },
  { id: "warehouseCode", header: "Warehouse", size: 100, cell: ({ row }) => row.original.warehouseCode },
  { id: "numberPrefix", header: "Number prefix", size: 120, cell: ({ row }) => <code className="font-mono text-[12px]">{row.original.numberPrefix}</code> },
  { id: "numberLength", header: "Number length", size: 120, meta: { align: "right" }, cell: ({ row }) => right(row.original.numberLength, 0) },
  { id: "nextNumber", header: "Next number", size: 140, meta: { headerTip: "Issued by the next Create LP Number from sequence" }, cell: ({ row }) => <code className="font-mono text-[12px] text-secondary">{row.original.nextNumber}</code> },
  { id: "lpCount", header: "LP count", size: 100, meta: { align: "right" }, cell: ({ row }) => <div className="text-right"><LinkCell href={`/settings/lp-numbers?f.lpTypeId=in:${row.original.id}`}>{row.original.lpCount.toLocaleString("en-US")}</LinkCell></div> },
  { id: "length", header: "Length", size: 90, meta: { align: "right" }, cell: ({ row }) => right(row.original.length) },
  { id: "width", header: "Width", size: 90, meta: { align: "right" }, cell: ({ row }) => right(row.original.width) },
  { id: "height", header: "Height", size: 90, meta: { align: "right" }, cell: ({ row }) => right(row.original.height) },
  { id: "dimensionUnit", header: "Dimension unit", size: 120, meta: hidden, cell: ({ row }) => row.original.dimensionUnit },
  { id: "emptyWeight", header: "Empty weight", size: 110, meta: { ...hidden, align: "right" }, cell: ({ row }) => right(row.original.emptyWeight) },
  { id: "maxWeight", header: "Max weight", size: 110, meta: { ...hidden, align: "right" }, cell: ({ row }) => right(row.original.maxWeight) },
  { id: "weightUnit", header: "Weight unit", size: 110, meta: hidden, cell: ({ row }) => row.original.weightUnit },
  { id: "maxVolume", header: "Max volume", size: 110, meta: { ...hidden, align: "right" }, cell: ({ row }) => right(row.original.maxVolume, 0) },
  { id: "volumeUnit", header: "Volume unit", size: 110, meta: hidden, cell: ({ row }) => row.original.volumeUnit },
  ...PARAM_COLUMNS,
  { id: "createdAt", header: "Created date", size: 130, meta: hidden, cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString("en-US") },
];

function LpTypeDetailDrawer({ id, onOpenChange, onEdit, canEdit }: { readonly id: string | null; readonly onOpenChange: (o: boolean) => void; readonly onEdit: (id: string) => void; readonly canEdit: boolean }) {
  const q = useApiQuery<LpTypeDetail>(["lp-type", id ?? ""], id ? `/api/lp-types/${id}` : null, { staleTime: 0 });
  const d = q.data?.data;
  const count = (status: string) => d?.byStatus.find((b) => b.status === status)?.n ?? 0;
  return (
    <Drawer open={id !== null} onOpenChange={onOpenChange} width={45} title={d ? `LP type ${d.code}` : "LP type"} description={d?.description ?? "License plate type details"}
      footer={d && canEdit ? <div className="flex justify-end"><Button variant="primary" onClick={() => onEdit(d.id)}><Pencil className="h-4 w-4" />Edit</Button></div> : undefined}>
      {q.isPending ? <Skeleton className="h-64 w-full" /> : q.isError || !d ? <EmptyState title="Couldn't load this LP type" description={q.error?.message} action={<Button onClick={() => void q.refetch()}>Retry</Button>} /> : (
        <div className="flex flex-col gap-5">
          <StatRow stats={[{ label: "LP numbers", value: d.lpCount.toLocaleString("en-US") }, { label: "Empty", value: count("Empty") }, { label: "Occupied", value: count("Occupied") }, { label: "Next number", value: <span className="font-mono text-[14px]">{d.nextNumber}</span> }]} />
          <DetailList title="General" items={[
            { label: "Warehouse", value: d.warehouseCode }, { label: "Number format", value: `${d.numberPrefix} + ${d.numberLength} digits` },
            { label: "Dimensions", value: `${d.length} × ${d.width} × ${d.height} ${d.dimensionUnit}` }, { label: "Max volume", value: d.maxVolume ? `${d.maxVolume} ${d.volumeUnit}` : "No limit" },
            { label: "Empty weight", value: `${d.emptyWeight} ${d.weightUnit}` }, { label: "Max weight", value: d.maxWeight ? `${d.maxWeight} ${d.weightUnit}` : "No limit" },
          ]} />
          <section className="flex flex-col gap-2">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-secondary">Parameters</h3>
            <div className="flex flex-wrap gap-1.5">
              {LP_TYPE_PARAMETERS.map((p) => <Badge key={p.key} tone={d[p.key] ? "success" : "outline"} size="md" shape="pill">{d[p.key] ? "✓ " : ""}{p.label}</Badge>)}
            </div>
          </section>
        </div>
      )}
    </Drawer>
  );
}

export function LpTypesPage() {
  const perms = usePagePerms("settings.lp_types", PERMS);
  const warehouses = useWarehouseOptions();
  const fields = React.useMemo(() => toFilterFields(LP_TYPE_FIELDS, { warehouseId: warehouses.short }), [warehouses.short]);
  const g = useGrid<LpTypeRow>({ gridKey: LP_TYPES_GRID_KEY, path: "/api/lp-types", fields });
  const [wizard, setWizard] = React.useState<{ open: boolean; editId: string | null }>({ open: false, editId: null });
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [log, setLog] = React.useState<LpTypeRow | null>(null);
  const [toDelete, setToDelete] = React.useState<readonly LpTypeRow[] | null>(null);
  const action = useAction([["grid", LP_TYPES_GRID_KEY], ["lp-types-options"]]);
  const selected = (ids: readonly string[]) => g.rows.filter((r) => ids.includes(r.id));
  const deleteReason = (row: LpTypeRow) => (!perms.delete ? NO_PERMISSION : row.lpCount > 0 ? `${row.lpCount.toLocaleString("en-US")} LP numbers use this type` : null);

  const bulkActions: readonly BulkAction[] = [
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: (ids) => setToDelete(selected(ids)), disabledReason: perms.delete ? null : NO_PERMISSION,
      eligibility: (ids) => { const rows = selected(ids); return rows.length && rows.every((r) => r.lpCount > 0) ? "LP types with LP numbers can't be deleted" : null; } },
  ];
  const rowActions = (row: LpTypeRow): readonly RowAction[] => [
    { key: "details", label: "Show details", icon: Eye, onSelect: () => setDetailId(row.id) },
    { key: "edit", label: "Edit", icon: Pencil, onSelect: () => setWizard({ open: true, editId: row.id }), disabledReason: perms.edit ? null : NO_PERMISSION },
    { key: "log", label: "Change log", icon: History, onSelect: () => setLog(row) },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: () => setToDelete([row]), disabledReason: deleteReason(row) },
  ];
  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="LP Types" tabs="lp" helper="Pallets, totes and carts: numbering, dimensions and the mixing rules for each license plate type."
        actions={<DisabledReason reason={perms.create ? null : NO_PERMISSION}><Button variant="primary" disabled={!perms.create} onClick={() => setWizard({ open: true, editId: null })}><Plus className="h-4 w-4" aria-hidden />Create LP type</Button></DisabledReason>} />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search LP type code or description" bulkActions={bulkActions} bulkNoun="LP type" />
      <DataGrid<LpTypeRow>
        {...g.gridProps}
        columns={COLUMNS}
        getRowId={(r) => r.id}
        rowActions={rowActions}
        onRowClick={(r) => setDetailId(r.id)}
        emptyTitle={filtered ? "No LP types match these filters" : "No LP types yet"}
        emptyDescription={filtered ? "Clear a filter or search for another code." : "Create a pallet or tote type before issuing LP numbers."}
        emptyAction={perms.create && !filtered ? <Button variant="primary" onClick={() => setWizard({ open: true, editId: null })}><Plus className="h-4 w-4" />Create LP type</Button> : undefined}
      />
      <LpTypeWizardDrawer open={wizard.open} editId={wizard.editId} defaultWarehouseId={warehouses.defaultId} onOpenChange={(o) => setWizard((w) => ({ ...w, open: o }))} onSaved={() => g.refetch()} />
      <LpTypeDetailDrawer id={detailId} onOpenChange={(o) => !o && setDetailId(null)} canEdit={perms.edit} onEdit={(id) => { setDetailId(null); setWizard({ open: true, editId: id }); }} />
      <EntityChangeLogDrawer open={log !== null} onOpenChange={(o) => !o && setLog(null)} path={log ? `/api/lp-types/${log.id}/change-log` : null} title={`Change log · ${log?.code ?? ""}`} />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        variant="danger"
        title={`Delete ${toDelete?.length === 1 ? `LP type ${toDelete[0]?.code}` : `${toDelete?.length ?? 0} LP types`}?`}
        description="LP types that still have LP numbers or location capacities are skipped."
        confirmLabel="Yes, delete"
        cancelLabel="No"
        records={{ columns: [{ key: "code", label: "LP type" }, { key: "warehouse", label: "Warehouse" }, { key: "lps", label: "LP numbers" }], rows: (toDelete ?? []).map((r) => ({ code: r.code, warehouse: r.warehouseCode, lps: r.lpCount })) }}
        onConfirm={async () => {
          const result = await action.run<BulkResponse>("/api/lp-types/bulk-delete", "POST", { ids: (toDelete ?? []).map((r) => r.id) });
          if (result) { toastBulk(result, "LP type", "deleted"); g.clearSelection(); }
          setToDelete(null);
        }}
      />
    </div>
  );
}
