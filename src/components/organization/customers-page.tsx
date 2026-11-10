"use client";

/**
 * Customers (`/organization/customers`): grid (Customer name, E-mail, Phone, Client, City,
 * Country, State, Active, Orders), filters Active / Client / Email / Full name (+ more),
 * Create / Edit drawer with the Addresses section (≥ 1 Shipping address), bulk Activate /
 * Deactivate / Delete, row ⋯ Edit · Change log · Activate/Deactivate · Delete.
 */
import * as React from "react";
import { CircleCheck, CircleOff, History, Pencil, Plus, Trash2 } from "lucide-react";
import { useWatch } from "react-hook-form";
import { DataGrid, GridToolbar, LinkCell, useGrid, type BulkAction, type GridColumnDef, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Form, FormGrid, FormSection, SubmitBar, useZodForm } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { apiRequest, isApiError } from "@/lib/api-client";
import { applyServerFieldErrors, useApiQuery } from "@/lib/query-client";
import { CUSTOMER_DEFAULTS, CUSTOMER_FIELDS, CUSTOMERS_GRID_KEY, customerSchema, type CustomerInput } from "@/lib/grid-defs/organization/customers";
import type { CustomerDetail, CustomerRow } from "@/server/repositories/customers";
import { EntityChangeLogDrawer, Muted, NO_PERMISSION, toastBulk, toFilterFields, useAction, useClientOptions, usePagePerms, type BulkResponse } from "@/components/facility/facility-shared";
import { ComboField, TextInput, YesNoField } from "@/components/facility/form-controls";
import { AddressesField } from "./addresses-editor";

type F = CustomerInput;
const PERMS = ["view", "create", "edit", "delete"] as const;
const hidden = { defaultVisible: false } as const;

const COLUMNS: GridColumnDef<CustomerRow>[] = [
  { id: "fullName", header: "Customer name", size: 200, meta: { alwaysVisible: true }, cell: ({ row }) => <span className="font-medium text-foreground">{row.original.fullName}</span> },
  { id: "email", header: "E-mail", size: 230, cell: ({ row }) => <a className="text-primary hover:underline" href={`mailto:${row.original.email}`} onClick={(e) => e.stopPropagation()}>{row.original.email}</a> },
  { id: "phone", header: "Phone", size: 140, cell: ({ row }) => <span className="tabular-nums">{row.original.phone}</span> },
  { id: "clientName", header: "Client", size: 170, cell: ({ row }) => <LinkCell href={`/clients/${row.original.clientId}`}>{row.original.clientName}</LinkCell> },
  { id: "city", header: "City", size: 140, cell: ({ row }) => row.original.city ?? <Muted /> },
  { id: "country", header: "Country", size: 150, cell: ({ row }) => row.original.country ?? <Muted /> },
  { id: "state", header: "State", size: 90, cell: ({ row }) => row.original.state ?? <Muted /> },
  { id: "isActive", header: "Is active", size: 100, cell: ({ row }) => <StatusPill status={row.original.isActive ? "Active" : "Inactive"} domain="active" /> },
  { id: "orderCount", header: "Orders", size: 90, meta: { align: "right" }, cell: ({ row }) => <div className="text-right tabular-nums">{row.original.orderCount || <span className="text-faint">0</span>}</div> },
  { id: "createdAt", header: "Created date", size: 130, meta: hidden, cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString("en-US") },
];

function toForm(d: CustomerDetail): F {
  return {
    firstName: d.firstName, lastName: d.lastName, email: d.email, phone: d.phone, clientId: d.clientId, isActive: d.isActive,
    addresses: d.addresses.map((a) => ({ id: a.id, name: a.name || a.usageType, usageType: a.usageType, companyName: a.companyName ?? "", line1: a.line1, line2: a.line2 ?? "", city: a.city, state: a.state ?? "", postalCode: a.postalCode, country: a.country, phone: a.phone ?? "", email: a.email ?? "", isDefault: a.isDefault, isActive: a.isActive })),
  };
}

