"use client";

/**
 * Job-type wizard steps (Logiwa 02 §6): General, Templates, Settings (per operation type),
 * Conditions (order / location / SKU / LP / product), Grouping.
 */
import * as React from "react";
import type { UseFormReturn } from "react-hook-form";
import type { z } from "zod";
import { Checkbox } from "@/components/ui/checkbox";
import { Callout } from "@/components/ui/callout";
import { FormField, FormSection } from "@/components/ui/form";
import { InfoTip } from "@/components/ui/info-tip";
import { NumberInput } from "@/components/ui/number-input";
import { RadioCards } from "@/components/ui/radio-cards";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { YesNoToggle } from "@/components/ui/yes-no-toggle";
import { WarehouseSelect } from "@/components/shared";
import { useApiQuery } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { JOB_ORDER_SCOPES, jobTypeSettingsSchema, type JobTypeSettings } from "@/lib/domain-types";
import {
  COUNT_METHOD_OPTIONS, GROUPING_OPTIONS, JOB_TEMPLATE_DEFS, LOCATION_CONDITION_FIELDS, LP_CONDITION_FIELDS, PICKING_FLAG_DEFS,
  PICKING_METHOD_OPTIONS, PRODUCT_CONDITION_FIELDS,
} from "@/lib/grid-defs/jobs/conditions";
import {
  POST_PICKING_FLOW, RETAILER_FLOW_TYPES, RETAILER_LABEL_PRINT_OPTIONS, RETAILER_TEMPLATE, UCC_LABEL_SCANNING_TYPES, retailerOf,
  type JobTypeSettingsInput, type RetailerSettings, type jobTypeInputSchema,
} from "@/lib/grid-defs/jobs/forms";
import type { WaveRuleOptions } from "@/server/repositories/wave-rules-options";
import { selectionFields } from "@/components/wave-rules/wave-rule-steps";
import { ConditionsEditor, OrderByEditor, SortableList } from "@/components/wave-rules/rule-editors";

export type JF = z.input<typeof jobTypeInputSchema>;
type Form = UseFormReturn<JF>;

export function defaultSettings(): JobTypeSettings {
  return jobTypeSettingsSchema.parse({});
}

/** Applies a template preset on top of the defaults (Templates step). */
export function applyTemplate(key: string): JobTypeSettings {
  const base = defaultSettings();
  const t = JOB_TEMPLATE_DEFS.find((d) => d.key === key);
  if (!t) return base;
  return { ...base, template: t.key, orderScope: t.orderScope, picking: { ...base.picking, ...t.picking }, batch: { ...base.batch, ...(t.batch ?? {}) } };
}

function settingsOf(form: Form): JobTypeSettings {
  return (form.watch("settings") as JobTypeSettings | undefined) ?? defaultSettings();
}

