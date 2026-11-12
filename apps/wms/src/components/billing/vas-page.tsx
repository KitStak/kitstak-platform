"use client";

/**
 * VAS Operations (`/billing/vas`): grid, header Import (`/imports/vas-operations`) +
 * Create a VAS operation (drawer: calculation type follows the VAS type, note 0 / 200,
 * reference order type + number), bulk Delete, row ⋯ Show details · Edit · Change log · Delete. Operations
 * inside an approved bill's period are locked.
 */
import * as React from "react";
import { Eye, FileUp, History, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { useWatch } from "react-hook-form";
import { DataGrid, GridToolbar, LinkCell, useGrid, type BulkAction, type GridColumnDef, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Form, FormField, FormGrid, FormSection, SubmitBar, useZodForm } from "@/components/ui/form";
import { NumberInput } from "@/components/ui/number-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { DisabledReason, Tooltip } from "@/components/ui/tooltip";
import { useFrozenWhileDirty } from "@/components/organization/use-stable-form-key";
import { apiRequest, isApiError } from "@/lib/api-client";
import { applyServerFieldErrors, useApiQuery } from "@/lib/query-client";
import { VAS_REFERENCE_ORDER_TYPES } from "@/lib/enums";
import { VAS_FIELDS, VAS_FILTER_PRESET, VAS_GRID_KEY, VAS_NOTE_MAX, VAS_REFERENCE_MAX, vasSchema, type VasInput } from "@/lib/grid-defs/organization/vas";
import type { VasRow } from "@/server/repositories/vas";
import { EntityChangeLogDrawer, Muted, NO_PERMISSION, toastBulk, toFilterFields, useAction, useClientOptions, usePagePerms, useWarehouseOptions, type BulkResponse } from "@/components/facility/facility-shared";
import { withFilterPreset } from "@/components/organization/filter-preset";
import { permitted, permittedRowActions } from "@/components/organization/permitted";
import { ComboField, SelectField, TextInput } from "@/components/facility/form-controls";
import { KvList } from "@/components/shared/kv-list";
import { At, PickerLoadError, useActiveClients, useVasTypes } from "./billing-shared";
import { formatGridDateTime } from "@/lib/format";

type F = VasInput;
const PERMS = ["view", "create", "edit", "delete", "import_file"] as const;
const dt = (v: string) => formatGridDateTime(v);

const COLUMNS: GridColumnDef<VasRow>[] = [
  { id: "vasTypeName", header: "VAS type", size: 200, meta: { alwaysVisible: true }, cell: ({ row }) => <span className="inline-flex items-center gap-1.5 font-medium text-foreground">{row.original.billedIn ? <Tooltip content={`Billed in approved bill ${row.original.billedIn}`}><Lock className="h-3.5 w-3.5 text-faint" aria-label="Billed" /></Tooltip> : null}{row.original.vasTypeName}</span> },
  { id: "clientName", header: "Client", size: 160, cell: ({ row }) => <LinkCell href={`/clients/${row.original.clientId}`}>{row.original.clientName}</LinkCell> },
  { id: "warehouseCode", header: "Warehouse", size: 100, cell: ({ row }) => row.original.warehouseCode },
  { id: "operationAt", header: "Operation date", size: 170, cell: ({ row }) => <At value={row.original.operationAt} /> },
  { id: "calculationType", header: "Calculation type", size: 140, cell: ({ row }) => <Badge tone={row.original.calculationType === "Total Price" ? "warning" : "info"} shape="pill">{row.original.calculationType === "Vas Quantity" ? "VAS quantity" : "Total price"}</Badge> },
  { id: "value", header: "Value", size: 100, meta: { align: "right" }, cell: ({ row }) => <div className="text-right tabular-nums">{row.original.calculationType === "Total Price" ? `$${row.original.value.toFixed(2)}` : row.original.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}</div> },
  { id: "referenceOrderType", header: "Reference order type", size: 170, cell: ({ row }) => row.original.referenceOrderType ?? <Muted /> },
  { id: "referenceNumber", header: "Reference number", size: 150, cell: ({ row }) => (row.original.referenceNumber ? <span className="font-mono text-xs">{row.original.referenceNumber}</span> : <Muted />) },
  { id: "note", header: "Note", size: 240, enableSorting: false, cell: ({ row }) => (row.original.note ? <span className="text-secondary">{row.original.note}</span> : <Muted />) },
  { id: "createdByName", header: "Created by", size: 140, cell: ({ row }) => row.original.createdByName ?? <Muted /> },
  { id: "createdAt", header: "Created date", size: 150, meta: { defaultVisible: false }, cell: ({ row }) => <At value={row.original.createdAt} /> },
];

function VasForm({ initial, row, onDone, onCancel, onDirtyChange }: { readonly initial: F; readonly row: VasRow | null; readonly onDone: () => void; readonly onCancel: () => void; readonly onDirtyChange: (d: boolean) => void }) {
  const form = useZodForm(vasSchema, initial, { mode: "onSubmit" });
  const clients = useActiveClients();
  const warehouses = useWarehouseOptions();
  const vas = useVasTypes();
  const [conflict, setConflict] = React.useState(false);
  const dirty = form.formState.isDirty;
  React.useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  const clientId = useWatch({ control: form.control, name: "clientId" });
  const typeId = useWatch({ control: form.control, name: "vasTypeId" });
  const refNo = useWatch({ control: form.control, name: "referenceNumber" });
  const refType = useWatch({ control: form.control, name: "referenceOrderType" });
  React.useEffect(() => { if (!refType && refNo) form.setValue("referenceNumber", "", { shouldDirty: true }); }, [refType, refNo, form]);
  const types = vas.rows.filter((t) => t.isActive && (!t.clientId || t.clientId === clientId));
  const type = vas.rows.find((t) => t.id === typeId);
  const isPrice = type?.calculationType === "Total Price";
  const unit = type ? (/hour/i.test(type.name) ? "hours" : isPrice ? "USD" : "units") : undefined;
  const submit = async (values: unknown) => {
    try {
      const saved = await apiRequest<{ outdatedBills?: readonly string[] }>(row ? `/api/vas-operations/${row.id}` : "/api/vas-operations", { method: row ? "PATCH" : "POST", body: { ...(values as object), version: row?.version } });
      toast.success("Success", row ? "VAS operation updated." : "VAS operation has been created successfully.");
      const stale = saved.data?.outdatedBills ?? [];
      if (stale.length) toast.warning("Draft bill outdated", `This operation falls inside draft bill ${stale.join(", ")}. Recalculate it to include the change.`);
      onDone();
    } catch (error) {
      if (isApiError(error) && error.code === "CONFLICT") setConflict(true);
      applyServerFieldErrors(form, error);
      toast.error("Couldn't save the VAS operation", isApiError(error) ? error.message : "Something went wrong");
      throw error;
    }
  };
  return (
    <Form form={form} onSubmit={submit} className="flex min-h-full flex-col gap-5">
      {conflict ? <Callout variant="attention" title="This record changed since you opened it" action={<Button size="sm" onClick={() => window.location.reload()}>Reload</Button>}>Reload to see the latest values.</Callout> : null}
      {row?.billedIn ? <Callout variant="attention" title={`Billed in approved bill ${row.billedIn}`}>Cancel that bill&rsquo;s approval before changing this operation.</Callout> : null}
      {!row?.billedIn && row?.draftIn ? <Callout variant="info" title={`Inside draft bill ${row.draftIn}`}>Saving or deleting this operation marks that draft as outdated; recalculate it before approving.</Callout> : null}
      <FormSection title="Operation">
        <FormGrid>
          <div className="flex flex-col">
            <ComboField<F> name="clientId" label="Client" required options={clients.options} placeholder={clients.placeholder} emptyText={clients.emptyText} onValueChange={() => form.setValue("vasTypeId", "", { shouldDirty: true })} />
            {clients.error ? <PickerLoadError message={clients.error} onRetry={clients.retry} retrying={clients.retrying} /> : null}
          </div>
          <ComboField<F> name="warehouseId" label="Warehouse" required options={warehouses.options} />
          <ComboField<F> name="vasTypeId" label="VAS type" required options={types.map((t) => ({ value: t.id, label: t.name }))} placeholder={vas.loading ? "Loading VAS types…" : undefined} emptyText={vas.loading ? "Loading VAS types…" : clientId ? "No VAS types for this client (Data Setup › VAS Type)" : "Choose a client first"} />
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-secondary">Calculation type</span>
            <div className="flex h-8 items-center">{type ? <Badge tone={isPrice ? "warning" : "info"} shape="pill">{isPrice ? "Total price" : "VAS quantity"}</Badge> : <span className="text-xs text-faint">Set by the VAS type</span>}</div>
            <span className="text-2xs text-faint">{type ? (isPrice ? "Value is billed as a price" : "Value × the fee's rate") : "From Data Setup › VAS Type"}</span>
          </div>
          <FormField<F> name="operationAt" label="Operation date" required>
            {(c) => <DateTimePicker id={c.id} value={c.value ? new Date(c.value as string) : null} onChange={(d) => c.onChange(d ? d.toISOString() : "")} onBlur={c.onBlur} invalid={c.invalid} aria-label="Operation date" />}
          </FormField>
          <FormField<F> name="value" label={isPrice ? "Operation price" : "Operation value"} required>
            {(c) => <NumberInput id={c.id} value={(c.value as number | null) ?? null} onChange={c.onChange} onBlur={c.onBlur} invalid={c.invalid} min={0} decimals={2} suffix={unit} aria-label="Operation value" />}
          </FormField>
        </FormGrid>
      </FormSection>
      <FormSection title="Reference">
        <FormGrid>
          <SelectField<F> name="referenceOrderType" label="Reference order type" required={Boolean(refNo)} clearable options={VAS_REFERENCE_ORDER_TYPES.map((t) => ({ value: t, label: t }))} />
          <TextInput<F> name="referenceNumber" label="Reference number" required={Boolean(refType)} disabled={!refType} maxLength={VAS_REFERENCE_MAX} showCount placeholder={refType ? "e.g. SO000123" : "Choose a reference order type first"} />
        </FormGrid>
      </FormSection>
      <FormSection title="Note">
        <FormField<F> name="note">
          {(c) => <Textarea id={c.id} name={c.name} value={(c.value as string | null) ?? ""} onChange={(e) => c.onChange(e.target.value)} onBlur={c.onBlur} maxLength={VAS_NOTE_MAX} rows={3} placeholder="e.g. Re-labeled 240 cases for Target routing guide" aria-label="Note" />}
        </FormField>
      </FormSection>
      <SubmitBar sticky submitLabel={row ? "Save" : "Create"} onCancel={onCancel} className="mt-auto" />
    </Form>
  );
}

function VasDrawer({ open, editId, onOpenChange, onSaved, defaultWarehouseId }: { readonly open: boolean; readonly editId: string | null; readonly onOpenChange: (o: boolean) => void; readonly onSaved: () => void; readonly defaultWarehouseId: string | null }) {
  const [dirty, setDirty] = React.useState(false);
  const detail = useApiQuery<VasRow>(["vas-operation", editId ?? ""], open && editId ? `/api/vas-operations/${editId}` : null, { staleTime: 0 });
  const close = () => { setDirty(false); onOpenChange(false); };
  const snap = useFrozenWhileDirty({ key: `${editId ?? "new"}-${detail.dataUpdatedAt}`, data: detail.data?.data }, dirty);
  const d = snap.data;
  const initial: F | null = editId
    ? (d ? { clientId: d.clientId, warehouseId: d.warehouseId, vasTypeId: d.vasTypeId, operationAt: d.operationAt, value: d.value, note: d.note ?? "", referenceOrderType: d.referenceOrderType, referenceNumber: d.referenceNumber ?? "" } : null)
    : { clientId: "", warehouseId: defaultWarehouseId ?? "", vasTypeId: "", operationAt: new Date().toISOString(), value: 1, note: "", referenceOrderType: null, referenceNumber: "" };
  return (
    <Drawer open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())} dirty={dirty} width={45}
      title={editId ? "Edit VAS operation" : "Create a VAS operation"} description="Log value-added work so the next calculation bills it under the client's VAS fee.">
      {editId && detail.isError ? <EmptyState title="Couldn't load this VAS operation" description={detail.error.message} action={<Button onClick={() => void detail.refetch()}>Retry</Button>} />
        : !initial ? <div className="flex flex-col gap-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-64 w-full" /></div>
        : <VasForm key={snap.key} initial={initial} row={editId ? d ?? null : null} onDirtyChange={setDirty} onCancel={close} onDone={() => { setDirty(false); onSaved(); onOpenChange(false); }} />}
    </Drawer>
  );
}

