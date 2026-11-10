"use client";

/**
 * Create / Edit Location drawer (3 steps: Information · Product Capacity · LP Capacity).
 * Create runs in linear mode, edit in free mode (every step clickable). Barcode defaults to
 * the code. Server field errors land inline; a stale edit shows the 409 Reload prompt.
 */
import * as React from "react";
import { z } from "zod";
import { Boxes, Info, Layers, Pencil, Plus, Trash2 } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import { apiRequest, isApiError } from "@/lib/api-client";
import { applyServerFieldErrors, useApiQuery } from "@/lib/query-client";
import { ABC_CODES, AREA_TYPES, CAPACITY_TYPES, DIMENSION_UNITS, LOCATION_TYPES, VOLUME_UNITS } from "@/lib/enums";
import { LOCATION_INFO_DEFAULTS, LOCATION_RULES, locationInfoSchema, REPLENISHMENT_TYPES, type LocationInfoInput } from "@/lib/grid-defs/facility/locations";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FormGrid, FormGridFull, FormSection } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { Wizard, type WizardStep } from "@/components/ui/wizard";
import { CheckboxField, ComboField, enumSelectOptions, NumberField, SelectField, TextInput, YesNoField } from "@/components/facility/form-controls";
import { useClientOptions, useLookups, useWarehouseOptions, apiErrorMessage } from "@/components/facility/facility-shared";
import type { LocationDetail } from "@/server/repositories/locations";
import { LpCapacityModal, ProductCapacityModal, type LpCapacityRow, type ProductCapacityRow } from "./location-capacity-modals";

export interface LocationFormValues {
  info: LocationInfoInput;
  productCapacities: ProductCapacityRow[];
  lpCapacities: LpCapacityRow[];
}

type F = LocationFormValues;

function InformationStep({ form, isEdit }: { readonly form: UseFormReturn<F>; readonly isEdit: boolean }) {
  const warehouses = useWarehouseOptions();
  const warehouseId = form.watch("info.warehouseId") || null;
  const groups = useLookups("location_group", warehouseId);
  const zones = useLookups("location_zone", warehouseId);
  const clients = useClientOptions();
  const capacityType = form.watch("info.capacityType");
  const singleClient = form.watch("info.singleClient");
  const code = form.watch("info.code");
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Information">
        <FormGrid>
          <TextInput<F> name="info.code" label="Location code" required maxLength={60} placeholder="e.g. A-01-02-1" transform={(v) => v.toUpperCase()} />
          <ComboField<F> name="info.warehouseId" label="Warehouse" required options={warehouses.options} disabled={isEdit} info={isEdit ? "A location can't move between warehouses" : undefined}
            onValueChange={() => { form.setValue("info.locationGroupId", null); form.setValue("info.locationZoneId", null); form.setValue("lpCapacities", []); }} />
          <SelectField<F> name="info.locationGroupId" label="Location group" options={groups.options} clearable placeholder={!warehouseId ? "Select a warehouse first" : groups.options.length ? "Select group" : "No groups for this warehouse"} disabled={!warehouseId} />
          <SelectField<F> name="info.locationZoneId" label="Location zone" options={zones.options} clearable placeholder={!warehouseId ? "Select a warehouse first" : zones.options.length ? "Select zone" : "No zones for this warehouse"} disabled={!warehouseId} />
          <SelectField<F> name="info.locationType" label="Location type" required options={enumSelectOptions(LOCATION_TYPES)} />
          <SelectField<F> name="info.areaType" label="Area type" required options={enumSelectOptions(AREA_TYPES)} info="Drives which workflows can use the location: putaway, pick, pack, ship" />
          <SelectField<F> name="info.replenishmentType" label="Replenishment location type" options={enumSelectOptions(REPLENISHMENT_TYPES)} clearable />
          <NumberField<F> name="info.walkingPathPriority" label="Walking path priority" nullable max={999999} info="Pick-path sequence: lower numbers are visited first" />
          <SelectField<F> name="info.capacityType" label="Location capacity type" required options={enumSelectOptions(CAPACITY_TYPES)} />
          <NumberField<F> name="info.maxCapacityQty" label="Maximum capacity quantity" disabled={capacityType === "None"} required={capacityType !== "None"} />
          <NumberField<F> name="info.maxSkuQty" label="Maximum SKU quantity" nullable max={10000} />
        </FormGrid>
      </FormSection>
      <FormSection title="Dimensions" collapsible>
        <FormGrid columns={3}>
          <TextInput<F> name="info.mezzanine" label="Mezzanine" maxLength={100} />
          <TextInput<F> name="info.aisle" label="Aisle" maxLength={40} />
          <TextInput<F> name="info.rack" label="Rack" maxLength={40} />
          <NumberField<F> name="info.column" label="Column" nullable max={9999} />
          <NumberField<F> name="info.level" label="Level" nullable max={999} />
          <TextInput<F> name="info.position" label="Position" maxLength={40} />
          <SelectField<F> name="info.dimensionUnit" label="Dimension unit" required options={enumSelectOptions(DIMENSION_UNITS)} />
          <NumberField<F> name="info.height" label="Height" decimals={2} />
          <NumberField<F> name="info.width" label="Width" decimals={2} />
          <NumberField<F> name="info.length" label="Length" decimals={2} />
          <SelectField<F> name="info.volumeUnit" label="Volume unit" required options={enumSelectOptions(VOLUME_UNITS)} />
          <NumberField<F> name="info.volume" label="Volume" decimals={5} />
        </FormGrid>
      </FormSection>
      <FormSection title="Other information" collapsible>
        <FormGrid>
          <TextInput<F> name="info.displayMember" label="Cell display member" maxLength={100} placeholder="Display member" />
          <TextInput<F> name="info.barcode" label="Location barcode" maxLength={120} placeholder={code ? `Defaults to ${code}` : "Defaults to the location code"} />
          <SelectField<F> name="info.abcCode" label="ABC code" options={enumSelectOptions(ABC_CODES)} />
          <TextInput<F> name="info.colorCode" label="Color code" maxLength={20} placeholder="Enter color code" />
          <YesNoField<F> name="info.singleClient" label="Single client" />
          <YesNoField<F> name="info.isLocked" label="Lock location" info="Locked locations are skipped by putaway and allocation" />
          <ComboField<F> name="info.dedicatedClientId" label="Client" options={clients} placeholder="All clients" required={singleClient} info="Dedicates the location to one client" />
          <YesNoField<F> name="info.printApplyOnPacking" label="Print & apply on packing" />
        </FormGrid>
      </FormSection>
      <FormSection title="Location rules" description="Select the rules that define how this location can be used.">
        <div className="grid gap-x-4 gap-y-2.5 md:grid-cols-2">
          {LOCATION_RULES.map((r) => <CheckboxField<F> key={r.key} name={`info.${r.key}`} label={r.label} hint={r.hint} />)}
        </div>
      </FormSection>
    </div>
  );
}