function setSettings(form: Form, next: JobTypeSettings | JobTypeSettingsInput): void {
  form.setValue("settings", next, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
}

/* ---------------------------------------------------------------- general */

export function GeneralStep({ form, isEdit }: { readonly form: Form; readonly isEdit: boolean }) {
  const op = form.watch("operationType");
  const warehouseId = form.watch("warehouseId");
  const algorithms = useApiQuery<readonly { id: string; name: string }[]>(["job-type-algorithms", warehouseId ?? ""], warehouseId ? "/api/job-types/algorithms" : null, { query: { warehouseId }, staleTime: 60_000 });
  const algos = React.useMemo(() => algorithms.data?.data ?? [], [algorithms.data]);
  const needsAlgo = op === "Picking" || op === "Work Order";
  // Logiwa auto-selects the warehouse's default algorithm.
  React.useEffect(() => {
    if (!needsAlgo || !warehouseId || algos.length === 0 || form.getValues("allocationAlgorithmId")) return;
    const pick = algos.find((a) => /default/i.test(a.name)) ?? algos[0];
    if (pick) form.setValue("allocationAlgorithmId", pick.id, { shouldDirty: true });
  }, [algos, needsAlgo, warehouseId, form]);
  const s = settingsOf(form);
  return (
    <section aria-label="General" className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <FormField<JF> name="code" label="Job type name" required>
          {(c) => <TextField {...c} value={(c.value as string | undefined) ?? ""} onChange={(e) => c.onChange(e.target.value)} placeholder="Enter job type name" maxLength={100} />}
        </FormField>
        <FormField<JF> name="warehouseId" label="Warehouse" required description={isEdit ? "The warehouse can't change after creation." : undefined}>
          {(c) => <WarehouseSelect id={c.id} value={(c.value as string | undefined) || null} onChange={(v) => { c.onChange(v ?? ""); form.setValue("allocationAlgorithmId", null, { shouldDirty: true }); }} invalid={c.invalid} disabled={isEdit} onBlur={c.onBlur} />}
        </FormField>
        <FormField<JF> name="operationType" label="Operation type" required>
          {(c) => <TextField id={c.id} value={String(c.value ?? "")} readOnly disabled aria-label="Operation type" />}
        </FormField>
        {op === "Replenishment" ? (
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1 text-[12px] font-semibold text-body">Replenishment algorithm method <InfoTip content="The algorithm selected on the Putaway Algorithms page is used for dynamic replenishment; this method orders the source stock." /></span>
            <SegmentedControl ariaLabel="Replenishment algorithm method" value={s.replenishment.algorithmMethod} onChange={(v) => setSettings(form, { ...s, replenishment: { ...s.replenishment, algorithmMethod: v } })} options={[{ value: "FEFO", label: "FEFO" }, { value: "FIFO", label: "FIFO" }, { value: "LIFO", label: "LIFO" }]} />
          </div>
        ) : (
          <FormField<JF> name="allocationAlgorithmId" label="Allocation algorithm" required={needsAlgo} description={!warehouseId ? "Choose a warehouse first." : algos.length === 0 && !algorithms.isPending ? "This warehouse has no active allocation algorithm." : undefined}>
            {(c) => <Select id={c.id} value={(c.value as string | null | undefined) ?? null} onChange={(v) => c.onChange(v)} invalid={c.invalid} disabled={!warehouseId} clearable={!needsAlgo} placeholder="Select allocation algorithm" options={algos.map((a) => ({ value: a.id, label: a.name }))} />}
          </FormField>
        )}
      </div>
      <FormField<JF> name="description" label="Description" required>
        {(c) => <Textarea id={c.id} value={(c.value as string | undefined) ?? ""} onChange={(e) => c.onChange(e.target.value)} onBlur={c.onBlur} placeholder="Enter your description" maxLength={300} rows={3} aria-invalid={c["aria-invalid"]} />}
      </FormField>
    </section>
  );
}

/* -------------------------------------------------------------- templates */

export function TemplatesStep({ form }: { readonly form: Form }) {
  const s = settingsOf(form);
  return (
    <FormSection title="Templates" description="A template presets the order scope, flags and batch size on the next step. You can still change every setting.">
      <RadioCards
        ariaLabel="Template"
        columns={3}
        value={s.template}
        onChange={(v) => setSettings(form, applyTemplate(v))}
        options={JOB_TEMPLATE_DEFS.map((t) => ({ value: t.key, title: t.key, description: t.description, badge: t.badge }))}
      />
    </FormSection>
  );
}

/* --------------------------------------------------------------- settings */

function Flag({ label, tip, value, onChange, disabled }: { readonly label: string; readonly tip?: string; readonly value: boolean; readonly onChange: (v: boolean) => void; readonly disabled?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2", disabled && "opacity-60")}>
      <span className="flex items-center gap-1 text-[13px] text-body">{label}{tip ? <InfoTip content={tip} /> : null}</span>
      <YesNoToggle value={value} onChange={onChange} disabled={disabled} ariaLabel={label} />
    </div>
  );
}

function BatchFields({ form }: { readonly form: Form }) {
  const s = settingsOf(form);
  const err = (form.formState.errors.settings as { batch?: { max?: { message?: string } } } | undefined)?.batch?.max?.message;
  return (
    <FormSection title="Batch size" description="How many orders (or items) one job may hold.">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-body">Limitation method</span>
          <Select aria-label="Limitation method" value={s.batch.method} onChange={(v) => setSettings(form, { ...s, batch: { ...s.batch, method: (v ?? "Nof Order") as JobTypeSettings["batch"]["method"] } })} options={[{ value: "Nof Order", label: "Number of orders" }, { value: "Nof Item", label: "Number of items" }]} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-body">Min</span>
          <NumberInput aria-label="Batch min" value={s.batch.min} min={0} max={10000} onChange={(v) => setSettings(form, { ...s, batch: { ...s.batch, min: v ?? 0 } })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-body">Max</span>
          <NumberInput aria-label="Batch max" value={s.batch.max} min={0} max={10000} invalid={Boolean(err)} onChange={(v) => setSettings(form, { ...s, batch: { ...s.batch, max: v ?? 0 } })} />
          {err ? <p className="text-[11px] font-medium text-danger" role="alert">{err}</p> : null}
        </div>
      </div>
    </FormSection>
  );
}

function MobileScreens({ form, only }: { readonly form: Form; readonly only?: "pickToLocation" }) {
  const s = settingsOf(form);
  const rows = [{ key: "pickAndSort" as const, label: "Pick and sort" }, { key: "pickToLocation" as const, label: "Pick to location" }].filter((r) => !only || r.key === only);
  return (
    <FormSection title="Select mobile screen type" description="Select the mobile screen(s) that will use this job type. The screens are mutually exclusive.">
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <span className="text-[13px] text-body">{r.label}</span>
            <SegmentedControl
              size="sm"
              ariaLabel={r.label}
              value={s.mobileScreens[r.key] ? "use" : "no"}
              onChange={(v) => setSettings(form, { ...s, mobileScreens: v === "use" ? { pickAndSort: r.key === "pickAndSort", pickToLocation: r.key === "pickToLocation" } : { ...s.mobileScreens, [r.key]: false } })}
              options={[{ value: "use", label: "Use" }, { value: "no", label: "Don't use" }]}
            />
          </div>
        ))}
      </div>
    </FormSection>
  );
}

