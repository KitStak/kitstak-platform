"use client";

/**
 * Shipment Packages (`/settings/shipment-packages`): grid, Create (4-step wizard), bulk Delete,
 * row ⋯ Show details · Edit · Change log · Delete (blocked once the package has been used).
 */
import * as React from "react";
import { Eye, History, Pencil, Plus, Trash2 } from "lucide-react";
import { DataGrid, GridToolbar, useGrid, type BulkAction, type GridColumnDef, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { CustomFieldsLink } from "@/components/admin/custom-fields/custom-fields-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/lib/query-client";
import { packageDeleteCopy, packageDeleteReason, SHIPMENT_PACKAGE_FIELDS, SHIPMENT_PACKAGES_GRID_KEY } from "@/lib/grid-defs/facility/shipment-packages";
import type { ShipmentPackageDetail, ShipmentPackageRow } from "@/server/repositories/shipment-packages";
import { CodeCell, DetailList, EntityChangeLogDrawer, Muted, NO_PERMISSION, Num, StatRow, toastBulk, toFilterFields, useAction, usePagePerms, useWarehouseOptions, YesNo, type BulkResponse } from "@/components/facility/facility-shared";
import { ShipmentPackageWizardDrawer } from "./shipment-package-wizard";

const PERMS = ["view", "create", "edit", "delete"] as const;
const hidden = { defaultVisible: false } as const;
const right = (v: number | null, decimals = 2) => <div className="text-right"><Num value={v} decimals={decimals} /></div>;

const COLUMNS: GridColumnDef<ShipmentPackageRow>[] = [
  { id: "code", header: "Code", size: 160, meta: { alwaysVisible: true }, cell: ({ row }) => <CodeCell label={`shipment package ${row.original.code} (${row.original.warehouseCode})`}>{row.original.code}</CodeCell> },
  { id: "description", header: "Description", size: 300, cell: ({ row }) => row.original.description ? <span className="block truncate" title={row.original.description}>{row.original.description}</span> : <Muted /> },
  { id: "warehouseCode", header: "Warehouse", size: 100, cell: ({ row }) => row.original.warehouseCode },
  { id: "trackInventory", header: "Tracked", size: 112, meta: { label: "Track inventory", headerTip: "Packing reduces this box's packaging stock" }, cell: ({ row }) => <YesNo value={row.original.trackInventory} /> },
  { id: "reductionRule", header: "Reduced from", size: 230, meta: { label: "Inventory reduction location" }, cell: ({ row }) => row.original.trackInventory ? (row.original.reductionRule === "Specific Location" ? `${row.original.reductionRule} · ${row.original.reductionLocationCode ?? ""}` : row.original.reductionRule) : <Muted /> },
  { id: "inventorySku", header: "Packaging SKU", size: 140, enableSorting: false, meta: hidden, cell: ({ row }) => row.original.inventorySku ?? <Muted /> },
  { id: "length", header: "Length", size: 90, meta: { align: "right" }, cell: ({ row }) => right(row.original.length) },
  { id: "width", header: "Width", size: 90, meta: { align: "right" }, cell: ({ row }) => right(row.original.width) },
  { id: "height", header: "Height", size: 90, meta: { align: "right" }, cell: ({ row }) => right(row.original.height) },
  { id: "dimensionUnit", header: "Dimension unit", size: 136, cell: ({ row }) => row.original.dimensionUnit },
  { id: "emptyWeight", header: "Empty weight", size: 136, meta: { align: "right" }, cell: ({ row }) => right(row.original.emptyWeight) },
  { id: "maxWeight", header: "Max weight", size: 136, meta: { align: "right" }, cell: ({ row }) => right(row.original.maxWeight) },
  { id: "weightUnit", header: "Weight unit", size: 136, cell: ({ row }) => row.original.weightUnit },
  { id: "maxVolume", header: "Max volume", size: 136, meta: { align: "right" }, cell: ({ row }) => right(row.original.maxVolume, 0) },
  { id: "volumeUnit", header: "Volume unit", size: 136, cell: ({ row }) => row.original.volumeUnit },
  { id: "purchasePrice", header: "Purchase price", size: 120, meta: { ...hidden, align: "right" }, cell: ({ row }) => <div className="text-right tabular-nums">{row.original.purchasePrice.toFixed(2)} {row.original.currency}</div> },
  { id: "allClients", header: "Client access", size: 130, meta: hidden, cell: ({ row }) => (row.original.allClients ? "All clients" : `${row.original.clientCount} clients`) },
  { id: "isActive", header: "Active?", size: 90, cell: ({ row }) => <YesNo value={row.original.isActive} /> },
  { id: "createdAt", header: "Created date", size: 130, meta: hidden, cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString("en-US") },
];

function PackageDetailDrawer({ id, onOpenChange, onEdit, canEdit }: { readonly id: string | null; readonly onOpenChange: (o: boolean) => void; readonly onEdit: (id: string) => void; readonly canEdit: boolean }) {
  const q = useApiQuery<ShipmentPackageDetail>(["shipment-package", id ?? ""], id ? `/api/shipment-packages/${id}` : null, { staleTime: 0 });
  const d = q.data?.data;
  return (
    <Drawer open={id !== null} onOpenChange={onOpenChange} width={45} title={d ? `Shipment package ${d.code}` : "Shipment package"} description={d?.description ?? "Package dimensions, client access and inventory tracking"}
      footer={d && canEdit ? <div className="flex justify-end"><Button variant="primary" onClick={() => onEdit(d.id)}><Pencil className="h-4 w-4" />Edit</Button></div> : undefined}>
      {q.isPending ? <Skeleton className="h-64 w-full" /> : q.isError || !d ? <EmptyState title="Couldn't load this shipment package" description={q.error?.message} action={<Button onClick={() => void q.refetch()}>Retry</Button>} /> : (
        <div className="flex flex-col gap-5">
          <StatRow stats={[
            { label: "Status", value: d.isActive ? <Badge tone="success" size="sm" shape="pill">Active</Badge> : <Badge tone="outline" size="sm" shape="pill">Inactive</Badge> },
            { label: "Shipments", value: d.usage.shipments }, { label: "Orders", value: d.usage.orders }, { label: "Products", value: d.usage.products },
          ]} />
          <DetailList title="General" items={[
            { label: "Warehouse", value: d.warehouseCode }, { label: "Dimensions", value: `${d.length} × ${d.width} × ${d.height} ${d.dimensionUnit}` },
            { label: "Empty weight", value: `${d.emptyWeight} ${d.weightUnit}` }, { label: "Max weight", value: d.maxWeight ? `${d.maxWeight} ${d.weightUnit}` : "No limit" },
            { label: "Max volume", value: d.maxVolume ? `${d.maxVolume} ${d.volumeUnit}` : "No limit" }, { label: "Purchase price", value: `${d.purchasePrice.toFixed(2)} ${d.currency}` },
          ]} />
          <DetailList title="Inventory tracking" items={d.trackInventory ? [
            { label: "Owner", value: d.inventoryOwner }, { label: "Packaging SKU", value: d.inventorySku ? `${d.inventorySku}${d.inventoryProductName ? ` · ${d.inventoryProductName}` : ""}` : null },
            { label: "Reduced from", value: d.reductionRule === "Specific Location" ? `${d.reductionRule} · ${d.reductionLocationCode ?? ""}` : d.reductionRule, wide: true },
          ] : [{ label: "Tracking", value: "Not tracked", wide: true }]} />
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-secondary">Client access</h3>
            {d.allClients ? <p className="rounded-lg border border-border px-4 py-3 text-sm text-body">All existing and future clients</p> : (
              <div className="flex flex-wrap gap-1.5 rounded-lg border border-border px-4 py-3">
                {d.access.filter((a) => a.hasAccess).map((a) => <Badge key={a.clientId} tone="success" size="sm" shape="pill">{a.code}</Badge>)}
                {d.access.every((a) => !a.hasAccess) ? <Muted>No clients enabled</Muted> : null}
              </div>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}


export function ShipmentPackagesPage() {
  const perms = usePagePerms("settings.shipment_packages", PERMS);
  const warehouses = useWarehouseOptions();
  const fields = React.useMemo(() => toFilterFields(SHIPMENT_PACKAGE_FIELDS, { warehouseId: warehouses.short }), [warehouses.short]);
  const g = useGrid<ShipmentPackageRow>({ gridKey: SHIPMENT_PACKAGES_GRID_KEY, path: "/api/shipment-packages", fields });
  const [wizard, setWizard] = React.useState<{ open: boolean; editId: string | null }>({ open: false, editId: null });
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [log, setLog] = React.useState<ShipmentPackageRow | null>(null);
  const [toDelete, setToDelete] = React.useState<readonly ShipmentPackageRow[] | null>(null);
  const action = useAction([["grid", SHIPMENT_PACKAGES_GRID_KEY]]);
  const selected = (ids: readonly string[]) => g.rows.filter((r) => ids.includes(r.id));

  const bulkActions: readonly BulkAction[] = [
    { key: "delete", label: "Delete", icon: Trash2, onSelect: (ids) => setToDelete(selected(ids)), disabledReason: perms.delete ? null : NO_PERMISSION,
      eligibility: (ids) => { const rows = selected(ids); return rows.length > 0 && rows.every((r) => packageDeleteReason(r) !== null) ? (rows.length === 1 ? packageDeleteReason(rows[0]!) : "These packages have been used; set them inactive instead") : null; } },
  ];
  const rowActions = (row: ShipmentPackageRow): readonly RowAction[] => [
    { key: "details", label: "Show details", icon: Eye, onSelect: () => setDetailId(row.id) },
    { key: "edit", label: "Edit", icon: Pencil, onSelect: () => setWizard({ open: true, editId: row.id }), disabledReason: perms.edit ? null : NO_PERMISSION },
    { key: "log", label: "Change log", icon: History, onSelect: () => setLog(row) },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: () => setToDelete([row]), disabledReason: perms.delete ? packageDeleteReason(row) : NO_PERMISSION },
  ];
  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  const create = () => setWizard({ open: true, editId: null });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Shipment Packages" helpHref="/locations/help#shipment-packages" helper="Create and list the boxes, mailers and envelopes you pack orders into."
        actions={<><CustomFieldsLink entity="shipment_package" />{perms.create ? <Button variant="primary" onClick={create}><Plus className="h-4 w-4" aria-hidden />Create shipment package</Button> : null}</>} />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search package code or description" bulkActions={bulkActions} bulkNoun="shipment package" />
      <DataGrid<ShipmentPackageRow>
        {...g.gridProps}
        columns={COLUMNS}
        getRowId={(r) => r.id}
        rowActions={rowActions}
        onRowClick={(r) => setDetailId(r.id)}
        emptyTitle={filtered ? "No shipment packages match these filters" : "No shipment packages yet"}
        emptyDescription={filtered ? "Clear a filter or search for another code." : "Add the boxes your packers use so packing can suggest and track them."}
        emptyAction={perms.create && !filtered ? <Button variant="primary" onClick={create}><Plus className="h-4 w-4" />Create shipment package</Button> : undefined}
      />
      <ShipmentPackageWizardDrawer open={wizard.open} editId={wizard.editId} defaultWarehouseId={warehouses.defaultId} onOpenChange={(o) => setWizard((w) => ({ ...w, open: o }))} onSaved={() => g.refetch()} />
      <PackageDetailDrawer id={detailId} onOpenChange={(o) => !o && setDetailId(null)} canEdit={perms.edit} onEdit={(id) => { setDetailId(null); setWizard({ open: true, editId: id }); }} />
      <EntityChangeLogDrawer open={log !== null} onOpenChange={(o) => !o && setLog(null)} path={log ? `/api/shipment-packages/${log.id}/change-log` : null} title={`Change log · ${log?.code ?? ""}`} />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        variant="danger"
        title={`Delete ${toDelete?.length === 1 ? `shipment package ${toDelete[0]?.code}` : `${toDelete?.length ?? 0} shipment packages`}?`}
        description={packageDeleteCopy(toDelete ?? [])}
        confirmLabel="Yes, delete"
        cancelLabel="No"
        records={{ columns: [{ key: "code", label: "Package" }, { key: "warehouse", label: "Warehouse" }, { key: "dims", label: "Dimensions" }], rows: (toDelete ?? []).map((r) => ({ code: r.code, warehouse: r.warehouseCode, dims: `${r.length} × ${r.width} × ${r.height} ${r.dimensionUnit}` })) }}
        onConfirm={async () => {
          const result = await action.run<BulkResponse>("/api/shipment-packages/bulk-delete", "POST", { ids: (toDelete ?? []).map((r) => r.id) });
          if (result) { toastBulk(result, "shipment package", "deleted"); g.clearSelection(); }
          setToDelete(null);
        }}
      />
    </div>
  );
}
