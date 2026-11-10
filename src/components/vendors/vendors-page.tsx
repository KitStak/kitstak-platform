"use client";

/**
 * Vendors list — one component mounted at `/receiving/vendors` (tab group "receiving")
 * and `/organization/vendors` (tab group "organization"). Display name opens the
 * vendor drawer; row menu: Edit / Change log / Deactivate (blocked with open POs) / Activate.
 */
import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban, CheckCircle2, History, Pencil, Plus, Truck } from "lucide-react";
import { DataGrid, GridToolbar, useGrid, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { ChangeLogDrawer } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { apiRequest } from "@/lib/api-client";
import { subdivisionName } from "@/lib/countries";
import { VENDOR_GRID_FIELDS, VENDORS_GRID_KEY } from "@/lib/grid-defs/receiving/vendors";
import { errorMessage, useFilterFields, useInvalidateReceiving, type VendorRow, useCan } from "@/components/receiving/receiving-shared";
import { VendorDrawer } from "./vendor-drawer";

export const VENDOR_HELPER = "Vendors are the companies that supply your clients' products. Each vendor belongs to one client and appears on its purchase orders.";
export const OPEN_PO_DEACTIVATE_REASON = "This vendor has open purchase orders. Complete or cancel them before deactivating.";

const dash = <span className="text-faint">—</span>;

function buildColumns(openVendor: (row: VendorRow) => void): ColumnDef<VendorRow, unknown>[] {
  return [
    {
      id: "displayName", accessorKey: "displayName", header: "Display name", size: 220, minSize: 160, meta: { alwaysVisible: true },
      cell: ({ row }) => (
        <button type="button" onClick={(e) => { e.stopPropagation(); openVendor(row.original); }} className="truncate rounded text-left font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
          {row.original.displayName}
        </button>
      ),
    },
    { id: "vendorName", accessorKey: "vendorName", header: "Vendor name", size: 240, cell: ({ getValue }) => <span className="truncate">{String(getValue())}</span> },
    { id: "clientName", accessorKey: "clientName", header: "Client", size: 180, cell: ({ getValue }) => <span className="truncate">{String(getValue() ?? "")}</span> },
    {
      id: "location", header: "Ships from", size: 180, enableSorting: false,
      cell: ({ row }) => (row.original.city || row.original.state ? <span className="truncate">{[row.original.city, row.original.state ? subdivisionName("US", row.original.state) || row.original.state : null].filter(Boolean).join(", ")}</span> : dash),
    },
    {
      id: "openPoCount", accessorKey: "openPoCount", header: "Open POs", size: 110, meta: { align: "right", headerTip: "Pending or Started purchase orders for this vendor." },
      cell: ({ getValue }) => <span className={(getValue() as number) > 0 ? "font-semibold tabular-nums text-foreground" : "tabular-nums text-faint"}>{String(getValue())}</span>,
    },
    {
      id: "isActive", accessorKey: "isActive", header: "Active", size: 100, meta: { clip: false },
      cell: ({ getValue }) => (getValue() ? <Badge tone="success" size="sm">Yes</Badge> : <Badge tone="neutral" size="sm">No</Badge>),
    },
  ];
}

export function VendorsPage({ tabs }: { readonly tabs: "receiving" | "organization" }) {
  const invalidate = useInvalidateReceiving();
  const fields = useFilterFields(VENDOR_GRID_FIELDS);
  const g = useGrid<VendorRow>({ gridKey: VENDORS_GRID_KEY, path: "/api/vendors", fields });
  const can = { create: useCan("settings.vendors.create").allowed, edit: useCan("settings.vendors.edit").allowed, log: useCan("settings.vendors.change_log").allowed };
  const [drawer, setDrawer] = React.useState<{ id: string | null } | null>(null);
  const [logFor, setLogFor] = React.useState<VendorRow | null>(null);
  const [toggle, setToggle] = React.useState<VendorRow | null>(null);
  const columns = React.useMemo(() => buildColumns((row) => setDrawer({ id: row.id })), []);

  const setActive = async (row: VendorRow) => {
    try {
      await apiRequest(`/api/vendors/${row.id}/active`, { method: "POST", body: { active: !row.isActive, version: row.version } });
      toast.success("Success", `${row.displayName} ${row.isActive ? "deactivated" : "activated"}.`);
    } catch (error) {
      toast.error("Error", errorMessage(error));
    } finally {
      await invalidate();
    }
  };

  const rowActions = (row: VendorRow): readonly RowAction[] => [
    ...(can.edit ? [{ key: "edit", label: "Edit", icon: Pencil, onSelect: () => setDrawer({ id: row.id }) }] : []),
    ...(can.log ? [{ key: "log", label: "Change log", icon: History, onSelect: () => setLogFor(row) }] : []),
    ...(can.edit
      ? [row.isActive
          ? { key: "deactivate", label: "Deactivate", icon: Ban, destructive: true, disabledReason: row.openPoCount > 0 ? OPEN_PO_DEACTIVATE_REASON : null, onSelect: () => setToggle(row) }
          : { key: "activate", label: "Activate", icon: CheckCircle2, onSelect: () => setToggle(row) }]
      : []),
  ];

  const createButton = can.create ? (
    <Button variant="primary" onClick={() => setDrawer({ id: null })}>
      <Plus className="h-3.5 w-3.5" aria-hidden />
      Create vendor
    </Button>
  ) : undefined;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      {/* Always pass an element: permissions resolve on the client, and a null here makes SSR drop the actions slot (hydration mismatch). */}
      <PageHeader title={tabs === "receiving" ? "Purchase Order" : "Organization"} tabs={tabs} helper={VENDOR_HELPER} actions={<>{createButton}</>} />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search by vendor or display name" bulkNoun="vendor" />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<VendorRow>
          {...g.gridProps}
          columns={columns}
          getRowId={(row) => row.id}
          rowActions={rowActions}
          selectable={false}
          onRowClick={can.edit ? (row) => setDrawer({ id: row.id }) : undefined}
          emptyTitle="No vendors match this view"
          emptyDescription="Clear the filters, or add the companies that supply your clients."
          emptyAction={createButton}
        />
      </div>
      <VendorDrawer open={drawer !== null} onOpenChange={(open) => !open && setDrawer(null)} vendorId={drawer?.id ?? null} />
      {logFor ? <ChangeLogDrawer open onOpenChange={(open) => !open && setLogFor(null)} entityType="vendor" entityId={logFor.id} entityCode={logFor.displayName} /> : null}
      <ConfirmDialog
        open={toggle !== null}
        onOpenChange={(open) => !open && setToggle(null)}
        variant={toggle?.isActive ? "danger" : "info"}
        icon={toggle?.isActive ? Ban : Truck}
        title={toggle?.isActive ? `Deactivate ${toggle?.displayName ?? "vendor"}?` : `Activate ${toggle?.displayName ?? "vendor"}?`}
        description={toggle?.isActive ? "Inactive vendors can't be chosen on new purchase orders. Existing orders keep them." : "The vendor can be chosen on purchase orders again."}
        records={toggle ? { columns: [{ key: "name", label: "Display name" }, { key: "client", label: "Client" }, { key: "open", label: "Open POs" }], rows: [{ name: toggle.displayName, client: toggle.clientName, open: String(toggle.openPoCount) }] } : undefined}
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={() => (toggle ? setActive(toggle) : undefined)}
      />
    </div>
  );
}