function PickingSettings({ form }: { readonly form: Form }) {
  const s = settingsOf(form);
  const setFlag = (key: keyof JobTypeSettings["picking"], v: boolean) => {
    const picking = { ...s.picking, [key]: v };
    // Dependants switch off with their parent (One by one sorting / Disable tote scanning need sorting).
    for (const f of PICKING_FLAG_DEFS) if (f.requires && !picking[f.requires]) picking[f.key] = false;
    if (key === "onlyPick" && v) picking.onlyPack = false;
    if (key === "onlyPack" && v) picking.onlyPick = false;
    setSettings(form, { ...s, picking });
  };
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Order scope" description="Which orders this job type accepts.">
        <RadioCards ariaLabel="Order scope" columns={3} value={s.orderScope} onChange={(v) => setSettings(form, { ...s, orderScope: v })} options={JOB_ORDER_SCOPES.map((o) => ({ value: o, title: o }))} />
      </FormSection>
      <RetailerFields form={form} />
      <FormSection title="Picking flow">
        <div className="grid gap-2 md:grid-cols-2">
          {PICKING_FLAG_DEFS.map((f) => {
            const blocked = f.requires && !s.picking[f.requires] ? `Turn on "${PICKING_FLAG_DEFS.find((x) => x.key === f.requires)?.label}" first` : null;
            return <Flag key={f.key} label={f.label} tip={blocked ? `${f.tip} ${blocked}.` : f.tip} value={s.picking[f.key]} disabled={Boolean(blocked)} onChange={(v) => setFlag(f.key, v)} />;
          })}
        </div>
      </FormSection>
      <BatchFields form={form} />
      <MobileScreens form={form} />
    </div>
  );
}

const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: v }));

/**
 * Retailer Flow Type, UCC Label Scanning Type and Default Retailer Label Print Option (Logiwa 02 §6).
 * Shown for All Orders and the Retailer Compliance template; disabled until a retailer flow applies.
 */
