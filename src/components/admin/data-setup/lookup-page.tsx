"use client";

/**
 * One Data Setup lookup (`/settings/data-setup/<slug>`): H1, Create New …, grid (Name, Status,
 * type-specific columns, scope, Used by) and a create / edit drawer with the type's fields.
 * Values in use can't be deleted — the guard offers Deactivate instead.
 */
import * as React from "react";
import { History, Pencil, Plus, Power, PowerOff, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useFormState, useWatch } from "react-hook-form";
import { apiRequest, isApiError } from "@/lib/api-client";
import { applyServerFieldErrors, useApiQuery } from "@/lib/query-client";
import {
  CART_OPERATIONS, LOOKUP_FIELDS, LOOKUP_FORM_DEFAULTS, lookupFormSchema, lookupGridKey, lookupIssues, MERGE_CRITERIA, mergeCriteriaLabel,
  VAS_CALCULATION_TYPES, type LookupDef, type LookupFormValues,
} from "@/lib/grid-defs/admin/lookups";
import { DataGrid, DateCell, GridToolbar, useGrid, type BulkAction, type GridColumnDef, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Drawer } from "@/components/ui/drawer";
import { Form, FormField, FormGrid, SubmitBar, useZodForm } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import type { LookupGridRow } from "@/server/repositories/company-lookups";
import { EntityChangeLogDrawer, Muted, NO_PERMISSION, toastBulk, toFilterFields, useAction, useAdminOptions, usePagePerms, type BulkResponse } from "../admin-shared";
import { NumberField, SelectField, TextInput, YesNoField } from "../form-controls";
import { DataSetupShell } from "./data-setup-shell";

type F = LookupFormValues;

function typeColumns(def: LookupDef): GridColumnDef<LookupGridRow>[] {
  const m = (r: LookupGridRow) => r.meta ?? {};
  switch (def.type) {
    case "vas_type": return [{ id: "calc", header: "VAS calculation type", size: 170, cell: ({ row }) => (m(row.original).calculationType as string) ?? <Muted /> }];
    case "mobile_cart_type": return [
      { id: "levels", header: "Levels", size: 80, cell: ({ row }) => <span className="tabular-nums">{String(m(row.original).levels ?? "—")}</span> },
      { id: "columns", header: "Columns", size: 90, cell: ({ row }) => <span className="tabular-nums">{String(m(row.original).columns ?? "—")}</span> },
      { id: "cells", header: "Cells", size: 80, cell: ({ row }) => <span className="tabular-nums">{Number(m(row.original).levels ?? 0) * Number(m(row.original).columns ?? 0) || "—"}</span> },
      { id: "operation", header: "Operation", size: 130, cell: ({ row }) => (m(row.original).operation as string) ?? <Muted /> },
    ];
    case "order_merge_rule": return [{ id: "criteria", header: "Merge when", size: 320, cell: ({ row }) => {
      const keys = (m(row.original).criteria as string[] | undefined) ?? [];
      return keys.length ? <span className="flex flex-wrap gap-1">{keys.map((k) => <Badge key={k} tone="info" size="sm" shape="pill">{MERGE_CRITERIA.find((c) => c.key === k)?.label ?? k}</Badge>)}</span> : <Muted />;
    } }];
    case "damage_reason": return [{ id: "damaged", header: "Counts as damaged", size: 150, cell: ({ row }) => m(row.original).countsAsDamaged === false ? <Badge tone="neutral" size="sm" shape="pill">No</Badge> : <Badge tone="success" size="sm" shape="pill">Yes</Badge> }];
    case "custom_carrier": return [{ id: "code", header: "Code", size: 120, cell: ({ row }) => row.original.code ? <code className="font-mono text-[12px]">{row.original.code}</code> : <Muted /> }];
    default: return [];
  }
}