function CustomerForm({ initial, detail, onDone, onCancel, onDirtyChange }: { readonly initial: F; readonly detail: CustomerDetail | null; readonly onDone: () => void; readonly onCancel: () => void; readonly onDirtyChange: (d: boolean) => void }) {
  const form = useZodForm(customerSchema, initial, { mode: "onSubmit" });
  const clients = useClientOptions();
  const [conflict, setConflict] = React.useState(false);
  const dirty = form.formState.isDirty;
  React.useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  const first = useWatch({ control: form.control, name: "firstName" });
  const last = useWatch({ control: form.control, name: "lastName" });
  const locked = detail && detail.orderCount > 0 ? `Locked: ${detail.orderCount} orders reference this customer` : undefined;
  const submit = async (values: unknown) => {
    try {
      await apiRequest(detail ? `/api/customers/${detail.id}` : "/api/customers", { method: detail ? "PATCH" : "POST", body: { ...(values as object), version: detail?.version } });
      toast.success("Success", detail ? `Customer ${first} ${last} updated.` : `Customer ${first} ${last} has been created successfully.`);
      onDone();
    } catch (error) {
      if (isApiError(error) && error.code === "CONFLICT") setConflict(true);
      applyServerFieldErrors(form, error);
      toast.error("Couldn't save the customer", isApiError(error) ? error.message : "Something went wrong");
      throw error;
    }
  };
  return (
    <Form form={form} onSubmit={submit} className="flex min-h-full flex-col gap-5">
      {conflict ? <Callout variant="attention" title="This record changed since you opened it" action={<Button size="sm" onClick={() => window.location.reload()}>Reload</Button>}>Someone else saved this customer. Reload to see their changes.</Callout> : null}
      <FormSection title="Customer">
        <FormGrid>
          <TextInput<F> name="firstName" label="First name" required maxLength={60} />
          <TextInput<F> name="lastName" label="Last name" required maxLength={60} />
          <TextInput<F> name="email" label="E-mail" required maxLength={200} placeholder="name@example.com" />
          <TextInput<F> name="phone" label="Phone" required maxLength={40} placeholder="(512) 555-0142" />
          <ComboField<F> name="clientId" label="Client" required options={clients} disabled={Boolean(locked)} info={locked} />
          <YesNoField<F> name="isActive" label="Active" />
        </FormGrid>
      </FormSection>
      <AddressesField requireShipping description="Add the customer's addresses. At least one Shipping address is required." />
      <SubmitBar sticky submitLabel={detail ? "Save" : "Create customer"} onCancel={onCancel} className="mt-auto" />
    </Form>
  );
}

function CustomerDrawer({ open, editId, onOpenChange, onSaved }: { readonly open: boolean; readonly editId: string | null; readonly onOpenChange: (o: boolean) => void; readonly onSaved: () => void }) {
  const [dirty, setDirty] = React.useState(false);
  const detail = useApiQuery<CustomerDetail>(["customer", editId ?? ""], open && editId ? `/api/customers/${editId}` : null, { staleTime: 0 });
  const close = () => { setDirty(false); onOpenChange(false); };
  const initial = editId ? (detail.data ? toForm(detail.data.data) : null) : CUSTOMER_DEFAULTS;
  return (
    <Drawer open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())} dirty={dirty} width={45}
      title={editId ? `Edit customer ${detail.data ? detail.data.data.fullName : ""}`.trim() : "Create customer"} description="Contact details, client and the addresses used on orders.">
      {editId && detail.isError ? <EmptyState title="Couldn't load this customer" description={detail.error.message} action={<Button onClick={() => void detail.refetch()}>Retry</Button>} />
        : !initial ? <div className="flex flex-col gap-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-64 w-full" /></div>
        : <CustomerForm key={`${editId ?? "new"}-${detail.dataUpdatedAt}`} initial={initial} detail={editId ? detail.data?.data ?? null : null} onDirtyChange={setDirty} onCancel={close} onDone={() => { setDirty(false); onSaved(); onOpenChange(false); }} />}
    </Drawer>
  );
}

type Pending = { readonly kind: "delete" | "activate" | "deactivate"; readonly rows: readonly CustomerRow[] } | null;