function CapacityTable<R>({ rows, columns, onEdit, onRemove, emptyTitle, emptyHint, onAdd, addLabel, addDisabledReason }: {
  readonly rows: readonly R[];
  readonly columns: readonly { readonly label: string; readonly render: (r: R) => React.ReactNode; readonly align?: "right" }[];
  readonly onEdit: (index: number) => void;
  readonly onRemove: (index: number) => void;
  readonly emptyTitle: string;
  readonly emptyHint: string;
  readonly onAdd: () => void;
  readonly addLabel: string;
  readonly addDisabledReason?: string | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end">
        <Button variant="secondary" onClick={onAdd} disabled={Boolean(addDisabledReason)} title={addDisabledReason ?? undefined}><Plus className="h-4 w-4" aria-hidden />{addLabel}</Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState compact title={emptyTitle} description={emptyHint} icon={Boxes} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-sunken text-[11px] uppercase tracking-wide text-secondary">
              <tr>{columns.map((c) => <th key={c.label} className={`px-3 py-2 font-semibold ${c.align === "right" ? "text-right" : "text-left"}`}>{c.label}</th>)}<th className="w-20" /></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-surface-sunken/60">
                  {columns.map((c) => <td key={c.label} className={`px-3 py-2 ${c.align === "right" ? "text-right tabular-nums" : ""}`}>{c.render(r)}</td>)}
                  <td className="px-2 py-1 text-right">
                    <Button size="icon-sm" variant="ghost" aria-label="Edit" onClick={() => onEdit(i)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Remove" onClick={() => onRemove(i)}><Trash2 className="h-3.5 w-3.5 text-danger" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProductCapacityStep({ form }: { readonly form: UseFormReturn<F> }) {
  const rows = form.watch("productCapacities");
  const [editing, setEditing] = React.useState<number | "new" | null>(null);
  const save = (row: ProductCapacityRow) => {
    const next = [...rows];
    if (editing === "new" || editing === null) next.push(row);
    else next[editing] = row;
    form.setValue("productCapacities", next, { shouldDirty: true });
  };
  return (
    <>
      <CapacityTable<ProductCapacityRow>
        rows={rows}
        columns={[
          { label: "Product", render: (r) => <span className="font-medium">{r.sku ?? "—"}</span> },
          { label: "Client", render: (r) => r.clientName ?? "—" },
          { label: "Pack type", render: (r) => r.packType },
          { label: "Min qty", render: (r) => r.minQty, align: "right" },
          { label: "Max qty", render: (r) => r.maxQty, align: "right" },
        ]}
        onAdd={() => setEditing("new")}
        addLabel="Add capacity"
        onEdit={setEditing}
        onRemove={(i) => form.setValue("productCapacities", rows.filter((_, j) => j !== i), { shouldDirty: true })}
        emptyTitle="No product capacities"
        emptyHint="Optional. Add a min / max per SKU to make this a replenished pick face."
      />
      <ProductCapacityModal open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} initial={typeof editing === "number" ? rows[editing] ?? null : null} onSave={save} />
    </>
  );
}

function LpCapacityStep({ form }: { readonly form: UseFormReturn<F> }) {
  const rows = form.watch("lpCapacities");
  const warehouseId = form.watch("info.warehouseId") || null;
  const [editing, setEditing] = React.useState<number | "new" | null>(null);
  const save = (row: LpCapacityRow) => {
    const next = [...rows];
    if (editing === "new" || editing === null) next.push(row);
    else next[editing] = row;
    form.setValue("lpCapacities", next, { shouldDirty: true });
  };
  return (
    <>
      <CapacityTable<LpCapacityRow>
        rows={rows}
        columns={[
          { label: "LP type", render: (r) => <span className="font-medium">{r.lpTypeCode ?? "—"}</span> },
          { label: "Min qty", render: (r) => r.minQty, align: "right" },
          { label: "Max qty", render: (r) => r.maxQty, align: "right" },
          { label: "Product SKU", render: (r) => r.sku ?? <span className="text-faint">Any</span> },
        ]}
        onAdd={() => setEditing("new")}
        addLabel="Add capacity"
        addDisabledReason={warehouseId ? null : "Select a warehouse on the Information step first"}
        onEdit={setEditing}
        onRemove={(i) => form.setValue("lpCapacities", rows.filter((_, j) => j !== i), { shouldDirty: true })}
        emptyTitle="No LP capacities"
        emptyHint="Optional. Limit how many pallets or totes of each LP type fit here."
      />
      <LpCapacityModal open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} warehouseId={warehouseId} initial={typeof editing === "number" ? rows[editing] ?? null : null} onSave={save} />
    </>
  );
}