function columns(def: LookupDef, onEdit: (r: LookupGridRow) => void): GridColumnDef<LookupGridRow>[] {
  return [
    { id: "name", header: "Name", size: 240, meta: { alwaysVisible: true }, cell: ({ row }) => <button type="button" onClick={() => onEdit(row.original)} className="truncate text-left font-medium text-primary hover:underline">{row.original.name}</button> },
    { id: "status", header: "Status", size: 100, cell: ({ row }) => <StatusPill status={row.original.status} size="sm" /> },
    ...typeColumns(def),
    ...(def.scope === "warehouse" ? [{ id: "warehouseCode", header: "Warehouse", size: 110, cell: ({ row }: { row: { original: LookupGridRow } }) => row.original.warehouseCode ?? <Muted>All</Muted> } as GridColumnDef<LookupGridRow>] : []),
    ...(def.scope === "client" ? [{ id: "clientName", header: "Client", size: 180, cell: ({ row }: { row: { original: LookupGridRow } }) => row.original.clientName ?? <Muted>All clients</Muted> } as GridColumnDef<LookupGridRow>] : []),
    { id: "usageCount", header: "Used by", size: 100, meta: { align: "right", headerTip: "Records that use this value" }, cell: ({ row }) => <span className="block text-right tabular-nums">{row.original.usageCount.toLocaleString("en-US")}</span> },
    { id: "sortOrder", header: "Sort order", size: 100, meta: { defaultVisible: false, align: "right" }, cell: ({ row }) => <span className="block text-right tabular-nums">{row.original.sortOrder}</span> },
    { id: "updatedAt", header: "Updated", size: 172, cell: ({ row }) => <DateCell value={row.original.updatedAt} /> },
  ];
}

function toForm(r: LookupGridRow): F {
  const m = r.meta ?? {};
  return {
    name: r.name, code: r.code ?? "", isActive: r.isActive, warehouseId: r.warehouseId, clientId: r.clientId, sortOrder: r.sortOrder,
    calculationType: (m.calculationType as F["calculationType"]) ?? null, levels: (m.levels as number | undefined) ?? null, columns: (m.columns as number | undefined) ?? null,
    operation: (m.operation as F["operation"]) ?? null, criteria: (m.criteria as F["criteria"]) ?? [], countsAsDamaged: m.countsAsDamaged !== false,
  };
}

function Dirty({ control, onDirty }: { readonly control: ReturnType<typeof useZodForm<typeof lookupFormSchema>>["control"]; readonly onDirty: (d: boolean) => void }) {
  const { isDirty } = useFormState({ control });
  React.useEffect(() => onDirty(isDirty), [isDirty, onDirty]);
  return null;
}

