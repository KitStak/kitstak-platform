"use client";

/**
 * Locations (`/locations`) on the shared grid: zone strip (drives the zone filter),
 * Import ▾, Generate, Create Location; bulk Label · Assign Capacity ▾ · Lock · Unlock ·
 * Delete; row ⋯ Show Details · Edit · Change Log · Delete.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Eye, History, Lock, LockOpen, Pencil, Plus, Printer, Trash2, Upload, Wand2 } from "lucide-react";
import { DataGrid, GridToolbar, useGrid, type BulkAction, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DisabledReason } from "@/components/ui/tooltip";
import { ChangeLogDrawer } from "@/components/shared/change-log-drawer";
import { PrintOptionsModal } from "@/components/shared/print-options-modal";
import { useApiQuery } from "@/lib/query-client";
import { LOCATION_FIELDS, LOCATIONS_GRID_KEY } from "@/lib/grid-defs/facility/locations";
import type { LocationRow } from "@/server/repositories/locations";
import { AvailabilityPill, NO_PERMISSION, toastBulk, toFilterFields, useAction, useClientOptions, useLookups, usePagePerms, useWarehouseOptions, type BulkResponse } from "@/components/facility/facility-shared";
import { LOCATION_COLUMNS } from "./location-columns";
import { LocationGeneratorDrawer } from "./location-generator-drawer";
import { LocationWizardDrawer } from "./location-wizard";
import { ZoneSummaryStrip, type ZoneCardData } from "./zone-summary-strip";

const PERMS = ["view", "create", "edit", "delete", "import_file", "change_log", "assign_capacity", "label"] as const;

export const CAPACITY_IMPORTS = [
  { href: "/imports/product-capacity", label: "Bulk import product capacity" },
  { href: "/imports/product-capacity-update", label: "Bulk update product capacity" },
  { href: "/imports/lp-capacity", label: "Bulk import LP capacity" },
  { href: "/imports/lp-capacity-update", label: "Bulk update LP capacity" },
] as const;

export function LocationsPage() {
  const router = useRouter();
  const perms = usePagePerms("settings.locations", PERMS);
  const warehouses = useWarehouseOptions();
  const clients = useClientOptions();
  const groups = useLookups("location_group");
  const zonesLookup = useLookups("location_zone");
  const fields = React.useMemo(() => toFilterFields(LOCATION_FIELDS, { warehouseId: warehouses.options, locationGroupId: groups.options, locationZoneId: zonesLookup.options, dedicatedClientId: clients }), [warehouses.options, groups.options, zonesLookup.options, clients]);
  const g = useGrid<LocationRow>({ gridKey: LOCATIONS_GRID_KEY, path: "/api/locations", fields });

  const whFilter = g.grid.query.filters.find((f) => f.field === "warehouseId");
  const zoneWarehouse = whFilter && whFilter.op === "in" && whFilter.values.length === 1 ? whFilter.values[0] : undefined;
  const zones = useApiQuery<ZoneCardData[]>(["location-zones", zoneWarehouse ?? "all"], "/api/locations/zones", { query: { warehouseId: zoneWarehouse } });
  const zoneFilter = g.grid.query.filters.find((f) => f.field === "locationZoneId");
  const activeZoneId = zoneFilter ? (zoneFilter.op === "in" && zoneFilter.values.length === 1 ? zoneFilter.values[0] : zoneFilter.op === "empty" ? null : undefined) : undefined;

  const [wizard, setWizard] = React.useState<{ open: boolean; editId: string | null }>({ open: false, editId: null });
  const [generator, setGenerator] = React.useState(false);
  const [log, setLog] = React.useState<LocationRow | null>(null);
  const [toDelete, setToDelete] = React.useState<readonly LocationRow[] | null>(null);
  const [labels, setLabels] = React.useState<readonly unknown[] | null>(null);
  const action = useAction([["grid", LOCATIONS_GRID_KEY], ["location-zones"]]);

  const refresh = () => { g.refetch(); void zones.refetch(); };
  const selectedRows = (ids: readonly string[]) => g.rows.filter((r) => ids.includes(r.id));

  const printLabels = async (ids: readonly string[]) => {
    const records = await action.run<unknown[]>("/api/locations/labels", "POST", { ids });
    if (records) setLabels(records);
  };
  const setLock = async (ids: readonly string[], locked: boolean) => {
    const result = await action.run<BulkResponse>("/api/locations/bulk-lock", "POST", { ids, locked });
    if (result) { toastBulk(result, "location", locked ? "locked" : "unlocked"); g.clearSelection(); }
  };

  const lockReason = (ids: readonly string[], locked: boolean) => {
    const rows = selectedRows(ids);
    if (rows.length > 0 && rows.every((r) => r.isLocked === locked)) return locked ? "The selected locations are already locked" : "The selected locations are not locked";
    return null;
  };
  const deleteReason = (ids: readonly string[]) => {
    const rows = selectedRows(ids);
    const busy = rows.filter((r) => r.storedUnits > 0 || r.openTaskCount > 0);
    if (rows.length > 0 && busy.length === rows.length) return `Locations with inventory or open tasks can't be deleted (${busy.slice(0, 3).map((r) => r.code).join(", ")}${busy.length > 3 ? "…" : ""})`;
    return null;
  };

  const bulkActions: readonly BulkAction[] = [
    { key: "label", label: "Label", icon: Printer, onSelect: (ids) => void printLabels(ids), disabledReason: perms.label ? null : NO_PERMISSION },
    { key: "lock", label: "Lock", icon: Lock, onSelect: (ids) => void setLock(ids, true), eligibility: (ids) => lockReason(ids, true), disabledReason: perms.edit ? null : NO_PERMISSION },
    { key: "unlock", label: "Unlock", icon: LockOpen, onSelect: (ids) => void setLock(ids, false), eligibility: (ids) => lockReason(ids, false), disabledReason: perms.edit ? null : NO_PERMISSION },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: (ids) => setToDelete(selectedRows(ids)), eligibility: deleteReason, disabledReason: perms.delete ? null : NO_PERMISSION },
  ];

  const rowActions = (row: LocationRow): readonly RowAction[] => [
    { key: "details", label: "Show details", icon: Eye, href: `/locations/${row.id}` },
    { key: "edit", label: "Edit", icon: Pencil, onSelect: () => setWizard({ open: true, editId: row.id }), disabledReason: perms.edit ? null : NO_PERMISSION },
    { key: "log", label: "Change log", icon: History, onSelect: () => setLog(row), disabledReason: perms.change_log ? null : NO_PERMISSION },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: () => setToDelete([row]),
      disabledReason: !perms.delete ? NO_PERMISSION : row.storedUnits > 0 ? `Holds ${row.storedUnits} units; move the stock first` : row.openTaskCount > 0 ? `Has ${row.openTaskCount} open tasks` : null },
  ];

  const assignCapacity = (
    <DropdownMenu>
      <DisabledReason reason={perms.assign_capacity ? null : NO_PERMISSION}>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" disabled={!perms.assign_capacity}>Assign capacity<ChevronDown className="h-3.5 w-3.5" aria-hidden /></Button>
        </DropdownMenuTrigger>
      </DisabledReason>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Excel imports</DropdownMenuLabel>
        {CAPACITY_IMPORTS.map((i) => <DropdownMenuItem key={i.href} href={i.href} icon={Upload}>{i.label}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Locations"
        helper="Create, edit, label and lock the bins, shelves and docks in each warehouse."
        actions={
          <>
            <DropdownMenu>
              <DisabledReason reason={perms.import_file ? null : NO_PERMISSION}>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" disabled={!perms.import_file}><Upload className="h-4 w-4" aria-hidden />Import<ChevronDown className="h-3.5 w-3.5" aria-hidden /></Button>
                </DropdownMenuTrigger>
              </DisabledReason>
              <DropdownMenuContent align="end">
                <DropdownMenuItem href="/imports/locations" icon={Upload} description="Add new locations from Excel">Bulk import locations</DropdownMenuItem>
                <DropdownMenuItem href="/imports/locations-update" icon={Upload} description="Change existing locations by code">Bulk update locations</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Capacity</DropdownMenuLabel>
                {CAPACITY_IMPORTS.map((i) => <DropdownMenuItem key={i.href} href={i.href} icon={Upload}>{i.label}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
            <DisabledReason reason={perms.create ? null : NO_PERMISSION}>
              <Button variant="secondary" disabled={!perms.create} onClick={() => setGenerator(true)}><Wand2 className="h-4 w-4" aria-hidden />Generate locations</Button>
            </DisabledReason>
            <DisabledReason reason={perms.create ? null : NO_PERMISSION}>
              <Button variant="primary" disabled={!perms.create} onClick={() => setWizard({ open: true, editId: null })}><Plus className="h-4 w-4" aria-hidden />Create location</Button>
            </DisabledReason>
          </>
        }
      />
      <ZoneSummaryStrip
        zones={zones.data?.data ?? []}
        loading={zones.isPending}
        activeZoneId={activeZoneId}
        onToggle={(zoneId) => {
          if (activeZoneId !== undefined && activeZoneId === zoneId) g.grid.removeFilter("locationZoneId");
          else g.grid.upsertFilter(zoneId === null ? { field: "locationZoneId", op: "empty" } : { field: "locationZoneId", op: "in", values: [zoneId] });
        }}
      />
      <GridToolbar {...g.toolbarProps} onRefresh={refresh} searchPlaceholder="Search location code or barcode" bulkActions={bulkActions} bulkNoun="location" trailing={assignCapacity} />
      <DataGrid<LocationRow>
        {...g.gridProps}
        columns={LOCATION_COLUMNS}
        getRowId={(r) => r.id}
        rowActions={rowActions}
        emptyTitle={g.grid.query.filters.length || g.grid.query.q ? "No locations match these filters" : "No locations yet"}
        emptyDescription={g.grid.query.filters.length || g.grid.query.q ? "Clear a filter or search for another code." : "Create one, generate a whole aisle, or import from Excel."}
        emptyAction={perms.create ? <div className="flex gap-2"><Button onClick={() => setGenerator(true)}><Wand2 className="h-4 w-4" />Generate locations</Button><Button variant="primary" onClick={() => setWizard({ open: true, editId: null })}><Plus className="h-4 w-4" />Create location</Button></div> : undefined}
      />

      <LocationWizardDrawer open={wizard.open} editId={wizard.editId} defaultWarehouseId={zoneWarehouse ?? warehouses.defaultId}
        onOpenChange={(o) => setWizard((w) => ({ ...w, open: o }))}
        onSaved={(id) => { refresh(); if (!wizard.editId) router.prefetch(`/locations/${id}`); }} />
      <LocationGeneratorDrawer open={generator} onOpenChange={setGenerator} defaultWarehouseId={zoneWarehouse ?? warehouses.defaultId} onCreated={refresh} />
      {log ? <ChangeLogDrawer open onOpenChange={(o) => !o && setLog(null)} entityType="location" entityId={log.id} entityCode={log.code} /> : null}
      <PrintOptionsModal open={labels !== null} onOpenChange={(o) => !o && setLabels(null)} typeKeys={["location-label"]} records={labels ?? []} title="Print location labels" />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        variant="danger"
        title={`Delete ${toDelete?.length === 1 ? `location ${toDelete[0]?.code}` : `${toDelete?.length ?? 0} locations`}?`}
        description="Capacities are removed with the location. Locations holding stock or with open tasks are skipped."
        confirmLabel="Yes, delete"
        cancelLabel="No"
        records={{
          columns: [{ key: "code", label: "Location" }, { key: "warehouse", label: "Warehouse" }, { key: "area", label: "Area" }, { key: "status", label: "Inventory" }],
          rows: (toDelete ?? []).map((r) => ({ code: r.code, warehouse: r.warehouseCode, area: r.areaType ?? "—", status: <AvailabilityPill status={r.inventoryStatus} /> })),
        }}
        onConfirm={async () => {
          const ids = (toDelete ?? []).map((r) => r.id);
          const result = await action.run<BulkResponse>("/api/locations/bulk-delete", "POST", { ids });
          if (result) { toastBulk(result, "location", "deleted"); g.clearSelection(); }
          setToDelete(null);
        }}
      />
    </div>
  );
}

/** Used by tests: whether a bulk delete selection is fully blocked. */
export function allBlocked(rows: readonly Pick<LocationRow, "storedUnits" | "openTaskCount">[]): boolean {
  return rows.length > 0 && rows.every((r) => r.storedUnits > 0 || r.openTaskCount > 0);
}