const infoStepSchema = z.object({ info: locationInfoSchema });

export function detailToForm(d: LocationDetail): LocationFormValues {
  return {
    info: {
      code: d.code, warehouseId: d.warehouseId, locationGroupId: d.locationGroupId, locationZoneId: d.locationZoneId,
      locationType: d.locationType ?? "Shelves", areaType: d.areaType ?? "Storage", replenishmentType: d.replenishmentType,
      walkingPathPriority: d.walkingPathPriority, capacityType: d.capacityType, maxCapacityQty: d.maxCapacityQty, maxSkuQty: d.maxSkuQty,
      mezzanine: d.mezzanine ?? "", aisle: d.aisle ?? "", rack: d.rack ?? d.bay ?? "", column: d.column, level: Number(d.level) || null, position: d.position ?? "",
      dimensionUnit: (d.dimensionUnit as LocationInfoInput["dimensionUnit"]) ?? "Inch", height: d.height, width: d.width, length: d.length,
      volumeUnit: (d.volumeUnit as LocationInfoInput["volumeUnit"]) ?? "Cubic Inch", volume: d.volume,
      displayMember: d.displayMember ?? "", barcode: d.barcode ?? "", abcCode: d.abcCode, singleClient: d.singleClient, isLocked: d.isLocked,
      dedicatedClientId: d.dedicatedClientId, printApplyOnPacking: d.printApplyOnPacking, colorCode: d.colorCode ?? "",
      preventAllocation: d.preventAllocation, preventInventorySync: d.preventInventorySync, onlyOneLot: d.onlyOneLot, onlyDamaged: d.onlyDamaged,
      onlyOneExpiry: d.onlyOneExpiry, onlyOneSku: d.onlyOneSku, onlyOneLp: d.onlyOneLp, onlyOneProductionDate: d.onlyOneProductionDate,
      autoRemoveLpAfterReplenishment: d.autoRemoveLpAfterReplenishment, autoRemoveLpAfterTransfer: d.autoRemoveLpAfterTransfer,
    },
    productCapacities: d.productCapacities.map((c) => ({ clientId: c.clientId, productId: c.productId, packType: c.packType, minQty: c.minQty, maxQty: c.maxQty, sku: c.sku, clientName: c.clientName })),
    lpCapacities: d.lpCapacities.map((c) => ({ lpTypeId: c.lpTypeId, minQty: c.minQty, maxQty: c.maxQty, assignProduct: Boolean(c.productId), clientId: c.clientId, productId: c.productId, lpTypeCode: c.lpTypeCode, sku: c.sku })),
  };
}

