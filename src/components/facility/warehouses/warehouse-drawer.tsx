"use client";

/**
 * Create / Edit Warehouse drawer: 1. Information (code, prefix, address, contact, day shift
 * with AM/PM, timezone) · 2. Settings (units, volumetric putaway, default receiving / ship /
 * return locations filtered by area type, mandatory reasons, mobile auto-logout).
 */
import * as React from "react";
import { Building2, SlidersHorizontal } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import { apiRequest, isApiError } from "@/lib/api-client";
import { applyServerFieldErrors, useApiQuery } from "@/lib/query-client";
import { DIMENSION_UNITS, WAREHOUSE_TYPES, WEIGHT_UNITS } from "@/lib/enums";
import { DAY_ZONES, TIMEZONES, WAREHOUSE_DEFAULTS, warehouseInfoSchema, warehouseSettingsSchema, type WarehouseInput } from "@/lib/grid-defs/facility/warehouses";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FormGrid, FormSection } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { apiErrorMessage } from "@/components/facility/facility-shared";
import { Wizard, type WizardStep } from "@/components/ui/wizard";
import { enumSelectOptions, NumberField, SelectField, TextInput, YesNoField } from "@/components/facility/form-controls";
import { useWarehouseLocationOptions } from "@/components/facility/pickers";
import type { WarehouseDetail } from "@/server/repositories/warehouses";

type F = WarehouseInput;

const TZ_OPTIONS = TIMEZONES.map((t) => ({ value: t, label: t.replace("_", " ").replace("/", " / ") }));
const ZONE_OPTIONS = DAY_ZONES.map((z) => ({ value: z, label: z }));

function InformationStep({ isEdit }: { readonly isEdit: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Warehouse">
        <FormGrid>
          <TextInput<F> name="code" label="Code" required maxLength={20} transform={(v) => v.toUpperCase()} placeholder="e.g. MLT2" info={isEdit ? "Changing the code updates every label and report that shows it" : undefined} />
          <TextInput<F> name="name" label="Name" required maxLength={120} placeholder="e.g. Memphis Fulfillment" />
          <TextInput<F> name="prefix" label="Prefix" required maxLength={8} transform={(v) => v.toUpperCase()} info="Short tag added to codes generated in this warehouse" />
          <SelectField<F> name="type" label="Type" required options={enumSelectOptions(WAREHOUSE_TYPES)} />
        </FormGrid>
      </FormSection>
      <FormSection title="Address">
        <FormGrid>
          <TextInput<F> name="addressLine" label="Address line 1" required maxLength={250} className="md:col-span-2" />
          <TextInput<F> name="addressLine2" label="Address line 2" maxLength={250} className="md:col-span-2" />
          <TextInput<F> name="city" label="City" required maxLength={100} />
          <TextInput<F> name="state" label="State" required maxLength={60} />
          <TextInput<F> name="postalCode" label="Postal code" required maxLength={20} />
          <TextInput<F> name="country" label="Country" required maxLength={60} />
        </FormGrid>
      </FormSection>
      <FormSection title="Contact">
        <FormGrid>
          <TextInput<F> name="contactName" label="Contact name" required maxLength={120} />
          <TextInput<F> name="contactPhone" label="Contact phone number" required maxLength={40} />
          <TextInput<F> name="email" label="Email" maxLength={200} className="md:col-span-2" />
        </FormGrid>
      </FormSection>
      <FormSection title="Day shift" description="Used by the dashboard and end-of-day cut-offs.">
        <div className="grid gap-4 md:grid-cols-[1fr_96px_1fr_96px]">
          <TextInput<F> name="shiftStart" label="Start time" required maxLength={5} placeholder="08:00" />
          <SelectField<F> name="shiftStartZone" label="AM / PM" required options={ZONE_OPTIONS} />
          <TextInput<F> name="shiftEnd" label="End time" required maxLength={5} placeholder="05:00" />
          <SelectField<F> name="shiftEndZone" label="AM / PM" required options={ZONE_OPTIONS} />
        </div>
        <FormGrid className="mt-4">
          <SelectField<F> name="timezone" label="Timezone" required options={TZ_OPTIONS} />
        </FormGrid>
      </FormSection>
    </div>
  );
}