export function CustomersPage() {
  const perms = usePagePerms("settings.customers", PERMS);
  const clients = useClientOptions();
  const fields = React.useMemo(() => toFilterFields(CUSTOMER_FIELDS, { clientId: clients }), [clients]);
  const g = useGrid<CustomerRow>({ gridKey: CUSTOMERS_GRID_KEY, path: "/api/customers", fields });
  const [drawer, setDrawer] = React.useState<{ open: boolean; editId: string | null }>({ open: false, editId: null });
  const [log, setLog] = React.useState<CustomerRow | null>(null);
  const [pending, setPending] = React.useState<Pending>(null);
  const action = useAction([["grid", CUSTOMERS_GRID_KEY]]);
  const selected = (ids: readonly string[]) => g.rows.filter((r) => ids.includes(r.id));
  const bulkActions: readonly BulkAction[] = [
    { key: "activate", label: "Activate", icon: CircleCheck, onSelect: (ids) => setPending({ kind: "activate", rows: selected(ids) }), disabledReason: perms.edit ? null : NO_PERMISSION, eligibility: (ids) => (selected(ids).every((r) => r.isActive) ? "Every selected customer is already active" : null) },
    { key: "deactivate", label: "Deactivate", icon: CircleOff, onSelect: (ids) => setPending({ kind: "deactivate", rows: selected(ids) }), disabledReason: perms.edit ? null : NO_PERMISSION, eligibility: (ids) => (selected(ids).every((r) => !r.isActive) ? "Every selected customer is already inactive" : null) },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: (ids) => setPending({ kind: "delete", rows: selected(ids) }), disabledReason: perms.delete ? null : NO_PERMISSION, eligibility: (ids) => (selected(ids).every((r) => r.orderCount > 0) ? "Customers with orders can't be deleted; deactivate instead" : null) },
  ];
  const rowActions = (row: CustomerRow): readonly RowAction[] => [
    { key: "edit", label: "Edit", icon: Pencil, onSelect: () => setDrawer({ open: true, editId: row.id }), disabledReason: perms.edit ? null : NO_PERMISSION },
    { key: "log", label: "Change log", icon: History, onSelect: () => setLog(row) },
    row.isActive
      ? { key: "deactivate", label: "Deactivate", icon: CircleOff, onSelect: () => setPending({ kind: "deactivate", rows: [row] }), disabledReason: perms.edit ? null : NO_PERMISSION }
      : { key: "activate", label: "Activate", icon: CircleCheck, onSelect: () => setPending({ kind: "activate", rows: [row] }), disabledReason: perms.edit ? null : NO_PERMISSION },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: () => setPending({ kind: "delete", rows: [row] }), disabledReason: !perms.delete ? NO_PERMISSION : row.orderCount > 0 ? `${row.orderCount} orders reference this customer` : null },
  ];
  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  const verb = pending?.kind === "delete" ? "Delete" : pending?.kind === "activate" ? "Activate" : "Deactivate";
  const count = pending?.rows.length ?? 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Organization" tabs="organization" helper="Ship-to customers of your clients, with their shipping, billing and return addresses."
        actions={<DisabledReason reason={perms.create ? null : NO_PERMISSION}><Button variant="primary" disabled={!perms.create} onClick={() => setDrawer({ open: true, editId: null })}><Plus className="h-4 w-4" aria-hidden />Create customer</Button></DisabledReason>} />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search name, e-mail or phone" bulkActions={bulkActions} bulkNoun="customer" />
      <DataGrid<CustomerRow> {...g.gridProps} columns={COLUMNS} getRowId={(r) => r.id} rowActions={rowActions} onRowClick={(r) => perms.edit && setDrawer({ open: true, editId: r.id })}
        emptyTitle={filtered ? "No customers match these filters" : "No customers yet"}
        emptyDescription={filtered ? "Clear a filter or search for another name." : "Customers are created from orders and channel downloads, or add one here."}
        emptyAction={perms.create && !filtered ? <Button variant="primary" onClick={() => setDrawer({ open: true, editId: null })}><Plus className="h-4 w-4" />Create customer</Button> : undefined} />
      <CustomerDrawer open={drawer.open} editId={drawer.editId} onOpenChange={(o) => setDrawer((d) => ({ ...d, open: o }))} onSaved={() => g.refetch()} />
      <EntityChangeLogDrawer open={log !== null} onOpenChange={(o) => !o && setLog(null)} path={log ? `/api/customers/${log.id}/change-log` : null} title={`Change log · ${log?.fullName ?? ""}`} />
      <ConfirmDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)} variant={pending?.kind === "delete" ? "danger" : "attention"}
        title={`${verb} ${count === 1 ? pending?.rows[0]?.fullName : `${count} customers`}?`}
        description={pending?.kind === "delete" ? "Customers with orders are skipped; their addresses are removed with them." : pending?.kind === "deactivate" ? "Inactive customers can't be chosen on new orders." : "The customers can be chosen on new orders again."}
        confirmLabel={`Yes, ${verb.toLowerCase()}`} cancelLabel="No"
        records={{ columns: [{ key: "name", label: "Customer" }, { key: "client", label: "Client" }, { key: "orders", label: "Orders" }], rows: (pending?.rows ?? []).map((r) => ({ name: r.fullName, client: r.clientName, orders: r.orderCount })) }}
        onConfirm={async () => {
          if (!pending) return;
          const ids = pending.rows.map((r) => r.id);
          const result = pending.kind === "delete" ? await action.run<BulkResponse>("/api/customers/bulk-delete", "POST", { ids }) : await action.run<BulkResponse>("/api/customers/bulk-active", "POST", { ids, isActive: pending.kind === "activate" });
          if (result) { toastBulk(result, "customer", pending.kind === "delete" ? "deleted" : `${pending.kind}d`); g.clearSelection(); }
          setPending(null);
        }} />
    </div>
  );
}