function RetailerFields({ form }: { readonly form: Form }) {
  const s = settingsOf(form);
  const r = retailerOf(s);
  const isRetailer = s.template === RETAILER_TEMPLATE;
  if (!isRetailer && s.orderScope !== "All Orders") return null;
  const postPicking = isRetailer && r.flowType === POST_PICKING_FLOW;
  const set = (patch: Partial<RetailerSettings>) => {
    const next: RetailerSettings = { ...r, ...patch };
    // Scanning / print options only exist for post-picking UCC generation.
    if (next.flowType !== POST_PICKING_FLOW) { next.uccLabelScanningType = "None"; next.defaultLabelPrintOption = "None"; }
    setSettings(form, { ...s, retailer: next } as JobTypeSettingsInput);
  };
  const flowReason = isRetailer ? undefined : `Choose the "${RETAILER_TEMPLATE}" template to use a retailer flow.`;
  const uccReason = postPicking ? undefined : "Available with Retailer Post-Picking UCC Generation.";
  const field = (label: string, tip: string, reason: string | undefined, control: React.ReactNode) => (
    <div className={cn("flex flex-col gap-1", reason && "opacity-70")} title={reason}>
      <span className="flex items-center gap-1 text-[12px] font-semibold text-body">{label}<InfoTip content={reason ? `${tip} ${reason}` : tip} /></span>
      {control}
    </div>
  );
  return (
    <FormSection title="Retailer compliance" description="UCC-128 label flow for retailer (B2B) orders picked with this job type.">
      <div className="grid gap-3 md:grid-cols-3">
        {field("Retailer flow type", "When UCC labels are generated for retailer orders: before picking, or after picking when the parent LP is scanned.", flowReason,
          <Select aria-label="Retailer flow type" value={r.flowType} disabled={!isRetailer} options={opts(RETAILER_FLOW_TYPES)} onChange={(v) => set({ flowType: (v ?? "None") as RetailerSettings["flowType"] })} />)}
        {field("UCC label scanning type", "What the packer scans to confirm a UCC label.", uccReason,
          <Select aria-label="UCC label scanning type" value={r.uccLabelScanningType} disabled={!postPicking} options={opts(UCC_LABEL_SCANNING_TYPES)} onChange={(v) => set({ uccLabelScanningType: (v ?? "None") as RetailerSettings["uccLabelScanningType"] })} />)}
        {field("Default retailer label print option", "For orders using Retailer Post-Picking UCC Generation, scanning the Parent LP Number will automatically generate UCC labels based on this default setting.", uccReason,
          <Select aria-label="Default retailer label print option" value={r.defaultLabelPrintOption} disabled={!postPicking} options={opts(RETAILER_LABEL_PRINT_OPTIONS)} onChange={(v) => set({ defaultLabelPrintOption: (v ?? "None") as RetailerSettings["defaultLabelPrintOption"] })} />)}
      </div>
    </FormSection>
  );
}

const COUNT_FLAGS: readonly { readonly key: keyof JobTypeSettings["count"]; readonly label: string; readonly tip: string; readonly requires?: keyof JobTypeSettings["count"] }[] = [
  { key: "oneByOneCount", label: "One by one count", tip: "Each unit is scanned during the count." },
  { key: "autoUpdateNoDifferenceLines", label: "Auto-update no-difference count lines", tip: "Lines whose count matches the system are approved automatically." },
  { key: "instantCount", label: "Instant count", tip: "Counts can be started from the handheld without a count plan." },
  { key: "lockLocationForInstantCount", label: "Lock location for instant count", tip: "Blocks the location while an instant count runs.", requires: "instantCount" },
  { key: "autoFillTrackingAttributes", label: "Auto fill tracking attributes", tip: "Lot, expiry and serials are pre-filled from the system stock." },
];

const REPLEN_FLAGS: readonly { readonly key: keyof JobTypeSettings["replenishment"]; readonly label: string; readonly tip: string }[] = [
  { key: "allowExceedTaskQuantity", label: "Allow exceed task quantity", tip: "Pickers may move more than the task quantity (full cases)." },
  { key: "updateTaskQuantityIfLessPicked", label: "Update task quantity if less picked", tip: "The put task shrinks to what was actually picked." },
  { key: "pickFullPack", label: "Pick full pack", tip: "Only full packs are picked from the source." },
  { key: "zoneBased", label: "Zone based replenishment", tip: "Sources are searched in the target's zone first." },
  { key: "allowHigherPackTypeConversion", label: "Allow higher pack type-UOM conversion", tip: "Cases may be broken into units at the pick face." },
  { key: "locationGroupBased", label: "Location group based replenishment", tip: "Replenishes per location group instead of per location." },
  { key: "onlyPickFullLp", label: "Only pick full LP", tip: "Whole LPs move; no partial LP picks." },
  { key: "allowScanningAnotherPutLocation", label: "Allow scanning another put location", tip: "The putter may choose another target location." },
  { key: "allowSuggestAnother", label: "Allow suggest another", tip: "The handheld can suggest another source when one is empty." },
  { key: "enableLpSwap", label: "Enable LP swap", tip: "The whole source LP replaces the empty LP at the pick face." },
];

