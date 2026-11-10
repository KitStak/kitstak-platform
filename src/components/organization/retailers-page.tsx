"use client";

/**
 * Retailers (`/organization/retailers`, BETA): company-wide big-box retailers for B2B
 * labeling. Grid (Name, Logo, Country, Address, Status, Case labels, Orders), bulk Delete
 * (blocked while orders reference the retailer), row ⋯ Edit · Change log · Delete, and the
 * 3-step Create / Edit drawer: General (logo upload + address) · Advanced (case-label
 * switch, print quantities, documents) · Other info (custom fields).
 */
import * as React from "react";
import { FileText, History, ImageUp, Pencil, Plus, Settings2, Store, Trash2, X } from "lucide-react";
import { useController, useFormContext, useWatch, type UseFormReturn } from "react-hook-form";
import { DataGrid, GridToolbar, useGrid, type BulkAction, type GridColumnDef, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { FormField, FormGrid, FormSection } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { Combobox } from "@/components/ui/combobox";
import { Wizard, type WizardStep } from "@/components/ui/wizard";
import { apiRequest, isApiError } from "@/lib/api-client";
import { applyServerFieldErrors, useApiQuery } from "@/lib/query-client";
import { countryOptions, subdivisionsFor } from "@/lib/countries";
import { RETAILER_DEFAULTS, RETAILER_FIELDS, RETAILERS_GRID_KEY, retailerAdvancedSchema, retailerGeneralSchema, retailerOtherSchema, type RetailerInput } from "@/lib/grid-defs/organization/retailers";
import type { RetailerDetail, RetailerDocument, RetailerRow } from "@/server/repositories/retailers";
import { CustomFieldsSection, type CustomFieldValues } from "@/components/shared/custom-fields-section";
import { ATTACHMENT_ACCEPT, MAX_UPLOAD_BYTES, uploadFile } from "@/components/shared/upload-file";
import { EntityChangeLogDrawer, Muted, NO_PERMISSION, toastBulk, toFilterFields, useAction, usePagePerms, type BulkResponse } from "@/components/facility/facility-shared";
import { NumberField, TextInput, YesNoField } from "@/components/facility/form-controls";

type F = RetailerInput;
const PERMS = ["view", "create", "edit", "delete"] as const;
const COUNTRY_OPTIONS = countryOptions();
const IMAGE_ACCEPT = ["image/png", "image/jpeg", "image/gif", "image/webp", ".png", ".jpg", ".jpeg", ".gif", ".webp"];
const fileUrl = (id: string) => `/api/files/${id}?inline=1`;

function Logo({ fileId, name, size = 28 }: { readonly fileId: string | null; readonly name: string; readonly size?: number }) {
  const [broken, setBroken] = React.useState(false);
  if (!fileId || broken) {
    return <span className="inline-flex items-center justify-center rounded-md bg-primary-soft text-[11px] font-bold uppercase text-primary" style={{ width: size, height: size }} aria-hidden>{name.slice(0, 2)}</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element -- authenticated file route, not a static asset
  return <img src={fileUrl(fileId)} alt={`${name} logo`} width={size} height={size} onError={() => setBroken(true)} className="rounded-md border border-border bg-surface object-contain" style={{ width: size, height: size }} />;
}

const COLUMNS: GridColumnDef<RetailerRow>[] = [
  { id: "name", header: "Name", size: 210, meta: { alwaysVisible: true }, cell: ({ row }) => <span className="font-medium text-foreground">{row.original.name}</span> },
  { id: "logo", header: "Logo", size: 70, enableSorting: false, cell: ({ row }) => <Logo fileId={row.original.logoFileId} name={row.original.name} /> },
  { id: "businessName", header: "Business name", size: 200, cell: ({ row }) => row.original.businessName ?? <Muted /> },
  { id: "country", header: "Country", size: 140, cell: ({ row }) => row.original.country ?? <Muted /> },
  { id: "address", header: "Address", size: 320, enableSorting: false, cell: ({ row }) => (row.original.address ? <span className="text-secondary">{row.original.address}</span> : <Muted />) },
  { id: "isActive", header: "Status", size: 100, cell: ({ row }) => <StatusPill status={row.original.isActive ? "Active" : "Inactive"} domain="active" /> },
  { id: "createCaseLabels", header: "Case labels", size: 110, cell: ({ row }) => (row.original.createCaseLabels ? <Badge tone="success" shape="pill">On · ×{row.original.caseLabelPrintQty}</Badge> : <span className="text-faint">Off</span>) },
  { id: "orderCount", header: "Orders", size: 90, meta: { align: "right" }, cell: ({ row }) => <div className="text-right tabular-nums">{row.original.orderCount || <span className="text-faint">0</span>}</div> },
  { id: "createdAt", header: "Created date", size: 130, meta: { defaultVisible: false }, cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString("en-US") },
];

function LogoField() {
  const { field } = useController<F, "logoFileId">({ name: "logoFileId" });
  const name = useWatch<F, "name">({ name: "name" }) || "Retailer";
  const [busy, setBusy] = React.useState(false);
  const onFiles = async (files: readonly File[]) => {
    const file = files[0];
    if (!file) return;
    setBusy(true);
    try {
      field.onChange(await uploadFile(file, "attachment"));
    } catch (error) {
      toast.error("Logo upload failed", isApiError(error) ? error.message : "Try a PNG or JPG under 10 MB");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-4">
      <Logo key={field.value ?? "none"} fileId={field.value ?? null} name={name} size={64} />
      <div className="flex-1">
        <FileDropzone accept={IMAGE_ACCEPT} maxSizeBytes={MAX_UPLOAD_BYTES} maxFiles={1} disabled={busy} title={busy ? "Uploading…" : "Upload retailer logo"} hint="PNG, JPG, GIF or WebP up to 10 MB" onFiles={(f) => void onFiles(f)} />
      </div>
      {field.value ? <Button size="sm" variant="ghost" onClick={() => field.onChange(null)}><X className="h-4 w-4" />Remove</Button> : null}
    </div>
  );
}

function GeneralStep() {
  const { control, setValue } = useFormContext<F>();
  const country = useWatch({ control, name: "country" });
  const subs = subdivisionsFor(country);
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="General">
        <FormGrid>
          <TextInput<F> name="name" label="Name" required maxLength={100} placeholder="e.g. Target" />
          <TextInput<F> name="businessName" label="Business name" maxLength={150} placeholder="e.g. Target Corporation" />
          <TextInput<F> name="description" label="Description" maxLength={250} showCount />
          <YesNoField<F> name="isActive" label="Status" info="Inactive retailers can't be chosen on new orders" />
        </FormGrid>
      </FormSection>
      <FormSection title="Retailer logo" description="Printed on case and LP labels for this retailer."><LogoField /></FormSection>
      <FormSection title="Address">
        <FormGrid>
          <TextInput<F> name="line1" label="Address line 1" maxLength={256} />
          <TextInput<F> name="line2" label="Address line 2" maxLength={256} />
          <TextInput<F> name="postalCode" label="Postal code" maxLength={20} />
          <TextInput<F> name="city" label="City" maxLength={100} />
          <FormField<F> name="country" label="Country" required>
            {(c) => <Combobox id={c.id} aria-label="Country" options={COUNTRY_OPTIONS} value={(c.value as string | null) ?? null} invalid={c.invalid} onBlur={c.onBlur} onChange={(v) => { c.onChange(v ?? ""); setValue("state", "", { shouldDirty: true }); }} />}
          </FormField>
          <FormField<F> name="state" label={country === "CA" ? "Province" : "State"} disabled={!country}>
            {(c) => subs.length > 0
              ? <Combobox id={c.id} aria-label="State" options={subs.map((s) => ({ value: s.code, label: s.name }))} value={(c.value as string | null) || null} invalid={c.invalid} onBlur={c.onBlur} onChange={(v) => c.onChange(v ?? "")} disabled={c.disabled} clearable />
              : <input disabled className="h-8 rounded-md border border-border bg-surface-sunken px-2 text-[13px] text-faint" placeholder="Not applicable" aria-label="State" />}
          </FormField>
          <TextInput<F> name="email" label="Email" maxLength={200} />
          <TextInput<F> name="phone" label="Phone number" maxLength={40} />
        </FormGrid>
      </FormSection>
    </div>
  );
}

function DocumentsField({ initial }: { readonly initial: readonly RetailerDocument[] }) {
  const { field } = useController<F, "documentFileIds">({ name: "documentFileIds" });
  const [known, setKnown] = React.useState<readonly RetailerDocument[]>(initial);
  const [busy, setBusy] = React.useState(false);
  const ids = (field.value ?? []) as string[];
  const onFiles = async (files: readonly File[]) => {
    setBusy(true);
    try {
      const added: RetailerDocument[] = [];
      for (const file of files) added.push({ fileId: await uploadFile(file, "attachment"), name: file.name, size: file.size, mime: file.type });
      setKnown((k) => [...k, ...added]);
      field.onChange([...ids, ...added.map((a) => a.fileId)]);
      toast.success("Uploaded", `${added.length} document${added.length === 1 ? "" : "s"} added. Save to keep them.`);
    } catch (error) {
      toast.error("Upload failed", isApiError(error) ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };
  const docs = ids.map((id) => known.find((d) => d.fileId === id) ?? { fileId: id, name: "Document", size: 0, mime: "" });
  return (
    <div className="flex flex-col gap-2">
      <FileDropzone multiple accept={ATTACHMENT_ACCEPT} maxSizeBytes={MAX_UPLOAD_BYTES} maxFiles={20} disabled={busy} title={busy ? "Uploading…" : "Upload document"} hint="PDF or image, up to 10 MB each (routing guides, label specs)" onFiles={(f) => void onFiles(f)} />
      {docs.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {docs.map((d) => (
            <li key={d.fileId} className="flex items-center gap-2 px-3 py-2 text-[13px]">
              <FileText className="h-4 w-4 text-secondary" aria-hidden />
              <a href={fileUrl(d.fileId)} target="_blank" rel="noreferrer" className="flex-1 truncate text-primary hover:underline">{d.name}</a>
              {d.size ? <span className="text-[12px] text-faint">{Math.max(1, Math.round(d.size / 1024))} KB</span> : null}
              <Button size="icon-sm" variant="ghost" aria-label={`Remove ${d.name}`} onClick={() => field.onChange(ids.filter((x) => x !== d.fileId))}><X className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function AdvancedStep({ docs }: { readonly docs: readonly RetailerDocument[] }) {
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Label generation">
        <FormField<F> name="createCaseLabels">
          {(c) => <Switch id={c.id} checked={Boolean(c.value)} onCheckedChange={(v) => c.onChange(v)} label="Create case labels for single item LPs / parent LPs" description="Prints a retailer case label for every LP that holds a single item, at packing and shipment-plan loading." />}
        </FormField>
      </FormSection>
      <FormSection title="Label print settings">
        <FormGrid>
          <NumberField<F> name="caseLabelPrintQty" label="Case label print quantity" required min={1} max={99} />
          <NumberField<F> name="lpLabelPrintQty" label="LP label print quantity" required min={1} max={99} />
        </FormGrid>
      </FormSection>
      <FormSection title="Documents" description="You can upload and download documents for the retailer as needed."><DocumentsField initial={docs} /></FormSection>
    </div>
  );
}

function OtherStep({ form }: { readonly form: UseFormReturn<F> }) {
  const values = useWatch({ control: form.control, name: "customFields" }) as CustomFieldValues | undefined;
  return <CustomFieldsSection entityType="retailer" values={values ?? {}} onChange={(v) => form.setValue("customFields", v as F["customFields"], { shouldDirty: true })} />;
}

function toForm(d: RetailerDetail): F {
  return {
    name: d.name, description: d.description ?? "", isActive: d.isActive, businessName: d.businessName ?? "", logoFileId: d.logoFileId, line1: d.line1 ?? "", line2: d.line2 ?? "",
    postalCode: d.postalCode ?? "", city: d.city ?? "", country: d.countryCode, state: d.state ?? "", email: d.email ?? "", phone: d.phone ?? "",
    createCaseLabels: d.createCaseLabels, caseLabelPrintQty: d.caseLabelPrintQty, lpLabelPrintQty: d.lpLabelPrintQty, documentFileIds: d.documents.map((x) => x.fileId), customFields: d.customFields as F["customFields"],
  };
}

function Body({ initial, detail, onDone, onCancel, onDirtyChange }: { readonly initial: F; readonly detail: RetailerDetail | null; readonly onDone: () => void; readonly onCancel: () => void; readonly onDirtyChange: (d: boolean) => void }) {
  const formRef = React.useRef<UseFormReturn<F> | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const editId = detail?.id ?? null;
  const docs = React.useMemo(() => detail?.documents ?? [], [detail]);
  const steps = React.useMemo<readonly WizardStep<F>[]>(() => [
    { key: "general", label: "General", icon: Store, schema: retailerGeneralSchema, render: ({ form }) => { formRef.current = form; return <GeneralStep />; } },
    { key: "advanced", label: "Advanced", icon: Settings2, schema: retailerAdvancedSchema, render: ({ form }) => { formRef.current = form; return <AdvancedStep docs={docs} />; } },
    { key: "other", label: "Other info", icon: FileText, schema: retailerOtherSchema, isOptional: true, render: ({ form }) => { formRef.current = form; return <OtherStep form={form} />; } },
  ], [docs]);
  const submit = async (values: F) => {
    try {
      const { data } = await apiRequest<{ name: string }>(editId ? `/api/retailers/${editId}` : "/api/retailers", { method: editId ? "PATCH" : "POST", body: { ...values, version: detail?.version } });
      toast.success("Success", editId ? `Retailer ${data.name} updated.` : "Retailer has been created successfully.");
      onDone();
    } catch (error) {
      if (isApiError(error) && error.code === "CONFLICT") setConflict(true);
      if (formRef.current) applyServerFieldErrors(formRef.current, error);
      toast.error("Couldn't save the retailer", isApiError(error) ? error.message : "Something went wrong");
      throw error;
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {conflict ? <Callout variant="attention" title="This record changed since you opened it" action={<Button size="sm" onClick={() => window.location.reload()}>Reload</Button>}>Someone else saved this retailer. Reload to see their changes.</Callout> : null}
      <Wizard<F> steps={steps} variant="drawer" mode={editId ? "free" : "linear"} defaultValues={initial} draftScope={false} guardUnsaved={false} onDirtyChange={onDirtyChange} submitLabel={editId ? "Save" : "Create"} onCancel={onCancel} onComplete={submit} />
    </div>
  );
}

function RetailerDrawer({ open, editId, onOpenChange, onSaved }: { readonly open: boolean; readonly editId: string | null; readonly onOpenChange: (o: boolean) => void; readonly onSaved: () => void }) {
  const [dirty, setDirty] = React.useState(false);
  const detail = useApiQuery<RetailerDetail>(["retailer", editId ?? ""], open && editId ? `/api/retailers/${editId}` : null, { staleTime: 0 });
  const close = () => { setDirty(false); onOpenChange(false); };
  const initial = editId ? (detail.data ? toForm(detail.data.data) : null) : RETAILER_DEFAULTS;
  return (
    <Drawer open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())} dirty={dirty} width={60}
      title={editId ? `Edit retailer ${detail.data?.data.name ?? ""}`.trim() : "Create retailer"} description="General and address, label settings and documents, then custom fields.">
      {editId && detail.isError ? <EmptyState title="Couldn't load this retailer" description={detail.error.message} action={<Button onClick={() => void detail.refetch()}>Retry</Button>} />
        : !initial ? <div className="flex flex-col gap-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-64 w-full" /></div>
        : <Body key={`${editId ?? "new"}-${detail.dataUpdatedAt}`} initial={initial} detail={editId ? detail.data?.data ?? null : null} onDirtyChange={setDirty} onCancel={close} onDone={() => { setDirty(false); onSaved(); onOpenChange(false); }} />}
    </Drawer>
  );
}

export function RetailersPage() {
  const perms = usePagePerms("settings.retailers", PERMS);
  const fields = React.useMemo(() => toFilterFields(RETAILER_FIELDS), []);
  const g = useGrid<RetailerRow>({ gridKey: RETAILERS_GRID_KEY, path: "/api/retailers", fields });
  const [drawer, setDrawer] = React.useState<{ open: boolean; editId: string | null }>({ open: false, editId: null });
  const [log, setLog] = React.useState<RetailerRow | null>(null);
  const [toDelete, setToDelete] = React.useState<readonly RetailerRow[] | null>(null);
  const action = useAction([["grid", RETAILERS_GRID_KEY]]);
  const selected = (ids: readonly string[]) => g.rows.filter((r) => ids.includes(r.id));
  const bulkActions: readonly BulkAction[] = [
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: (ids) => setToDelete(selected(ids)), disabledReason: perms.delete ? null : NO_PERMISSION,
      eligibility: (ids) => (selected(ids).every((r) => r.orderCount > 0) ? "Retailers used on shipment orders can't be deleted" : null) },
  ];
  const rowActions = (row: RetailerRow): readonly RowAction[] => [
    { key: "edit", label: "Edit", icon: Pencil, onSelect: () => setDrawer({ open: true, editId: row.id }), disabledReason: perms.edit ? null : NO_PERMISSION },
    { key: "log", label: "Change log", icon: History, onSelect: () => setLog(row) },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: () => setToDelete([row]), disabledReason: !perms.delete ? NO_PERMISSION : row.orderCount > 0 ? `Used by ${row.orderCount} shipment orders` : null },
  ];
  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Organization" tabs="organization" helper="Big-box retailers you ship B2B for: logos, case-label rules and routing documents."
        actions={<DisabledReason reason={perms.create ? null : NO_PERMISSION}><Button variant="primary" disabled={!perms.create} onClick={() => setDrawer({ open: true, editId: null })}><Plus className="h-4 w-4" aria-hidden />Create retailer</Button></DisabledReason>} />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search retailer or business name" bulkActions={bulkActions} bulkNoun="retailer" />
      <DataGrid<RetailerRow> {...g.gridProps} columns={COLUMNS} getRowId={(r) => r.id} rowActions={rowActions} onRowClick={(r) => perms.edit && setDrawer({ open: true, editId: r.id })}
        emptyTitle={filtered ? "No retailers match these filters" : "No retailers yet"}
        emptyDescription={filtered ? "Clear a filter or search for another name." : "Add the retailers you ship to with their label requirements."}
        emptyAction={perms.create && !filtered ? <Button variant="primary" onClick={() => setDrawer({ open: true, editId: null })}><ImageUp className="h-4 w-4" />Create retailer</Button> : undefined} />
      <RetailerDrawer open={drawer.open} editId={drawer.editId} onOpenChange={(o) => setDrawer((d) => ({ ...d, open: o }))} onSaved={() => g.refetch()} />
      <EntityChangeLogDrawer open={log !== null} onOpenChange={(o) => !o && setLog(null)} path={log ? `/api/retailers/${log.id}/change-log` : null} title={`Change log · ${log?.name ?? ""}`} />
      <ConfirmDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)} variant="danger"
        title={`Delete ${toDelete?.length === 1 ? `retailer ${toDelete[0]?.name}` : `${toDelete?.length ?? 0} retailers`}?`}
        description="Retailers used on shipment orders are skipped." confirmLabel="Yes, delete" cancelLabel="No"
        records={{ columns: [{ key: "name", label: "Retailer" }, { key: "country", label: "Country" }, { key: "orders", label: "Orders" }], rows: (toDelete ?? []).map((r) => ({ name: r.name, country: r.country ?? "", orders: r.orderCount })) }}
        onConfirm={async () => {
          const result = await action.run<BulkResponse>("/api/retailers/bulk-delete", "POST", { ids: (toDelete ?? []).map((r) => r.id) });
          if (result) { toastBulk(result, "retailer", "deleted"); g.clearSelection(); }
          setToDelete(null);
        }} />
    </div>
  );
}