function WizardBody({ initial, editId, version, onDone, onCancel, onDirtyChange }: { readonly initial: LocationFormValues; readonly editId: string | null; readonly version?: number; readonly onDone: (id: string, code: string) => void; readonly onCancel: () => void; readonly onDirtyChange: (d: boolean) => void }) {
  const formRef = React.useRef<UseFormReturn<F> | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const steps = React.useMemo<readonly WizardStep<F>[]>(() => [
    { key: "information", label: "Information", icon: Info, schema: infoStepSchema, render: ({ form }) => { formRef.current = form; return <InformationStep form={form} isEdit={Boolean(editId)} />; } },
    { key: "product-capacity", label: "Product capacity", icon: Boxes, isOptional: true, description: "Products that may be stored here, with replenishment min / max.", render: ({ form }) => { formRef.current = form; return <ProductCapacityStep form={form} />; } },
    { key: "lp-capacity", label: "LP capacity", icon: Layers, isOptional: true, description: "License plate types this location accepts.", render: ({ form }) => { formRef.current = form; return <LpCapacityStep form={form} />; } },
  ], [editId]);

  const submit = async (values: F) => {
    const body = { ...values, version };
    try {
      const { data } = await apiRequest<{ id: string; code: string }>(editId ? `/api/locations/${editId}` : "/api/locations", { method: editId ? "PATCH" : "POST", body });
      toast.success("Success", editId ? `Location ${data.code} updated.` : `Location ${data.code} created.`);
      onDone(data.id, data.code);
    } catch (error) {
      if (isApiError(error) && error.code === "CONFLICT") setConflict(true);
      if (formRef.current) applyServerFieldErrors(formRef.current, error);
      toast.error("Couldn't save the location", apiErrorMessage(error));
      throw error;
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {conflict ? <Callout variant="attention" title="This record changed since you opened it" action={<Button size="sm" onClick={() => window.location.reload()}>Reload</Button>}>Someone else saved this location. Reload to see their changes before editing.</Callout> : null}
      <Wizard<F> steps={steps} variant="drawer" mode={editId ? "free" : "linear"} defaultValues={initial} draftScope={false} guardUnsaved={false} onDirtyChange={onDirtyChange} submitLabel={editId ? "Save" : "Create location"} onCancel={onCancel} onComplete={submit} />
    </div>
  );
}

export function LocationWizardDrawer({ open, onOpenChange, editId, defaultWarehouseId, onSaved }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly editId: string | null; readonly defaultWarehouseId?: string | null; readonly onSaved?: (id: string, code: string) => void }) {
  const [dirty, setDirty] = React.useState(false);
  const detail = useApiQuery<LocationDetail>(["location", editId ?? ""], open && editId ? `/api/locations/${editId}` : null, { staleTime: 0 });
  const close = () => { setDirty(false); onOpenChange(false); };
  const initial: LocationFormValues | null = editId
    ? detail.data ? detailToForm(detail.data.data) : null
    : { info: { ...LOCATION_INFO_DEFAULTS, warehouseId: defaultWarehouseId ?? "" }, productCapacities: [], lpCapacities: [] };
  return (
    <Drawer open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())} dirty={dirty} width={60}
      title={editId ? `Edit location ${detail.data?.data.code ?? ""}`.trim() : "Create location"}
      description={editId ? "Every step is editable; Save applies all of them." : "Information, then optional product and LP capacities."}>
      {editId && detail.isError ? (
        <EmptyState title="Couldn't load this location" description={detail.error.message} action={<Button onClick={() => void detail.refetch()}>Retry</Button>} />
      ) : !initial ? (
        <div className="flex flex-col gap-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-64 w-full" /></div>
      ) : (
        <WizardBody key={`${editId ?? "new"}-${detail.dataUpdatedAt}`} initial={initial} editId={editId} version={detail.data?.data.version} onDirtyChange={setDirty} onCancel={close}
          onDone={(id, code) => { setDirty(false); onSaved?.(id, code); onOpenChange(false); }} />
      )}
    </Drawer>
  );
}