function SettingsStep({ form, warehouseId }: { readonly form: UseFormReturn<F>; readonly warehouseId: string | null }) {
  const receiving = useWarehouseLocationOptions(warehouseId, ["Receiving"]);
  const ship = useWarehouseLocationOptions(warehouseId, ["Shipment", "Loading", "Packing"]);
  const returns = useWarehouseLocationOptions(warehouseId, ["Returns", "Receiving"]);
  const autoLogout = form.watch("mobileAutoLogout");
  const locPlaceholder = (o: { options: readonly unknown[]; loading: boolean }, what: string) =>
    !warehouseId ? "Available after the warehouse is created" : o.loading ? "Loading…" : o.options.length ? "Select location" : `No ${what} locations yet`;
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Units">
        <FormGrid>
          <SelectField<F> name="defaultDimensionUnit" label="Default dimension unit" required options={enumSelectOptions(DIMENSION_UNITS)} />
          <SelectField<F> name="defaultWeightUnit" label="Default weight unit" required options={enumSelectOptions(WEIGHT_UNITS)} />
          <YesNoField<F> name="useLpDimsForPutaway" label="Use LP dimensions for volumetric putaway" info="Putaway suggestions check the LP's volume against the location's free volume" />
        </FormGrid>
      </FormSection>
      <FormSection title="Default locations" description="Pre-filled when receiving, shipping and processing returns. Only locations of the matching area type are listed.">
        {!warehouseId ? <Callout variant="info" title="Create the warehouse first">Add its locations, then come back to choose the defaults.</Callout> : null}
        <FormGrid className={warehouseId ? undefined : "mt-3"}>
          <SelectField<F> name="defaultReceivingLocationId" label="Default receiving location" options={receiving.options} clearable disabled={!warehouseId} placeholder={locPlaceholder(receiving, "Receiving")} />
          <SelectField<F> name="defaultShipLocationId" label="Default ship location" options={ship.options} clearable disabled={!warehouseId} placeholder={locPlaceholder(ship, "Shipment")} />
          <SelectField<F> name="defaultReturnLocationId" label="Default return location" options={returns.options} clearable disabled={!warehouseId} placeholder={locPlaceholder(returns, "Returns")} />
        </FormGrid>
      </FormSection>
      <FormSection title="Mandatory reasons">
        <FormGrid>
          <YesNoField<F> name="mandatoryAdjustmentReason" label="Adjustment reason required" info="Inventory adjustments must pick a reason" />
          <YesNoField<F> name="mandatoryCountReason" label="Count difference reason required" info="Count updates with a difference must pick a reason" />
        </FormGrid>
      </FormSection>
      <FormSection title="Mobile">
        <FormGrid>
          <YesNoField<F> name="mobileAutoLogout" label="Auto logout inactive mobile users" />
          <NumberField<F> name="mobileAutoLogoutMinutes" label="Inactivity timeout (minutes)" min={1} max={720} nullable disabled={!autoLogout} required={Boolean(autoLogout)} />
        </FormGrid>
      </FormSection>
    </div>
  );
}

export function detailToWarehouseForm(d: WarehouseDetail): F {
  return {
    code: d.code, name: d.name, prefix: d.prefix, type: d.type, addressLine: d.addressLine, addressLine2: d.addressLine2 ?? "", postalCode: d.postalCode ?? "",
    city: d.city, state: d.state, country: d.country, contactName: d.contactName ?? "", contactPhone: d.contactPhone ?? "", email: d.email ?? "",
    shiftStart: d.shiftStart, shiftStartZone: d.shiftStartZone, shiftEnd: d.shiftEnd, shiftEndZone: d.shiftEndZone,
    timezone: (TIMEZONES as readonly string[]).includes(d.timezone) ? (d.timezone as F["timezone"]) : "America/Chicago",
    defaultDimensionUnit: d.defaultDimensionUnit as F["defaultDimensionUnit"], defaultWeightUnit: d.defaultWeightUnit as F["defaultWeightUnit"],
    useLpDimsForPutaway: d.useLpDimsForPutaway, defaultReceivingLocationId: d.defaultReceivingLocationId, defaultShipLocationId: d.defaultShipLocationId,
    defaultReturnLocationId: d.defaultReturnLocationId, mandatoryAdjustmentReason: d.mandatoryAdjustmentReason, mandatoryCountReason: d.mandatoryCountReason,
    mobileAutoLogout: d.mobileAutoLogout, mobileAutoLogoutMinutes: d.mobileAutoLogoutMinutes ?? 30,
  };
}

