"use client";

/**
 * Create / Edit Shipment Package drawer, 4 steps (Logiwa parity, with inline errors):
 * 1. General (warehouse, code, dimensions, weights, currency, price, active) ·
 * 2. Client access (All clients, or Select manually with a grid and Enable/Disable bulk) ·
 * 3. Inventory tracking (owner, packaging SKU, reduction rule and location) · 4. Other info.
 */
import * as React from "react";
import { Box, Boxes, FileText, Users } from "lucide-react";
import { useController, type UseFormReturn } from "react-hook-form";
import { apiRequest, isApiError } from "@/lib/api-client";
import { applyServerFieldErrors, useApiQuery } from "@/lib/query-client";
import { CURRENCIES, DIMENSION_UNITS, PACKAGE_REDUCTION_RULES, VOLUME_UNITS, WEIGHT_UNITS } from "@/lib/enums";
import { boxVolume as boxVolumeIn, ERROR_TOAST_MS } from "@/lib/grid-defs/facility/common";
import { useAvailabilityCheck, useWizardGuard, type WizardGuard } from "@/components/facility/wizard-guard";
import { packageAccessSchema, packageGeneralSchema, packageTrackingSchema, PACKAGE_CREATED_MESSAGE, PACKAGE_TRACKING_METHOD_LABELS, SHIPMENT_PACKAGE_DEFAULTS, type ShipmentPackageInput } from "@/lib/grid-defs/facility/shipment-packages";
import { CustomFieldsSection, type CustomFieldValues } from "@/components/shared/custom-fields-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField, FormGrid, FormSection } from "@/components/ui/form";
import { RadioCards } from "@/components/ui/radio-cards";
import { Skeleton } from "@/components/ui/skeleton";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { Wizard, type WizardStep } from "@/components/ui/wizard";
import { ComboField, enumSelectOptions, NumberField, SelectField, TextInput, YesNoField } from "@/components/facility/form-controls";
import { useClientOptions, usePagePerms, useWarehouseOptions, apiErrorMessage } from "@/components/facility/facility-shared";
import { ProductPicker } from "@/components/facility/pickers";
import { useWarehouseLocationOptions } from "@/components/facility/pickers";
import type { ShipmentPackageDetail } from "@/server/repositories/shipment-packages";

type F = ShipmentPackageInput;

const GENERAL_KEYS: ReadonlySet<string> = new Set(["warehouseId", "code", "description", "weightUnit", "emptyWeight", "maxWeight", "dimensionUnit", "length", "width", "height", "volumeUnit", "maxVolume", "currency", "purchasePrice", "isActive"]);
const ACCESS_KEYS: ReadonlySet<string> = new Set(["allClients", "clientAccess"]);
const TRACKING_KEYS: ReadonlySet<string> = new Set(["trackInventory", "trackingMethod", "inventoryClientId", "inventoryProductId", "reductionRule", "reductionLocationId"]);
const rootKey = (p: string) => p.split(".")[0] ?? p;

