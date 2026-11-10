"use client";

/**
 * Clients (`/clients`, Organization tabs): grid (Client, Official name, Full name, Tax ID,
 * Status, # Products, # Open orders …), header Bulk Import/Update ▾ + Create Client
 * (4-step wizard), bulk Activate / Deactivate / Delete (guarded), row ⋯ Show details ·
 * Edit · Change log · Activate/Deactivate · Delete.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, CircleCheck, CircleOff, Eye, FileUp, History, Pencil, Plus, Trash2 } from "lucide-react";
import { DataGrid, GridToolbar, LinkCell, useGrid, type BulkAction, type GridColumnDef, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StatusPill } from "@/components/ui/status-pill";
import { DisabledReason } from "@/components/ui/tooltip";
import { CLIENT_FIELDS, CLIENTS_GRID_KEY } from "@/lib/grid-defs/organization/clients";
import type { ClientListRow } from "@/server/repositories/clients";
import { EntityChangeLogDrawer, Muted, NO_PERMISSION, toastBulk, toFilterFields, useAction, usePagePerms, type BulkResponse } from "@/components/facility/facility-shared";
import { ClientWizardDrawer } from "./client-wizard";

const PERMS = ["view", "create", "edit", "delete", "change_log", "import_file"] as const;
const hidden = { defaultVisible: false } as const;
const num = (v: number, href?: string) => <div className="text-right tabular-nums">{href && v > 0 ? <LinkCell href={href}>{v.toLocaleString("en-US")}</LinkCell> : v > 0 ? v.toLocaleString("en-US") : <span className="text-faint">0</span>}</div>;

const COLUMNS: GridColumnDef<ClientListRow>[] = [
  { id: "name", header: "Client", size: 200, meta: { alwaysVisible: true }, cell: ({ row }) => <LinkCell href={`/clients/${row.original.id}`}>{row.original.name}</LinkCell> },
  { id: "code", header: "Code", size: 110, cell: ({ row }) => <code className="font-mono text-[12px] text-secondary">{row.original.code}</code> },
  { id: "officialName", header: "Official name", size: 240, cell: ({ row }) => row.original.officialName ?? <Muted /> },
  { id: "fullName", header: "Full name", size: 280, enableSorting: false, cell: ({ row }) => <span className="text-secondary">{row.original.fullName}</span> },
  { id: "taxId", header: "Tax ID", size: 130, cell: ({ row }) => (row.original.taxId ? <span className="tabular-nums">{row.original.taxId}</span> : <Muted />) },
  { id: "status", header: "Status", size: 110, cell: ({ row }) => <StatusPill status={row.original.status} domain="active" /> },
  { id: "productCount", header: "# Products", size: 110, meta: { align: "right" }, cell: ({ row }) => num(row.original.productCount, `/products?f.clientId=in:${row.original.id}`) },
  { id: "openOrders", header: "# Open orders", size: 120, meta: { align: "right" }, cell: ({ row }) => num(row.original.openOrders, `/orders?f.clientId=in:${row.original.id}`) },
  { id: "currency", header: "Currency", size: 100, cell: ({ row }) => row.original.currency },
  { id: "contactName", header: "Contact", size: 170, meta: hidden, enableSorting: false, cell: ({ row }) => row.original.contactName || <Muted /> },
  { id: "contactEmail", header: "Contact email", size: 210, meta: hidden, enableSorting: false, cell: ({ row }) => row.original.contactEmail || <Muted /> },
  { id: "createdAt", header: "Created date", size: 130, meta: hidden, cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString("en-US") },
];

type Pending = { readonly kind: "delete" | "Active" | "Inactive"; readonly rows: readonly ClientListRow[] } | null;

export function ClientsPage() {
  const router = useRouter();
  const perms = usePagePerms("settings.clients", PERMS);
  const fields = React.useMemo(() => toFilterFields(CLIENT_FIELDS), []);
  const g = useGrid<ClientListRow>({ gridKey: CLIENTS_GRID_KEY, path: "/api/clients", fields });
  const [wizard, setWizard] = React.useState<{ open: boolean; editId: string | null }>({ open: false, editId: null });
  const [log, setLog] = React.useState<ClientListRow | null>(null);
  const [pending, setPending] = React.useState<Pending>(null);
  const action = useAction([["grid", CLIENTS_GRID_KEY], ["me"]]);
  const selected = (ids: readonly string[]) => g.rows.filter((r) => ids.includes(r.id));
  const deleteReason = (row: ClientListRow) => (!perms.delete ? NO_PERMISSION : row.productCount > 0 || row.totalOrders > 0 ? "Clients with products or orders can't be deleted; deactivate instead" : null);

  const bulkActions: readonly BulkAction[] = [
    { key: "activate", label: "Activate", icon: CircleCheck, onSelect: (ids) => setPending({ kind: "Active", rows: selected(ids) }), disabledReason: perms.edit ? null : NO_PERMISSION,
      eligibility: (ids) => (selected(ids).every((r) => r.status === "Active") ? "Every selected client is already active" : null) },
    { key: "deactivate", label: "Deactivate", icon: CircleOff, onSelect: (ids) => setPending({ kind: "Inactive", rows: selected(ids) }), disabledReason: perms.edit ? null : NO_PERMISSION,
      eligibility: (ids) => (selected(ids).every((r) => r.status === "Inactive") ? "Every selected client is already inactive" : null) },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: (ids) => setPending({ kind: "delete", rows: selected(ids) }), disabledReason: perms.delete ? null : NO_PERMISSION,
      eligibility: (ids) => (selected(ids).every((r) => r.productCount > 0 || r.totalOrders > 0) ? "Clients with products or orders can't be deleted; deactivate instead" : null) },
  ];
  const rowActions = (row: ClientListRow): readonly RowAction[] => [
    { key: "details", label: "Show details", icon: Eye, href: `/clients/${row.id}` },
    { key: "edit", label: "Edit", icon: Pencil, onSelect: () => setWizard({ open: true, editId: row.id }), disabledReason: perms.edit ? null : NO_PERMISSION },
    { key: "log", label: "Change log", icon: History, onSelect: () => setLog(row), disabledReason: perms.change_log || perms.view ? null : NO_PERMISSION },
    row.status === "Active"
      ? { key: "deactivate", label: "Deactivate", icon: CircleOff, onSelect: () => setPending({ kind: "Inactive", rows: [row] }), disabledReason: !perms.edit ? NO_PERMISSION : row.openOrders > 0 ? `${row.openOrders} open orders` : null }
      : { key: "activate", label: "Activate", icon: CircleCheck, onSelect: () => setPending({ kind: "Active", rows: [row] }), disabledReason: perms.edit ? null : NO_PERMISSION },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: () => setPending({ kind: "delete", rows: [row] }), disabledReason: deleteReason(row) },
  ];
  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  const count = pending?.rows.length ?? 0;
  const one = pending?.rows[0];
  const verb = pending?.kind === "delete" ? "Delete" : pending?.kind === "Active" ? "Activate" : "Deactivate";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Organization" tabs="organization" helper="Define your clients (the brands you fulfill for) and set up their preferences."
        actions={
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DisabledReason reason={perms.import_file ? null : NO_PERMISSION}>
                <DropdownMenuTrigger asChild><Button disabled={!perms.import_file}><FileUp className="h-4 w-4" aria-hidden />Bulk import/update<ChevronDown className="h-3.5 w-3.5" aria-hidden /></Button></DropdownMenuTrigger>
              </DisabledReason>
              <DropdownMenuContent align="end">
                <DropdownMenuItem icon={FileUp} href="/imports/clients" description="Create or update clients from an Excel file">Import clients</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DisabledReason reason={perms.create ? null : NO_PERMISSION}><Button variant="primary" disabled={!perms.create} onClick={() => setWizard({ open: true, editId: null })}><Plus className="h-4 w-4" aria-hidden />Create client</Button></DisabledReason>
          </div>
        } />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search client, code, official name or tax ID" bulkActions={bulkActions} bulkNoun="client" />
      <DataGrid<ClientListRow>
        {...g.gridProps}
        columns={COLUMNS}
        getRowId={(r) => r.id}
        rowActions={rowActions}
        onRowClick={(r) => router.push(`/clients/${r.id}`)}
        emptyTitle={filtered ? "No clients match these filters" : "No clients yet"}
        emptyDescription={filtered ? "Clear a filter or search for another name." : "Create the first brand you fulfill for, then add its products."}
        emptyAction={perms.create && !filtered ? <Button variant="primary" onClick={() => setWizard({ open: true, editId: null })}><Plus className="h-4 w-4" />Create client</Button> : undefined}
      />
      <ClientWizardDrawer open={wizard.open} editId={wizard.editId} onOpenChange={(o) => setWizard((w) => ({ ...w, open: o }))}
        onSaved={(id) => { g.refetch(); if (!wizard.editId && id) router.push(`/clients/${id}`); }} />
      <EntityChangeLogDrawer open={log !== null} onOpenChange={(o) => !o && setLog(null)} path={log ? `/api/clients/${log.id}/change-log` : null} title={`Change log · ${log?.name ?? ""}`} />
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        variant={pending?.kind === "delete" ? "danger" : pending?.kind === "Inactive" ? "attention" : "info"}
        title={`${verb} ${count === 1 ? one?.name : `${count} clients`}?`}
        description={pending?.kind === "delete" ? "Clients with products, orders, POs, stock or billing forms are skipped." : pending?.kind === "Inactive" ? "Inactive clients disappear from order, PO and billing client selects. Clients with open orders are skipped." : "The clients become selectable on new orders, POs and billing forms again."}
        confirmLabel={`Yes, ${verb.toLowerCase()}`}
        cancelLabel="No"
        records={{ columns: [{ key: "name", label: "Client" }, { key: "status", label: "Status" }, { key: "orders", label: "Open orders" }], rows: (pending?.rows ?? []).map((r) => ({ name: r.name, status: r.status, orders: r.openOrders })) }}
        onConfirm={async () => {
          if (!pending) return;
          const ids = pending.rows.map((r) => r.id);
          const result = pending.kind === "delete"
            ? await action.run<BulkResponse>("/api/clients/bulk-delete", "POST", { ids })
            : await action.run<BulkResponse>("/api/clients/bulk-status", "POST", { ids, status: pending.kind });
          if (result) { toastBulk(result, "client", pending.kind === "delete" ? "deleted" : pending.kind === "Active" ? "activated" : "deactivated"); g.clearSelection(); }
          setPending(null);
        }}
      />
    </div>
  );
}