export function SettingsStep({ form }: { readonly form: Form }) {
  const op = form.watch("operationType");
  const s = settingsOf(form);
  if (op === "Picking") return <PickingSettings form={form} />;
  if (op === "Count") {
    return (
      <FormSection title="Count settings">
        <div className="grid gap-2 md:grid-cols-2">
          {COUNT_FLAGS.map((f) => {
            const blocked = Boolean(f.requires && !s.count[f.requires]);
            return <Flag key={f.key} label={f.label} tip={f.tip} value={s.count[f.key]} disabled={blocked} onChange={(v) => {
              const count = { ...s.count, [f.key]: v };
              if (!count.instantCount) count.lockLocationForInstantCount = false;
              setSettings(form, { ...s, count });
            }} />;
          })}
        </div>
      </FormSection>
    );
  }
  if (op === "Replenishment") {
    return (
      <div className="flex flex-col gap-5">
        <FormSection title="Replenishment flow">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold text-body">Replenishment flow</span>
              <SegmentedControl ariaLabel="Replenishment flow" value={s.replenishment.flow} onChange={(v) => setSettings(form, { ...s, replenishment: { ...s.replenishment, flow: v } })} options={[{ value: "Pick & Put", label: "Pick & put" }, { value: "Direct Put", label: "Direct put" }]} />
              <p className="text-[11px] text-faint">{s.replenishment.flow === "Pick & Put" ? "Pick phase to a cart or LP, then a put phase to the pick face." : "One task moves stock straight to the pick face."}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold text-body">Replenishment type</span>
              <SegmentedControl ariaLabel="Replenishment type" value={s.replenishment.type} onChange={(v) => setSettings(form, { ...s, replenishment: { ...s.replenishment, type: v } })} options={[{ value: "Dynamic", label: "Dynamic" }, { value: "Static", label: "Static" }]} />
              <p className="text-[11px] text-faint">{s.replenishment.type === "Dynamic" ? "Targets come from open demand at the pick faces." : "Targets come from each product's min / max replenishment levels."}</p>
            </div>
          </div>
        </FormSection>
        <FormSection title="Settings">
          <div className="grid gap-2 md:grid-cols-2">
            {REPLEN_FLAGS.map((f) => <Flag key={f.key} label={f.label} tip={f.tip} value={Boolean(s.replenishment[f.key])} onChange={(v) => setSettings(form, { ...s, replenishment: { ...s.replenishment, [f.key]: v } })} />)}
          </div>
        </FormSection>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Work order settings">
        <div className="grid gap-2 md:grid-cols-2">
          <Flag label="Picking & kitting" tip="Kitting tasks are created after the components are picked. Turn off when components are already at the kitting station." value={s.workOrder.pickingAndKitting} onChange={(v) => setSettings(form, { ...s, workOrder: { pickingAndKitting: v } })} />
          <Flag label="Override for last job" tip={PICKING_FLAG_DEFS[0]?.tip} value={s.picking.overrideForLastJob} onChange={(v) => setSettings(form, { ...s, picking: { ...s.picking, overrideForLastJob: v } })} />
        </div>
      </FormSection>
      <BatchFields form={form} />
      <MobileScreens form={form} only="pickToLocation" />
    </div>
  );
}

/* ------------------------------------------------------------- conditions */

type ConditionKey = "conditions" | "locationConditions" | "skuConditions" | "sourceLocationConditions" | "destinationLocationConditions" | "lpConditions" | "productConditions";

function Conditions({ form, name, title, description, fields }: { readonly form: Form; readonly name: ConditionKey; readonly title: string; readonly description?: string; readonly fields: Parameters<typeof ConditionsEditor>[0]["fields"] }) {
  const err = (form.formState.errors as Record<string, { message?: string } | undefined>)[name]?.message;
  return (
    <FormSection title={title} description={description}>
      <ConditionsEditor scope={`job-type-${name}`} fields={fields} value={(form.watch(name) as JF["conditions"]) ?? []} addLabel="Add condition" emptyText="No conditions: applies to all." onChange={(next) => form.setValue(name, next, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })} />
      {err ? <p className="text-[11px] font-medium text-danger" role="alert">{err}</p> : null}
    </FormSection>
  );
}