function Body({ initial, editId, version, onDone, onCancel, onDirtyChange }: { readonly initial: F; readonly editId: string | null; readonly version?: number; readonly onDone: () => void; readonly onCancel: () => void; readonly onDirtyChange: (d: boolean) => void }) {
  const formRef = React.useRef<UseFormReturn<F> | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const steps = React.useMemo<readonly WizardStep<F>[]>(() => [
    { key: "information", label: "Information", icon: Building2, schema: warehouseInfoSchema, render: ({ form }) => { formRef.current = form; return <InformationStep isEdit={Boolean(editId)} />; } },
    { key: "settings", label: "Settings", icon: SlidersHorizontal, schema: warehouseSettingsSchema, render: ({ form }) => { formRef.current = form; return <SettingsStep form={form} warehouseId={editId} />; } },
  ], [editId]);
  const submit = async (values: F) => {
    try {
      const { data } = await apiRequest<{ code: string }>(editId ? `/api/warehouses/${editId}` : "/api/warehouses", { method: editId ? "PATCH" : "POST", body: { ...values, version } });
      toast.success("Success", editId ? `Warehouse ${data.code} updated.` : `Warehouse ${data.code} created. Add its locations next.`);
      onDone();
    } catch (error) {
      if (isApiError(error) && error.code === "CONFLICT") setConflict(true);
      if (formRef.current) applyServerFieldErrors(formRef.current, error);
      toast.error("Couldn't save the warehouse", apiErrorMessage(error));
      throw error;
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {conflict ? <Callout variant="attention" title="This record changed since you opened it" action={<Button size="sm" onClick={() => window.location.reload()}>Reload</Button>}>Someone else saved this warehouse. Reload to see their changes.</Callout> : null}
      <Wizard<F> steps={steps} variant="drawer" mode={editId ? "free" : "linear"} defaultValues={initial} draftScope={false} guardUnsaved={false} onDirtyChange={onDirtyChange} submitLabel={editId ? "Save" : "Create warehouse"} onCancel={onCancel} onComplete={submit} />
    </div>
  );
}

export function WarehouseDrawer({ open, onOpenChange, editId, onSaved }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly editId: string | null; readonly onSaved: () => void }) {
  const [dirty, setDirty] = React.useState(false);
  const detail = useApiQuery<WarehouseDetail>(["warehouse", editId ?? ""], open && editId ? `/api/warehouses/${editId}` : null, { staleTime: 0 });
  const close = () => { setDirty(false); onOpenChange(false); };
  const initial = editId ? (detail.data ? detailToWarehouseForm(detail.data.data) : null) : WAREHOUSE_DEFAULTS;
  return (
    <Drawer open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())} dirty={dirty} width={60}
      title={editId ? `Edit warehouse ${detail.data?.data.code ?? ""}`.trim() : "Create warehouse"}
      description={editId ? "Both steps are editable; Save applies them together." : "Information first, then the operating settings."}>
      {editId && detail.isError ? (
        <EmptyState title="Couldn't load this warehouse" description={detail.error.message} action={<Button onClick={() => void detail.refetch()}>Retry</Button>} />
      ) : !initial ? (
        <div className="flex flex-col gap-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-64 w-full" /></div>
      ) : (
        <Body key={`${editId ?? "new"}-${detail.dataUpdatedAt}`} initial={initial} editId={editId} version={detail.data?.data.version} onDirtyChange={setDirty} onCancel={close}
          onDone={() => { setDirty(false); onSaved(); onOpenChange(false); }} />
      )}
    </Drawer>
  );
}