/** Read-only Show details (Logiwa row menu: Show Details · Edit · Delete). */
function VasDetailsDrawer({ row, onOpenChange, onEdit, editReason }: { readonly row: VasRow | null; readonly onOpenChange: (o: boolean) => void; readonly onEdit: () => void; readonly editReason: string | null }) {
  return (
    <Drawer open={row !== null} onOpenChange={onOpenChange} width={35} title={row ? row.vasTypeName : "VAS operation"} description={row ? `${row.clientName} · ${row.warehouseCode}` : undefined}
      footer={row ? (
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
          <DisabledReason reason={editReason}><Button variant="primary" disabled={Boolean(editReason)} onClick={onEdit}><Pencil className="h-4 w-4" />Edit</Button></DisabledReason>
        </div>
      ) : undefined}>
      {row ? (
        <div className="flex flex-col gap-4">
          {row.billedIn ? <Callout variant="attention" title={`Billed in approved bill ${row.billedIn}`}>Locked: cancel that bill&rsquo;s approval to change this operation.</Callout> : null}
          <KvList columns={2} items={[
            { key: "type", label: "VAS type", value: row.vasTypeName },
            { key: "calc", label: "Calculation type", value: <Badge tone={row.calculationType === "Total Price" ? "warning" : "info"} shape="pill">{row.calculationType === "Vas Quantity" ? "VAS quantity" : "Total price"}</Badge> },
            { key: "client", label: "Client", value: <LinkCell href={`/clients/${row.clientId}`}>{row.clientName}</LinkCell> },
            { key: "wh", label: "Warehouse", value: row.warehouseCode },
            { key: "at", label: "Operation date", value: <At value={row.operationAt} /> },
            { key: "value", label: row.calculationType === "Total Price" ? "Operation price" : "Operation value", value: <span className="tabular-nums">{row.calculationType === "Total Price" ? `${row.value.toFixed(2)}` : row.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span> },
            { key: "rt", label: "Reference order type", value: row.referenceOrderType },
            { key: "rn", label: "Reference number", value: row.referenceNumber ? <span className="font-mono text-xs">{row.referenceNumber}</span> : null },
            { key: "note", label: "Note", value: row.note, full: true },
            { key: "by", label: "Created by", value: row.createdByName },
            { key: "created", label: "Created date", value: <At value={row.createdAt} /> },
          ]} />
        </div>
      ) : null}
    </Drawer>
  );
}

export function VasPage() {
  const perms = usePagePerms("settings.vas_operations", PERMS);
  const warehouses = useWarehouseOptions();
  const clients = useClientOptions();
  const vas = useVasTypes();
  const vasOptions = React.useMemo(() => vas.rows.map((t) => ({ value: t.id, label: t.name })), [vas.rows]);
  const creatorsQ = useApiQuery<{ id: string; name: string }[]>(["vas-creators"], "/api/vas-operations/creators", { staleTime: 60_000 });
  const creatorOptions = React.useMemo(() => (Array.isArray(creatorsQ.data?.data) ? creatorsQ.data.data : []).map((u) => ({ value: u.id, label: u.name })), [creatorsQ.data]);
  const fields = React.useMemo(() => withFilterPreset(toFilterFields(VAS_FIELDS, { warehouseId: warehouses.short, clientId: clients, vasTypeId: vasOptions, createdBy: creatorOptions }), VAS_FILTER_PRESET), [warehouses.short, clients, vasOptions, creatorOptions]);
  const g = useGrid<VasRow>({ gridKey: VAS_GRID_KEY, path: "/api/vas-operations", fields });
  const [drawer, setDrawer] = React.useState<{ open: boolean; editId: string | null }>({ open: false, editId: null });
  const [log, setLog] = React.useState<VasRow | null>(null);
  const [details, setDetails] = React.useState<VasRow | null>(null);
  const [toDelete, setToDelete] = React.useState<readonly VasRow[] | null>(null);
  const action = useAction([["grid", VAS_GRID_KEY]]);
  const selected = (ids: readonly string[]) => g.rows.filter((r) => ids.includes(r.id));
  const lockReason = (r: VasRow) => (r.billedIn ? `Billed in approved bill ${r.billedIn}` : null);
  const bulkActions: readonly BulkAction[] = [
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: (ids) => setToDelete(selected(ids)), disabledReason: perms.delete ? null : NO_PERMISSION,
      eligibility: (ids) => (selected(ids).every((r) => r.billedIn) ? "Operations in approved bills can't be deleted" : null) },
  ];
  const rowActions = (row: VasRow): readonly RowAction[] => [
    { key: "details", label: "Show details", icon: Eye, onSelect: () => setDetails(row) },
    { key: "edit", label: "Edit", icon: Pencil, onSelect: () => setDrawer({ open: true, editId: row.id }), disabledReason: !perms.edit ? NO_PERMISSION : lockReason(row) },
    { key: "log", label: "Change log", icon: History, onSelect: () => setLog(row) },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: () => setToDelete([row]), disabledReason: !perms.delete ? NO_PERMISSION : lockReason(row) },
  ];
  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="VAS Operations" tabs="billing" helper="Value-added services performed for clients (kitting labor, relabeling, special packing) billed through VAS fees."
        actions={
          <div className="flex items-center gap-2">
            <DisabledReason reason={perms.import_file ? null : NO_PERMISSION}><Button disabled={!perms.import_file} onClick={() => { window.location.href = "/imports/vas-operations"; }}><FileUp className="h-4 w-4" aria-hidden />Import</Button></DisabledReason>
            {perms.create ? <Button variant="primary" onClick={() => setDrawer({ open: true, editId: null })}><Plus className="h-4 w-4" aria-hidden />Create a VAS operation</Button> : null}
          </div>
        } />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search VAS type, reference or note" bulkActions={permitted(bulkActions)} bulkNoun="VAS operation" />
      <DataGrid<VasRow> {...g.gridProps} columns={COLUMNS} getRowId={(r) => r.id} rowActions={permittedRowActions(rowActions)} onRowClick={(r) => setDetails(r)}
        emptyTitle={filtered ? "No VAS operations match these filters" : "No VAS operations yet"}
        emptyDescription={filtered ? "Clear a filter or search for another reference." : "Log value-added work here or import it from Excel."}
        emptyAction={perms.create && !filtered ? <Button variant="primary" onClick={() => setDrawer({ open: true, editId: null })}><Plus className="h-4 w-4" />Create a VAS operation</Button> : undefined} />
      <VasDetailsDrawer row={details} onOpenChange={(o) => !o && setDetails(null)} editReason={!details ? null : !perms.edit ? NO_PERMISSION : lockReason(details)} onEdit={() => { if (details) setDrawer({ open: true, editId: details.id }); setDetails(null); }} />
      <VasDrawer open={drawer.open} editId={drawer.editId} defaultWarehouseId={warehouses.defaultId} onOpenChange={(o) => setDrawer((d) => ({ ...d, open: o }))} onSaved={() => g.refetch()} />
      <EntityChangeLogDrawer open={log !== null} onOpenChange={(o) => !o && setLog(null)} path={log ? `/api/vas-operations/${log.id}/change-log` : null} title={`Change log · ${log?.vasTypeName ?? ""}`} />
      <ConfirmDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)} variant="danger"
        title={`Delete ${toDelete?.length === 1 ? "this VAS operation" : `${toDelete?.length ?? 0} VAS operations`}?`} description="Operations inside approved bills are skipped." confirmLabel="Yes, delete" cancelLabel="No"
        records={{ columns: [{ key: "t", label: "VAS type" }, { key: "c", label: "Client" }, { key: "d", label: "Date" }, { key: "v", label: "Value" }], rows: (toDelete ?? []).map((r) => ({ t: r.vasTypeName, c: r.clientName, d: dt(r.operationAt), v: r.value })) }}
        onConfirm={async () => {
          const result = await action.run<BulkResponse>("/api/vas-operations/bulk-delete", "POST", { ids: (toDelete ?? []).map((r) => r.id) });
          if (result) { toastBulk(result, "VAS operation", "deleted"); g.clearSelection(); }
          setToDelete(null);
        }} />
    </div>
  );
}