export function PickingConditionsStep({ form, options }: { readonly form: Form; readonly options: WaveRuleOptions | undefined }) {
  const fields = React.useMemo(() => selectionFields(options), [options]);
  return (
    <div className="flex flex-col gap-5">
      <Conditions form={form} name="conditions" title="Conditions" description="Orders must match every condition to join a job of this type." fields={fields} />
      <FormSection title="Order by picking method" description="Task sequence inside the job. Drag to change the precedence.">
        <OrderByEditor options={PICKING_METHOD_OPTIONS} value={form.watch("orderBy") ?? []} onChange={(next) => form.setValue("orderBy", next, { shouldDirty: true })} placeholder="Search and select picking method" emptyText="No picking method: tasks follow the walking path." />
      </FormSection>
    </div>
  );
}

export function CountLocationStep({ form }: { readonly form: Form }) {
  return (
    <div className="flex flex-col gap-5">
      <Callout variant="info" title="Location count plans only">The following conditions apply only to location count plans. Location count conditions cannot be combined with SKU count conditions within the same count plan.</Callout>
      <Conditions form={form} name="locationConditions" title="Location count conditions" fields={LOCATION_CONDITION_FIELDS} />
      <FormSection title="Order by count method">
        <OrderByEditor options={COUNT_METHOD_OPTIONS} value={form.watch("orderBy") ?? []} onChange={(next) => form.setValue("orderBy", next, { shouldDirty: true })} placeholder="Search and select count method" emptyText="No count method: tasks follow the walking path." />
      </FormSection>
    </div>
  );
}

export function CountSkuStep({ form }: { readonly form: Form }) {
  return (
    <div className="flex flex-col gap-5">
      <Callout variant="info" title="SKU count plans only">The following conditions apply only to SKU count plans. SKU count conditions cannot be combined with location count conditions within the same count plan.</Callout>
      <Conditions form={form} name="skuConditions" title="SKU count conditions" fields={PRODUCT_CONDITION_FIELDS} />
    </div>
  );
}

export function ReplenishmentConditionsStep({ form }: { readonly form: Form }) {
  return (
    <div className="flex flex-col gap-5">
      <Conditions form={form} name="destinationLocationConditions" title="Destination location conditions" description="Pick faces this job type refills." fields={LOCATION_CONDITION_FIELDS} />
      <Conditions form={form} name="sourceLocationConditions" title="Source location conditions" description="Reserve locations stock may come from." fields={LOCATION_CONDITION_FIELDS} />
      <Conditions form={form} name="lpConditions" title="LP conditions" fields={LP_CONDITION_FIELDS} />
      <Conditions form={form} name="productConditions" title="Product conditions" fields={PRODUCT_CONDITION_FIELDS} />
    </div>
  );
}

export function WorkOrderConditionsStep({ form }: { readonly form: Form }) {
  return <Conditions form={form} name="productConditions" title="Conditions" description="Work orders whose kit matches every condition use this job type." fields={PRODUCT_CONDITION_FIELDS} />;
}

/* --------------------------------------------------------------- grouping */

export function GroupingStep({ form }: { readonly form: Form }) {
  const selected = (form.watch("groupBy") as string[] | null | undefined) ?? [];
  const [order, setOrder] = React.useState(() => [...selected, ...GROUPING_OPTIONS.map((o) => o.value).filter((v) => !selected.includes(v))]);
  const label = (v: string) => GROUPING_OPTIONS.find((o) => o.value === v)?.label ?? v;
  const emit = (ids: readonly string[], sel: ReadonlySet<string>) => form.setValue("groupBy", ids.filter((x) => sel.has(x)), { shouldDirty: true });
  const sel = new Set(selected);
  return (
    <FormSection title="Group by" description="Select a picking method group: orders sharing these values go into the same job. The order sets the precedence.">
      <SortableList
        ariaLabel="Group by"
        items={order}
        getId={(v) => v}
        onReorder={(next) => { setOrder(next); emit(next, sel); }}
        renderItem={(v) => (
          <Checkbox checked={sel.has(v)} label={label(v)} onCheckedChange={(c) => { const n = new Set(sel); if (c === true) n.add(v); else n.delete(v); emit(order, n); }} />
        )}
      />
    </FormSection>
  );
}
