"use client";

/**
 * Create / Edit LP Type drawer: 1. General (code, prefix, length, dimensions and weights with
 * units) · 2. Parameters (9 mixing-rule toggles) · 3. Other info (description + live
 * numbering preview). Prefix and length lock once LP numbers of the type exist.
 */
import * as React from "react";
import { FileText, Ruler, ShieldCheck } from "lucide-react";
import { useController, type UseFormReturn } from "react-hook-form";
import { ERROR_TOAST_MS } from "@/lib/grid-defs/facility/common";
import { useAvailabilityCheck, useWizardGuard, type WizardGuard } from "@/components/facility/wizard-guard";
import { CustomFieldsSection, type CustomFieldValues } from "@/components/shared/custom-fields-section";
import { apiRequest, isApiError } from "@/lib/api-client";
import { applyServerFieldErrors, useApiQuery } from "@/lib/query-client";
import { DIMENSION_UNITS, VOLUME_UNITS, WEIGHT_UNITS } from "@/lib/enums";
import { LP_TYPE_DEFAULTS, LP_TYPE_PARAMETERS, lpNumberPreview, maxWeightIssue, lpTypeGeneralSchema, lpTypeOtherSchema, type LpTypeInput } from "@/lib/grid-defs/facility/lp-types";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FormGrid, FormSection } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { Wizard, type WizardStep } from "@/components/ui/wizard";
import { CheckboxField, ComboField, enumSelectOptions, NumberField, SelectField, TextInput, useCrossFieldError } from "@/components/facility/form-controls";
import { useWarehouseOptions, usePagePerms, apiErrorMessage } from "@/components/facility/facility-shared";
import type { LpTypeDetail } from "@/server/repositories/lp-types";

type F = LpTypeInput;

const GENERAL_KEYS: ReadonlySet<string> = new Set(["warehouseId", "code", "numberPrefix", "numberLength", "length", "width", "height", "dimensionUnit", "weightUnit", "emptyWeight", "maxWeight", "volumeUnit", "maxVolume"]);

function GeneralStep({ form, editId, numberLocked, guard }: { readonly form: UseFormReturn<F>; readonly editId: string | null; readonly numberLocked: string | null; readonly guard: WizardGuard }) {
  const isEdit = Boolean(editId);
  const warehouses = useWarehouseOptions();
  useAvailabilityCheck<F>(guard, form, {
    url: "/api/lp-types/availability",
    paths: ["code", "numberPrefix"],
    params: (v) => (v.warehouseId && (v.code?.trim() || v.numberPrefix?.trim()) ? { warehouseId: v.warehouseId, code: v.code?.trim() || undefined, prefix: v.numberPrefix?.trim() || undefined, excludeId: editId ?? undefined } : null),
  });
  const dim = form.watch("dimensionUnit");
  const weight = form.watch("weightUnit");
  // Live cross-field check (critic: empty 20 / max 10 was accepted with no error until Next).
  useCrossFieldError(form, "maxWeight", maxWeightIssue(form.watch("emptyWeight"), form.watch("maxWeight")));
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Identity and numbering">
        <FormGrid>
          <ComboField<F> name="warehouseId" label="Warehouse" required options={warehouses.selectable(form.watch("warehouseId"))} disabled={isEdit} info={isEdit ? "An LP type can't move between warehouses" : undefined} description={!isEdit && warehouses.defaultHint && form.watch("warehouseId") === warehouses.defaultId ? warehouses.defaultHint : undefined} />
          <TextInput<F> name="code" label="Code" required maxLength={40} transform={(v) => v.toUpperCase()} placeholder="e.g. TOTE" />
          <TextInput<F> name="numberPrefix" label="Number prefix" required maxLength={10} transform={(v) => v.toUpperCase()} placeholder="e.g. KSE-" disabled={Boolean(numberLocked)} info={numberLocked ?? "Every LP number of this type starts with it"} />
          <NumberField<F> name="numberLength" label="Number length" required min={1} max={12} disabled={Boolean(numberLocked)} info={numberLocked ?? "Digits after the prefix, zero padded"} />
        </FormGrid>
      </FormSection>
      <FormSection title="Dimensions">
        <FormGrid columns={4}>
          <SelectField<F> name="dimensionUnit" label="Dimension unit" required options={enumSelectOptions(DIMENSION_UNITS)} />
          <NumberField<F> name="length" label="Length" decimals={2} suffix={dim} />
          <NumberField<F> name="width" label="Width" decimals={2} suffix={dim} />
          <NumberField<F> name="height" label="Height" decimals={2} suffix={dim} />
        </FormGrid>
      </FormSection>
      <FormSection title="Weight and volume">
        <FormGrid columns={3}>
          <SelectField<F> name="weightUnit" label="Weight unit" required options={enumSelectOptions(WEIGHT_UNITS)} />
          <NumberField<F> name="emptyWeight" label="Empty weight" decimals={2} suffix={weight} />
          <NumberField<F> name="maxWeight" label="Max weight" decimals={2} suffix={weight} info="0 means no limit" />
          <SelectField<F> name="volumeUnit" label="Volume unit" required options={enumSelectOptions(VOLUME_UNITS)} />
          <NumberField<F> name="maxVolume" label="Max volume" decimals={3} info="0 means no limit" />
        </FormGrid>
      </FormSection>
    </div>
  );
}