function GeneralStep({ form, editId, guard }: { readonly form: UseFormReturn<F>; readonly editId: string | null; readonly guard: WizardGuard }) {
  const isEdit = Boolean(editId);
  const warehouses = useWarehouseOptions();
  useAvailabilityCheck<F>(guard, form, {
    url: "/api/shipment-packages/availability",
    paths: ["code"],
    params: (v) => (v.warehouseId && v.code?.trim() ? { warehouseId: v.warehouseId, code: v.code.trim(), excludeId: editId ?? undefined } : null),
  });
  const dim = form.watch("dimensionUnit");
  const weight = form.watch("weightUnit");
  const volumeUnit = form.watch("volumeUnit");
  const vol = boxVolumeIn(Number(form.watch("length")) || 0, Number(form.watch("width")) || 0, Number(form.watch("height")) || 0, dim, volumeUnit) ?? 0;
  const volLabel = vol >= 100 ? Math.round(vol).toLocaleString("en-US") : vol.toFixed(2);
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Identity">
        <FormGrid>
          <ComboField<F> name="warehouseId" label="Warehouse" required options={warehouses.selectable(form.watch("warehouseId"))} disabled={isEdit} info={isEdit ? "A package can't move between warehouses" : undefined} />
          <TextInput<F> name="code" label="Code" required maxLength={40} transform={(v) => v.toUpperCase()} placeholder="e.g. 12X10X8" />
          <TextInput<F> name="description" label="Description" maxLength={250} placeholder="e.g. 12 × 10 × 8 branded mailer box" className="md:col-span-2" />
        </FormGrid>
      </FormSection>
      <FormSection title="Dimensions" description="Envelopes and poly mailers can use a height of 0.01.">
        <FormGrid columns={4}>
          <SelectField<F> name="dimensionUnit" label="Dimension unit" required options={enumSelectOptions(DIMENSION_UNITS)} />
          <NumberField<F> name="length" label="Length" required decimals={2} suffix={dim} />
          <NumberField<F> name="width" label="Width" required decimals={2} suffix={dim} />
          <NumberField<F> name="height" label="Height" required decimals={2} suffix={dim} />
        </FormGrid>
      </FormSection>
      <FormSection title="Weight and volume">
        <FormGrid columns={3}>
          <SelectField<F> name="weightUnit" label="Weight unit" required options={enumSelectOptions(WEIGHT_UNITS)} />
          <NumberField<F> name="emptyWeight" label="Empty weight" decimals={2} suffix={weight} />
          <NumberField<F> name="maxWeight" label="Max weight" decimals={2} suffix={weight} nullable info="Leave empty for no limit" />
          <SelectField<F> name="volumeUnit" label="Volume unit" options={enumSelectOptions(VOLUME_UNITS)} />
          <NumberField<F> name="maxVolume" label="Max volume" decimals={3} nullable info={vol > 0 ? `Can't exceed the box volume: ${volLabel} ${volumeUnit}` : "Leave empty for no limit"} />
        </FormGrid>
      </FormSection>
      <FormSection title="Cost and status">
        <FormGrid columns={3}>
          <SelectField<F> name="currency" label="Currency" required options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          <NumberField<F> name="purchasePrice" label="Purchase price" decimals={2} />
          <YesNoField<F> name="isActive" label="Active" info="Inactive packages are hidden from packing" />
        </FormGrid>
      </FormSection>
    </div>
  );
}