function LookupForm({ def, row, onDone, onCancel, onDirty }: { readonly def: LookupDef; readonly row: LookupGridRow | null; readonly onDone: () => void; readonly onCancel: () => void; readonly onDirty: (d: boolean) => void }) {
  const options = useAdminOptions();
  const qc = useQueryClient();
  const schema = React.useMemo(() => lookupFormSchema.superRefine((v, ctx) => { for (const i of lookupIssues(def, v)) ctx.addIssue({ code: "custom", path: [i.path], message: i.message }); }), [def]);
  const initial: F = row ? toForm(row) : { ...LOOKUP_FORM_DEFAULTS, ...(def.type === "mobile_cart_type" ? { levels: 4, columns: 6, operation: "Pick and sort" } : {}), ...(def.type === "vas_type" ? { calculationType: "Total Price" } : {}) };
  const form = useZodForm(schema, initial);
  const [conflict, setConflict] = React.useState(false);
  const levels = useWatch({ control: form.control, name: "levels" });
  const cols = useWatch({ control: form.control, name: "columns" });
  const criteria = useWatch({ control: form.control, name: "criteria" }) ?? [];
  const submit = async (values: unknown) => {
    try {
      const body = { ...(values as object), version: row?.version };
      if (row) await apiRequest(`/api/company/lookups/${def.type}/${row.id}`, { method: "PATCH", body });
      else await apiRequest(`/api/company/lookups/${def.type}`, { method: "POST", body });
      await Promise.all([qc.invalidateQueries({ queryKey: ["grid", lookupGridKey(def.type)] }), qc.invalidateQueries({ queryKey: ["lookup-counts"] }), qc.invalidateQueries({ queryKey: ["lookups", def.type] })]);
      toast.success(row ? `${def.noun} updated` : `${def.noun} created`, `${(values as F).name} is ${((values as F).isActive ? "available now" : "saved as inactive")}.`);
      form.reset(values as F);
      onDone();
    } catch (error) {
      if (isApiError(error) && error.code === "CONFLICT") setConflict(true);
      applyServerFieldErrors(form, error);
      toast.error(`Couldn't save the ${def.noun.toLowerCase()}`, isApiError(error) ? error.message : "Something went wrong");
    }
  };
  return (
    <Form form={form} onSubmit={submit} className="flex flex-col gap-4">
      <Dirty control={form.control} onDirty={onDirty} />
      {conflict ? <Callout variant="attention" title="This value changed since you opened it" action={<Button size="sm" onClick={() => window.location.reload()}>Reload</Button>}>Reload to see the latest version.</Callout> : null}
      {row && row.usageCount > 0 ? <Callout variant="info" title={`Used by ${row.usageCount.toLocaleString("en-US")} records`}>Deactivate it to stop new use; existing records keep it.</Callout> : null}
      <TextInput<F> name="name" label={`${def.noun} name`} required maxLength={120} placeholder={`e.g. ${def.type === "so_cancel_reason" ? "Customer changed mind" : def.type === "vas_type" ? "Gift wrapping" : "New value"}`} />
      {def.hasCode ? <TextInput<F> name="code" label="Code" maxLength={60} transform={(v) => v.toUpperCase()} info="Short code printed on labels and manifests" /> : null}
      <FormGrid>
        <YesNoField<F> name="isActive" label="Active" info="Inactive values are hidden from dropdowns" />
        <NumberField<F> name="sortOrder" label="Sort order" min={0} max={100000} info="Lower numbers are listed first" />
      </FormGrid>
      {def.scope === "warehouse" ? <SelectField<F> name="warehouseId" label="Warehouse" required={def.scopeRequired} options={options.warehouses.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} disabled={Boolean(row && row.usageCount > 0)} info={row && row.usageCount > 0 ? "Locked while in use" : undefined} /> : null}
      {def.scope === "client" ? <SelectField<F> name="clientId" label="Client" clearable placeholder="All clients" options={options.clients.map((c) => ({ value: c.id, label: c.name }))} info="Leave empty to offer it for every client" /> : null}
      {def.type === "vas_type" ? <SelectField<F> name="calculationType" label="VAS calculation type" required options={VAS_CALCULATION_TYPES.map((v) => ({ value: v, label: v === "Vas Quantity" ? "VAS quantity" : v }))} info="Total price bills an entered amount; VAS quantity bills the rate × quantity" /> : null}
      {def.type === "mobile_cart_type" ? (
        <>
          <FormGrid columns={3}>
            <NumberField<F> name="levels" label="Levels" required min={1} max={20} nullable />
            <NumberField<F> name="columns" label="Columns" required min={1} max={30} nullable />
            <SelectField<F> name="operation" label="Operation" required options={CART_OPERATIONS.map((o) => ({ value: o, label: o }))} />
          </FormGrid>
          {levels && cols ? (
            <div className="rounded-lg border border-border bg-surface-sunken p-3">
              <p className="mb-2 text-[11px] text-faint">{levels} × {cols} = {levels * cols} cells</p>
              <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(cols, 30)}, minmax(0, 1fr))` }} aria-hidden>
                {Array.from({ length: Math.min(levels * cols, 600) }, (_, i) => <span key={i} className="flex h-5 items-center justify-center rounded bg-surface text-[8px] text-faint ring-1 ring-border">{String.fromCharCode(65 + Math.floor(i / cols))}{(i % cols) + 1}</span>)}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      {def.type === "order_merge_rule" ? (
        <FormField<F> name="criteria" label="Merge open orders when they share" required description={criteria.length ? `Rule: ${mergeCriteriaLabel(criteria)}` : "Pick one or more criteria."}>
          {(c) => (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-describedby={c["aria-describedby"]}>
              {MERGE_CRITERIA.map((opt) => {
                const value = (c.value as string[] | null) ?? [];
                const on = value.includes(opt.key);
                return (
                  <div key={opt.key} className={`rounded-lg border px-3 py-2 ${on ? "border-primary bg-primary-soft/40" : "border-border"}`}>
                    <Checkbox checked={on} onCheckedChange={() => c.onChange(on ? value.filter((k) => k !== opt.key) : [...value, opt.key])} label={opt.label} />
                  </div>
                );
              })}
            </div>
          )}
        </FormField>
      ) : null}
      {def.type === "damage_reason" ? <YesNoField<F> name="countsAsDamaged" label="Counts as damaged" info="Stock moved with this reason goes to the damaged bucket and is not allocatable" /> : null}
      <SubmitBar submitLabel={row ? "Save" : `Create ${def.noun.toLowerCase()}`} onCancel={onCancel} requireDirty={Boolean(row)} sticky />
    </Form>
  );
}

export function LookupPage({ def }: { readonly def: LookupDef }) {
  const perms = usePagePerms("settings.data_setup", ["view"] as const);
  const canEdit = perms.view;
  const options = useAdminOptions();
  const gridKey = lookupGridKey(def.type);
  const fields = React.useMemo(() => toFilterFields(LOOKUP_FIELDS.filter((f) => (f.field === "warehouseId" ? def.scope === "warehouse" : f.field === "clientId" ? def.scope === "client" : true)), {
    warehouseId: options.warehouses.map((w) => ({ value: w.id, label: w.code })), clientId: options.clients.map((c) => ({ value: c.id, label: c.name })),
  }), [def.scope, options.warehouses, options.clients]);
  const g = useGrid<LookupGridRow>({ gridKey, path: `/api/company/lookups/${def.type}`, fields });
  const [drawer, setDrawer] = React.useState<{ open: boolean; row: LookupGridRow | null }>({ open: false, row: null });
  const [dirty, setDirty] = React.useState(false);
  const [log, setLog] = React.useState<LookupGridRow | null>(null);
  const [toDelete, setToDelete] = React.useState<readonly LookupGridRow[] | null>(null);
  const [inUse, setInUse] = React.useState<readonly LookupGridRow[] | null>(null);
  const action = useAction([["grid", gridKey], ["lookup-counts"], ["lookups", def.type]]);
  const selected = (ids: readonly string[]) => g.rows.filter((r) => ids.includes(r.id));
  const edit = (row: LookupGridRow | null) => setDrawer({ open: true, row });
  const cols = React.useMemo(() => columns(def, edit), [def]);
  const setActive = async (rows: readonly LookupGridRow[], isActive: boolean) => {
    const result = await action.run<BulkResponse>(`/api/company/lookups/${def.type}/bulk-status`, "POST", { ids: rows.map((r) => r.id), isActive });
    if (result) { toastBulk(result, def.noun.toLowerCase(), isActive ? "activated" : "deactivated"); g.clearSelection(); }
  };
  const askDelete = (rows: readonly LookupGridRow[]) => {
    const used = rows.filter((r) => r.usageCount > 0);
    if (used.length === rows.length) setInUse(used);
    else setToDelete(rows);
  };
  const bulkActions: readonly BulkAction[] = [
    { key: "activate", label: "Activate", icon: Power, onSelect: (ids) => void setActive(selected(ids), true), disabledReason: canEdit ? null : NO_PERMISSION, eligibility: (ids) => selected(ids).every((r) => r.isActive) ? "Already active" : null },
    { key: "deactivate", label: "Deactivate", icon: PowerOff, onSelect: (ids) => void setActive(selected(ids), false), disabledReason: canEdit ? null : NO_PERMISSION, eligibility: (ids) => selected(ids).every((r) => !r.isActive) ? "Already inactive" : null },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: (ids) => askDelete(selected(ids)), disabledReason: canEdit ? null : NO_PERMISSION },
  ];
  const rowActions = (row: LookupGridRow): readonly RowAction[] => [
    { key: "edit", label: "Edit", icon: Pencil, onSelect: () => edit(row), disabledReason: canEdit ? null : NO_PERMISSION },
    row.isActive
      ? { key: "deactivate", label: "Deactivate", icon: PowerOff, onSelect: () => void setActive([row], false), disabledReason: canEdit ? null : NO_PERMISSION }
      : { key: "activate", label: "Activate", icon: Power, onSelect: () => void setActive([row], true), disabledReason: canEdit ? null : NO_PERMISSION },
    { key: "log", label: "Change log", icon: History, onSelect: () => setLog(row) },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: () => askDelete([row]), disabledReason: canEdit ? null : NO_PERMISSION },
  ];
  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  const close = () => { setDirty(false); setDrawer((d) => ({ ...d, open: false })); };
  return (
    <DataSetupShell>
      <PageHeader title={def.title} helper={def.description} crumbLabel={def.title}
        actions={<DisabledReason reason={canEdit ? null : NO_PERMISSION}><Button variant="primary" disabled={!canEdit} onClick={() => edit(null)}><Plus className="h-4 w-4" aria-hidden />Create new {def.noun.toLowerCase()}</Button></DisabledReason>} />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search by name" bulkActions={bulkActions} bulkNoun={def.noun.toLowerCase()} />
      <DataGrid<LookupGridRow>
        {...g.gridProps}
        columns={cols}
        getRowId={(r) => r.id}
        rowActions={rowActions}
        onRowClick={(r) => edit(r)}
        emptyTitle={filtered ? `No ${def.title.toLowerCase()} match these filters` : `No ${def.title.toLowerCase()} yet`}
        emptyDescription={filtered ? "Clear a filter or search for another name." : def.description}
        emptyAction={canEdit && !filtered ? <Button variant="primary" onClick={() => edit(null)}><Plus className="h-4 w-4" />Create new {def.noun.toLowerCase()}</Button> : undefined}
      />
      <Drawer open={drawer.open} onOpenChange={(o) => (o ? undefined : close())} dirty={dirty} width={35}
        title={drawer.row ? `Edit ${def.noun.toLowerCase()}` : `Create new ${def.noun.toLowerCase()}`} description={def.description}>
        {drawer.open ? <LookupForm key={drawer.row?.id ?? "new"} def={def} row={drawer.row} onDone={close} onCancel={close} onDirty={setDirty} /> : <Skeleton className="h-40 w-full" />}
      </Drawer>
      <EntityChangeLogDrawer open={log !== null} onOpenChange={(o) => !o && setLog(null)} path={log ? `/api/company/lookups/${def.type}/${log.id}/change-log` : null} title={`${def.noun} change log · ${log?.name ?? ""}`} />
      <ConfirmDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)} variant="danger"
        title={`Delete ${toDelete?.length === 1 ? `"${toDelete[0]?.name}"` : `${toDelete?.length ?? 0} values`}?`}
        description="Values still used by records are skipped — deactivate those instead." confirmLabel="Yes, delete" cancelLabel="No"
        records={{ columns: [{ key: "name", label: def.noun }, { key: "used", label: "Used by" }], rows: (toDelete ?? []).map((r) => ({ name: r.name, used: r.usageCount })) }}
        onConfirm={async () => {
          const result = await action.run<BulkResponse>(`/api/company/lookups/${def.type}/bulk-delete`, "POST", { ids: (toDelete ?? []).map((r) => r.id) });
          if (result) { toastBulk(result, def.noun.toLowerCase(), "deleted"); g.clearSelection(); }
          setToDelete(null);
        }} />
      <ConfirmDialog open={inUse !== null} onOpenChange={(o) => !o && setInUse(null)} variant="attention" icon={PowerOff}
        title={inUse?.length === 1 ? `"${inUse[0]?.name}" is in use` : `${inUse?.length ?? 0} values are in use`}
        description="Values used by records can't be deleted. Deactivate them to hide them from dropdowns; existing records keep them."
        confirmLabel="Deactivate instead" cancelLabel="Cancel"
        records={{ columns: [{ key: "name", label: def.noun }, { key: "used", label: "Used by" }], rows: (inUse ?? []).map((r) => ({ name: r.name, used: r.usageCount })) }}
        onConfirm={async () => { if (inUse) await setActive(inUse.filter((r) => r.isActive), false); setInUse(null); }} />
    </DataSetupShell>
  );
}