function ParametersStep() {
  return (
    <FormSection title="Mixing rules" description="Rules applied whenever stock is put on an LP of this type. A rule breach blocks the scan with a clear message.">
      <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
        {LP_TYPE_PARAMETERS.map((p) => <CheckboxField<F> key={p.key} name={p.key} label={p.label} />)}
      </div>
    </FormSection>
  );
}

function OtherStep({ form, next, canManage }: { readonly form: UseFormReturn<F>; readonly next: number; readonly canManage: boolean }) {
  const { field } = useController({ control: form.control, name: "customFields" });
  const prefix = form.watch("numberPrefix") || "";
  const length = Number(form.watch("numberLength")) || 1;
  const params = LP_TYPE_PARAMETERS.filter((p) => form.watch(p.key));
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Description">
        <TextInput<F> name="description" label="Description" maxLength={250} showCount placeholder="e.g. Blue picking tote 24 × 16 × 12" />
      </FormSection>
      <CustomFieldsSection entityType="lp_type" values={(field.value ?? {}) as CustomFieldValues} onChange={(v) => field.onChange({ ...v })} canManage={canManage} />
      <section className="rounded-lg border border-border bg-surface-sunken/50 p-4">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-secondary">Numbering preview</h3>
        <p className="mt-1 text-[12px] text-faint">The next three numbers created from this type.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {[0, 1, 2].map((i) => <code key={i} className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-[13px] text-foreground">{lpNumberPreview(prefix, length, next + i)}</code>)}
        </div>
        <p className="mt-3 text-[12px] text-secondary">{params.length ? `Rules: ${params.map((p) => p.label).join(" · ")}` : "No mixing rules: any stock can share an LP of this type."}</p>
      </section>
    </div>
  );
}

export function detailToLpTypeForm(d: LpTypeDetail): F {
  return {
    warehouseId: d.warehouseId, code: d.code, numberPrefix: d.numberPrefix, numberLength: d.numberLength, description: d.description ?? "",
    length: d.length, width: d.width, height: d.height, dimensionUnit: d.dimensionUnit as F["dimensionUnit"], weightUnit: d.weightUnit as F["weightUnit"],
    emptyWeight: d.emptyWeight, maxWeight: d.maxWeight, volumeUnit: d.volumeUnit as F["volumeUnit"], maxVolume: d.maxVolume,
    onlyOneExpiry: d.onlyOneExpiry, onlyOneProductionDate: d.onlyOneProductionDate, onlyOneLot: d.onlyOneLot, onlyOneSku: d.onlyOneSku, onlyOneClient: d.onlyOneClient,
    onlyOneOrder: d.onlyOneOrder, onlyOneJob: d.onlyOneJob, suitableForParentLp: d.suitableForParentLp, useForAiJob: d.useForAiJob,
    customFields: { ...((d.customFields ?? {}) as Record<string, string | boolean | null>) },
  };
}

function Body({ initial, detail, onDone, onCancel, onDirtyChange }: { readonly initial: F; readonly detail: LpTypeDetail | null; readonly onDone: () => void; readonly onCancel: () => void; readonly onDirtyChange: (d: boolean) => void }) {
  const formRef = React.useRef<UseFormReturn<F> | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const editId = detail?.id ?? null;
  const numberLocked = detail && detail.lpCount > 0 ? `Locked: ${detail.lpCount.toLocaleString("en-US")} LP numbers already use it` : null;
  const guard = useWizardGuard();
  const perms = usePagePerms("settings.lp_types", ["custom_field_management"] as const);
  const canManage = perms.custom_field_management;
  const steps = React.useMemo<readonly WizardStep<F>[]>(() => [
    { key: "general", label: "General", icon: Ruler, schema: guard.guard(lpTypeGeneralSchema, (p) => GENERAL_KEYS.has(p)), render: ({ form }) => { formRef.current = form; return <GeneralStep form={form} editId={editId} numberLocked={numberLocked} guard={guard} />; } },
    { key: "parameters", label: "Parameters", icon: ShieldCheck, isOptional: true, render: ({ form }) => { formRef.current = form; return <ParametersStep />; } },
    { key: "other", label: "Other info", icon: FileText, schema: guard.guard(lpTypeOtherSchema, (p) => p === "description" || p.startsWith("customFields")), render: ({ form }) => { formRef.current = form; return <OtherStep form={form} next={detail?.nextSequence ?? 1} canManage={canManage} />; } },
    // `guard` is stable for the life of the body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [editId, numberLocked, detail?.nextSequence, canManage]);
  const submit = async (values: F) => {
    guard.dismissBanner();
    try {
      const { data } = await apiRequest<{ code: string }>(editId ? `/api/lp-types/${editId}` : "/api/lp-types", { method: editId ? "PATCH" : "POST", body: { ...values, version: detail?.version } });
      toast.success("Success", editId ? `LP type ${data.code} updated.` : `LP type ${data.code} created.`);
      onDone();
    } catch (error) {
      if (isApiError(error) && error.code === "CONFLICT") setConflict(true);
      const routed = guard.handleServerError(error, values);
      if (!routed && formRef.current) applyServerFieldErrors(formRef.current, error);
      toast.error("Couldn't save the LP type", apiErrorMessage(error), { duration: ERROR_TOAST_MS });
      throw error;
    }
  };
  return (
    <div ref={guard.rootRef} className="flex flex-col gap-3">
      {guard.banner && !conflict ? <Callout variant="error" title="Couldn't save the LP type" onDismiss={guard.dismissBanner}>{guard.banner}</Callout> : null}
      {conflict ? <Callout variant="attention" title="This record changed since you opened it" action={<Button size="sm" onClick={() => window.location.reload()}>Reload</Button>}>Someone else saved this LP type. Reload to see their changes.</Callout> : null}
      <Wizard<F> steps={steps} variant="drawer" mode={editId ? "free" : "linear"} defaultValues={initial} draftScope={false} guardUnsaved={false} onDirtyChange={onDirtyChange} submitLabel={editId ? "Save" : "Create LP type"} onCancel={onCancel} onComplete={submit} />
    </div>
  );
}

export function LpTypeWizardDrawer({ open, onOpenChange, editId, defaultWarehouseId, onSaved }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly editId: string | null; readonly defaultWarehouseId: string | null; readonly onSaved: () => void }) {
  const [dirty, setDirty] = React.useState(false);
  const detail = useApiQuery<LpTypeDetail>(["lp-type", editId ?? ""], open && editId ? `/api/lp-types/${editId}` : null, { staleTime: 0 });
  const close = () => { setDirty(false); onOpenChange(false); };
  const initial = editId ? (detail.data ? detailToLpTypeForm(detail.data.data) : null) : { ...LP_TYPE_DEFAULTS, warehouseId: defaultWarehouseId ?? "" };
  return (
    <Drawer open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())} dirty={dirty} width={60} bodyClassName="pb-0"
      title={editId ? `Edit LP type ${detail.data?.data.code ?? ""}`.trim() : "Create LP type"}
      description={editId ? "Every step is editable; Save applies all of them." : "General, then parameters and other info."}>
      {editId && detail.isError ? (
        <EmptyState title="Couldn't load this LP type" description={detail.error.message} action={<Button onClick={() => void detail.refetch()}>Retry</Button>} />
      ) : !initial ? (
        <div className="flex flex-col gap-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-64 w-full" /></div>
      ) : (
        <Body key={`${editId ?? "new"}-${detail.dataUpdatedAt}`} initial={initial} detail={editId ? detail.data?.data ?? null : null} onDirtyChange={setDirty} onCancel={close}
          onDone={() => { setDirty(false); onSaved(); onOpenChange(false); }} />
      )}
    </Drawer>
  );
}