function AccessStep({ form }: { readonly form: UseFormReturn<F> }) {
  const clients = useClientOptions();
  const all = form.watch("allClients");
  const { field: accessField, fieldState } = useController({ control: form.control, name: "clientAccess" });
  const access = (accessField.value ?? []) as { clientId: string; hasAccess: boolean }[];
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [q, setQ] = React.useState("");
  const enabled = new Map(access.map((a) => [a.clientId, a.hasAccess]));
  const rows = clients.filter((c) => c.label.toLowerCase().includes(q.trim().toLowerCase()));
  const setAccess = (ids: readonly string[], value: boolean) => {
    const next = new Map(enabled);
    for (const id of ids) next.set(id, value);
    accessField.onChange(clients.map((c) => ({ clientId: c.value, hasAccess: next.get(c.value) ?? false })));
    void form.trigger("clientAccess");
  };
  const toggleAll = (checked: boolean) => setSelected(checked ? new Set(rows.map((r) => r.value)) : new Set());
  const enabledCount = clients.filter((c) => enabled.get(c.value)).length;
  return (
    <div className="flex flex-col gap-4">
      <RadioCards<"all" | "manual"> ariaLabel="Client access" columns={2} value={all ? "all" : "manual"}
        onChange={(v) => { form.setValue("allClients", v === "all", { shouldDirty: true }); if (v === "manual" && access.length === 0) setAccess([], false); }}
        options={[
          { value: "all", title: "All clients", description: "Give access to this shipment package to all existing and future clients.", icon: Users },
          { value: "manual", title: "Select manually", description: "Choose which clients can pack into this package.", icon: Boxes },
        ]} />
      {all ? null : (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <TextField aria-label="Search clients" placeholder="Search clients" value={q} onChange={(e) => setQ(e.target.value)} size="sm" wrapperClassName="w-60" />
            <span className="text-[12px] text-secondary">{enabledCount} of {clients.length} enabled · {selected.size} selected</span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="secondary" disabled={selected.size === 0} title={selected.size === 0 ? "Select at least one client" : undefined} onClick={() => setAccess([...selected], false)}>Disable</Button>
              <Button size="sm" variant="primary" disabled={selected.size === 0} title={selected.size === 0 ? "Select at least one client" : undefined} onClick={() => setAccess([...selected], true)}>Enable</Button>
            </div>
          </div>
          {fieldState.error?.message ? <p role="alert" className="text-[12px] text-danger">{fieldState.error.message}</p> : null}
          <div className="max-h-[45vh] overflow-auto rounded-lg border border-border">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-[1] bg-surface-sunken text-[11px] uppercase text-secondary">
                <tr>
                  <th className="w-10 px-3 py-2"><Checkbox aria-label="Select all clients" checked={rows.length > 0 && rows.every((r) => selected.has(r.value))} onCheckedChange={(v) => toggleAll(v === true)} /></th>
                  <th className="px-3 py-2 text-left">Client</th><th className="w-32 px-3 py-2 text-left">Access</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 ? <tr><td colSpan={3} className="px-3 py-6 text-center text-faint">No clients match “{q}”</td></tr> : rows.map((c) => {
                  const on = enabled.get(c.value) ?? false;
                  return (
                    <tr key={c.value} className={selected.has(c.value) ? "bg-accent-soft/40" : undefined}>
                      <td className="px-3 py-1.5"><Checkbox aria-label={`Select ${c.label}`} checked={selected.has(c.value)} onCheckedChange={(v) => setSelected((s) => { const n = new Set(s); if (v === true) n.add(c.value); else n.delete(c.value); return n; })} /></td>
                      <td className="px-3 py-1.5">{c.label}</td>
                      <td className="px-3 py-1.5">
                        <button type="button" onClick={() => setAccess([c.value], !on)} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={`${on ? "Disable" : "Enable"} ${c.label}`}>
                          <Badge tone={on ? "success" : "outline"} size="sm" shape="pill">{on ? "Enabled" : "Disabled"}</Badge>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function TrackingStep({ form, productLabel }: { readonly form: UseFormReturn<F>; readonly productLabel: string | undefined }) {
  const clients = useClientOptions();
  const tracked = form.watch("trackInventory");
  const owner = form.watch("inventoryClientId") ?? null;
  const rule = form.watch("reductionRule");
  const method = form.watch("trackingMethod") ?? "match";
  const code = (form.watch("code") ?? "").trim().toUpperCase();
  const warehouseId = form.watch("warehouseId") || null;
  const locations = useWarehouseLocationOptions(rule === "Specific Location" ? warehouseId : null, []);
  const [label, setLabel] = React.useState(productLabel);
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Inventory tracking" description="When enabled, each pack consumes one unit of the packaging SKU from the chosen location.">
        <YesNoField<F> name="trackInventory" label="Enable inventory tracking" />
      </FormSection>
      {tracked ? (
        <FormSection title="Packaging stock">
          <FormGrid>
            <ComboField<F> name="inventoryClientId" label="Inventory owner" required options={clients}
              onValueChange={() => { form.setValue("inventoryProductId", null, { shouldDirty: true }); setLabel(undefined); }} />
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <span className="text-[12px] font-medium text-body">Inventory tracking method<span className="ml-0.5 text-danger" aria-hidden>*</span></span>
              <RadioCards<"match" | "auto"> ariaLabel="Inventory tracking method" columns={2} value={method}
                onChange={(v) => { form.setValue("trackingMethod", v, { shouldDirty: true, shouldValidate: true }); if (v === "auto") { form.setValue("inventoryProductId", null, { shouldDirty: true }); setLabel(undefined); form.clearErrors("inventoryProductId"); } }}
                options={[
                  { value: "auto", title: PACKAGE_TRACKING_METHOD_LABELS.auto, description: code ? `Creates Packaging Material SKU ${code} for the owner on save (an existing ${code} is matched instead).` : "Creates a Packaging Material SKU named after the package code on save." },
                  { value: "match", title: PACKAGE_TRACKING_METHOD_LABELS.match, description: "Pick a SKU the owner already stocks." },
                ]} />
            </div>
            {method === "match" ? (
              <FormField<F> name="inventoryProductId" label="Packaging SKU" required info="Usually a Packaging Material product of the owner">
                {(c) => <ProductPicker id={c.id} clientId={owner} value={(c.value as string | null) ?? null} selectedLabel={label} invalid={c.invalid} onBlur={c.onBlur}
                  onChange={(v, l) => { c.onChange(v); setLabel(l ?? undefined); }} />}
              </FormField>
            ) : null}
            <SelectField<F> name="reductionRule" label="Inventory reduction location" required options={enumSelectOptions(PACKAGE_REDUCTION_RULES)}
              onValueChange={(v) => { if (v !== "Specific Location") form.setValue("reductionLocationId", null); }} />
            {rule === "Specific Location" ? (
              <ComboField<F> name="reductionLocationId" label="Location" required options={locations.options} placeholder={locations.loading ? "Loading locations…" : "Select a location"} />
            ) : (
              <p className="self-end pb-2 text-[12px] text-secondary">
                {rule === "Packing Station" ? "Stock is taken from the packing station where the order is packed." : rule === "Any Location" ? "Stock is taken from any location that holds the SKU, fullest first." : "Choose a rule to see how stock is reduced."}
              </p>
            )}
          </FormGrid>
        </FormSection>
      ) : (
        <Callout variant="info" title="Not tracked">Packing won’t move packaging stock. Turn tracking on to keep box counts accurate.</Callout>
      )}
    </div>
  );
}

function OtherStep({ form, canManage }: { readonly form: UseFormReturn<F>; readonly canManage: boolean }) {
  const { field } = useController({ control: form.control, name: "customFields" });
  const v = form.watch();
  return (
    <div className="flex flex-col gap-5">
      <CustomFieldsSection entityType="shipment_package" values={(field.value ?? {}) as CustomFieldValues} onChange={field.onChange} canManage={canManage} />
      <section className="rounded-lg border border-border bg-surface-sunken/50 p-4">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-secondary">Summary</h3>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
          <div><dt className="text-[11px] text-faint">Package</dt><dd className="font-medium">{v.code || "—"} · {v.length} × {v.width} × {v.height} {v.dimensionUnit}</dd></div>
          <div><dt className="text-[11px] text-faint">Clients</dt><dd>{v.allClients ? "All clients" : `${(v.clientAccess ?? []).filter((a) => a.hasAccess).length} selected`}</dd></div>
          <div><dt className="text-[11px] text-faint">Inventory tracking</dt><dd>{v.trackInventory ? `Yes · ${v.trackingMethod === "auto" && !v.inventoryProductId ? "new SKU" : "matched SKU"} · ${v.reductionRule ?? ""}` : "No"}</dd></div>
          <div><dt className="text-[11px] text-faint">Status</dt><dd>{v.isActive ? "Active" : "Inactive"}</dd></div>
        </dl>
      </section>
    </div>
  );
}

function detailToForm(d: ShipmentPackageDetail): F {
  return {
    warehouseId: d.warehouseId, code: d.code, description: d.description ?? "", weightUnit: d.weightUnit as F["weightUnit"], emptyWeight: d.emptyWeight, maxWeight: d.maxWeight,
    dimensionUnit: d.dimensionUnit as F["dimensionUnit"], length: d.length, width: d.width, height: d.height, volumeUnit: d.volumeUnit as F["volumeUnit"], maxVolume: d.maxVolume,
    currency: d.currency as F["currency"], purchasePrice: d.purchasePrice, isActive: d.isActive, allClients: d.allClients,
    clientAccess: d.access.map((a) => ({ clientId: a.clientId, hasAccess: a.hasAccess })), trackInventory: d.trackInventory, trackingMethod: "match",
    inventoryClientId: d.inventoryClientId, inventoryProductId: d.inventoryProductId, reductionRule: d.reductionRule as F["reductionRule"], reductionLocationId: d.reductionLocationId,
    customFields: (d.customFields ?? {}) as F["customFields"],
  };
}

function Body({ initial, detail, onDone, onCancel, onDirtyChange }: { readonly initial: F; readonly detail: ShipmentPackageDetail | null; readonly onDone: () => void; readonly onCancel: () => void; readonly onDirtyChange: (d: boolean) => void }) {
  const formRef = React.useRef<UseFormReturn<F> | null>(null);
  const perms = usePagePerms("settings.shipment_packages", ["custom_field_management"] as const);
  const [conflict, setConflict] = React.useState(false);
  const editId = detail?.id ?? null;
  const productLabel = detail?.inventorySku ? `${detail.inventorySku}${detail.inventoryProductName ? ` · ${detail.inventoryProductName}` : ""}` : undefined;
  const guard = useWizardGuard();
  const steps = React.useMemo<readonly WizardStep<F>[]>(() => [
    { key: "general", label: "General", icon: Box, schema: guard.guard(packageGeneralSchema, (p) => GENERAL_KEYS.has(rootKey(p))), render: ({ form }) => { formRef.current = form; return <GeneralStep form={form} editId={editId} guard={guard} />; } },
    { key: "access", label: "Client access", icon: Users, schema: guard.guard(packageAccessSchema, (p) => ACCESS_KEYS.has(rootKey(p))), render: ({ form }) => { formRef.current = form; return <AccessStep form={form} />; } },
    { key: "tracking", label: "Inv. tracking", icon: Boxes, schema: guard.guard(packageTrackingSchema, (p) => TRACKING_KEYS.has(rootKey(p))), render: ({ form }) => { formRef.current = form; return <TrackingStep form={form} productLabel={productLabel} />; } },
    { key: "other", label: "Other info", icon: FileText, isOptional: true, schema: guard.guard(undefined, (p) => rootKey(p) === "customFields"), render: ({ form }) => { formRef.current = form; return <OtherStep form={form} canManage={perms.custom_field_management} />; } },
    // `guard` is stable for the life of the body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [editId, productLabel, perms.custom_field_management]);
  const submit = async (values: F) => {
    guard.dismissBanner();
    try {
      const { data } = await apiRequest<{ code: string }>(editId ? `/api/shipment-packages/${editId}` : "/api/shipment-packages", { method: editId ? "PATCH" : "POST", body: { ...values, version: detail?.version } });
      toast.success("Success", editId ? `Shipment package ${data.code} updated.` : `${PACKAGE_CREATED_MESSAGE}: ${data.code}.`);
      onDone();
    } catch (error) {
      if (isApiError(error) && error.code === "CONFLICT") setConflict(true);
      const routed = guard.handleServerError(error, values);
      if (!routed && formRef.current) applyServerFieldErrors(formRef.current, error);
      toast.error("Couldn't save the shipment package", apiErrorMessage(error), { duration: ERROR_TOAST_MS });
      throw error;
    }
  };
  return (
    <div ref={guard.rootRef} className="flex flex-col gap-3">
      {guard.banner && !conflict ? <Callout variant="error" title="Couldn't save the shipment package" onDismiss={guard.dismissBanner}>{guard.banner}</Callout> : null}
      {conflict ? <Callout variant="attention" title="This record changed since you opened it" action={<Button size="sm" onClick={() => window.location.reload()}>Reload</Button>}>Someone else saved this package. Reload to see their changes.</Callout> : null}
      <Wizard<F> steps={steps} variant="drawer" mode={editId ? "free" : "linear"} defaultValues={initial} draftScope={false} guardUnsaved={false} onDirtyChange={onDirtyChange}
        submitLabel={editId ? "Save" : "Finish"} onCancel={onCancel} onComplete={submit} />
    </div>
  );
}

export function ShipmentPackageWizardDrawer({ open, onOpenChange, editId, defaultWarehouseId, onSaved }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly editId: string | null; readonly defaultWarehouseId: string | null; readonly onSaved: () => void }) {
  const [dirty, setDirty] = React.useState(false);
  const detail = useApiQuery<ShipmentPackageDetail>(["shipment-package", editId ?? ""], open && editId ? `/api/shipment-packages/${editId}` : null, { staleTime: 0 });
  const close = () => { setDirty(false); onOpenChange(false); };
  const initial = editId ? (detail.data ? detailToForm(detail.data.data) : null) : { ...SHIPMENT_PACKAGE_DEFAULTS, warehouseId: defaultWarehouseId ?? "" };
  return (
    <Drawer open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())} dirty={dirty} width={60} bodyClassName="pb-0"
      title={editId ? `Edit shipment package ${detail.data?.data.code ?? ""}`.trim() : "Create shipment package"}
      description={editId ? "Every step is editable; Save applies all of them." : "General, client access, inventory tracking, then other info."}>
      {editId && detail.isError ? (
        <EmptyState title="Couldn't load this shipment package" description={detail.error.message} action={<Button onClick={() => void detail.refetch()}>Retry</Button>} />
      ) : !initial ? (
        <div className="flex flex-col gap-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-64 w-full" /></div>
      ) : (
        <Body key={`${editId ?? "new"}-${detail.dataUpdatedAt}`} initial={initial} detail={editId ? detail.data?.data ?? null : null} onDirtyChange={setDirty} onCancel={close}
          onDone={() => { setDirty(false); onSaved(); onOpenChange(false); }} />
      )}
    </Drawer>
  );
}
