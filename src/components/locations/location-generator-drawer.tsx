"use client";

/**
 * Bulk Location Generator (beyond Logiwa, which only offers Excel import): a pattern
 * builder (zone · aisles × racks × levels × positions) with a live preview of the count,
 * the first 20 codes and collisions with existing locations. Creates in one transaction;
 * above 500 locations the run continues in the background and notifies when done.
 */
import * as React from "react";
import { z } from "zod";
import { AlertTriangle, CheckCircle2, Sparkles, Wand2 } from "lucide-react";
import { apiRequest, isApiError } from "@/lib/api-client";
import { applyServerFieldErrors } from "@/lib/query-client";
import { AREA_TYPES, LOCATION_TYPES } from "@/lib/enums";
import {
  expandPattern, generatorCount, generatorSchema, GENERATOR_BACKGROUND_ABOVE, GENERATOR_DEFAULTS, GENERATOR_MAX, GENERATOR_PREVIEW_COUNT, GENERATOR_SEPARATORS, rangeError,
  type GeneratorInput,
} from "@/lib/grid-defs/facility/location-generator";
import { plural } from "@/lib/grid-defs/facility/common";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { Drawer } from "@/components/ui/drawer";
import { FieldLabel, Form, FormGrid, FormSection, useZodForm } from "@/components/ui/form";
import { Spinner } from "@/components/ui/spinner";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { ComboField, enumSelectOptions, NumberField, SelectField, TextInput } from "@/components/facility/form-controls";
import { useLookups, useWarehouseOptions, apiErrorMessage } from "@/components/facility/facility-shared";

type G = GeneratorInput;

interface Preview {
  readonly total: number;
  readonly sample: readonly string[];
  readonly collisions: readonly string[];
  readonly collisionCount: number;
  readonly createCount: number;
}

const SEPARATOR_LABELS: Record<(typeof GENERATOR_SEPARATORS)[number], string> = { "-": "Dash (A-01-1)", ".": "Dot (A.01.1)", "": "None (A011)", _: "Underscore (A_01_1)" };

function RangeInput({ label, value, onChange, error, hint, required }: { readonly label: string; readonly value: { from: string; to: string }; readonly onChange: (v: { from: string; to: string }) => void; readonly error: string | null; readonly hint: string; readonly required?: boolean }) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-1.5" data-field={label}>
      <FieldLabel htmlFor={`${id}-from`} required={required}>{label}</FieldLabel>
      <div className="flex items-center gap-1.5">
        <TextField id={`${id}-from`} aria-label={`${label} from`} value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value.toUpperCase() })} invalid={Boolean(error)} aria-invalid={error ? true : undefined} maxLength={4} placeholder="From" className="text-center" />
        <span className="text-faint" aria-hidden>–</span>
        <TextField aria-label={`${label} to`} value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value.toUpperCase() })} invalid={Boolean(error)} maxLength={4} placeholder="To" className="text-center" />
      </div>
      {error ? <p role="alert" className="text-[11px] text-danger">{error}</p> : <p className="text-[11px] text-faint">{hint}</p>}
    </div>
  );
}

export function LocationGeneratorDrawer({ open, onOpenChange, defaultWarehouseId, onCreated }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly defaultWarehouseId: string | null; readonly onCreated: () => void }) {
  const form = useZodForm(generatorSchema, { ...GENERATOR_DEFAULTS, warehouseId: defaultWarehouseId ?? "" });
  const warehouses = useWarehouseOptions();
  const values = form.watch();
  const zones = useLookups("location_zone", values.warehouseId || null);
  const groups = useLookups("location_group", values.warehouseId || null);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [retryTick, setRetryTick] = React.useState(0);
  const [skipExisting, setSkipExisting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);

  const localCodes = React.useMemo(() => expandPattern({ zone: values.zone ?? "", separator: values.separator ?? "-", aisles: values.aisles, racks: values.racks, levels: values.levels, positions: values.positions }), [values.zone, values.separator, values.aisles, values.racks, values.levels, values.positions]);
  const localCount = generatorCount({ zone: values.zone ?? "", separator: values.separator ?? "-", aisles: values.aisles, racks: values.racks, levels: values.levels, positions: values.positions });
  const errors = {
    aisles: rangeError(values.aisles, "Aisle", true),
    racks: rangeError(values.racks, "Rack", true),
    levels: rangeError(values.levels, "Level", false),
    positions: rangeError(values.positions, "Position", false),
  };
  const shownErrors = submitted ? errors : { aisles: values.aisles.from && values.aisles.to ? errors.aisles : null, racks: values.racks.from && values.racks.to ? errors.racks : null, levels: errors.levels, positions: errors.positions };
  const valid = Object.values(errors).every((e) => !e) && localCount > 0 && localCount <= GENERATOR_MAX && Boolean(values.warehouseId);
  const key = JSON.stringify({ w: values.warehouseId, z: values.zone, s: values.separator, a: values.aisles, r: values.racks, l: values.levels, p: values.positions });

  // Debounced server preview (collisions need the database).
  React.useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (!open || !valid) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      setPreviewing(true);
      try {
        const parsed = generatorSchema.safeParse(form.getValues());
        if (!parsed.success) return;
        const { data } = await apiRequest<Preview>("/api/locations/generator/preview", { method: "POST", body: parsed.data });
        if (!cancelled) setPreview(data);
      } catch (error) {
        if (!cancelled) setPreviewError(isApiError(error) && error.code === "FORBIDDEN" ? "You don't have permission to create locations." : "Couldn't check for existing codes.");
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [key, open, valid, form, retryTick]);

  const close = () => { form.reset({ ...GENERATOR_DEFAULTS, warehouseId: defaultWarehouseId ?? "" }); setPreview(null); setPreviewError(null); setSubmitted(false); setSkipExisting(false); onOpenChange(false); };
  // Submit only after the collision check has succeeded for the current pattern.
  const checked = preview !== null && !previewError;
  const blocked = !checked || (preview.collisionCount > 0 && !skipExisting);
  const blockedReason = previewError ? "Retry the collision check first" : !checked ? (valid ? "Checking for existing codes…" : undefined) : blocked ? "Skip existing codes or change the pattern" : undefined;
  const createCount = preview ? (skipExisting ? preview.createCount : preview.collisionCount > 0 ? 0 : preview.total) : localCount;

  const onSubmit = async (spec: z.output<typeof generatorSchema>) => {
    if (blocked) return;
    try {
      const { data } = await apiRequest<{ created: number; queued?: number; skipped: number; collisions: readonly string[]; background: boolean }>("/api/locations/generator", { method: "POST", body: { ...spec, skipExisting } });
      if (data.background) toast.info("Generating in the background", `${plural(data.queued ?? 0, "location")} are being created. We'll notify you when it's done.`);
      else if (data.created === 0 && data.skipped > 0) { toast.warning("Nothing created", `${plural(data.skipped, "code")} already exist. Turn on "Skip existing codes" to create the rest.`); return; }
      else toast.success("Success", `${plural(data.created, "location")} created${data.skipped ? ` · ${data.skipped} existing skipped` : ""}.`);
      onCreated();
      close();
    } catch (error) {
      applyServerFieldErrors(form, error);
      toast.error("Couldn't generate locations", apiErrorMessage(error));
    }
  };

  return (
    <Drawer open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())} width={60} dirty={form.formState.isDirty}
      title={<span className="flex items-center gap-2"><Wand2 className="h-4 w-4 text-primary" aria-hidden />Generate locations</span>}
      description="Build a range of codes from a pattern instead of typing them one by one.">
      <Form form={form} onSubmit={onSubmit} onInvalid={() => setSubmitted(true)} className="flex flex-col gap-5">
        <FormSection title="Pattern" description="Each range is letters (A–F) or numbers (01–10). Leading zeros are kept.">
          <FormGrid>
            <ComboField<G> name="warehouseId" label="Warehouse" required options={warehouses.options} onValueChange={() => { form.setValue("locationZoneId", null); form.setValue("locationGroupId", null); }} />
            <TextInput<G> name="zone" label="Zone / code prefix" maxLength={10} placeholder="e.g. P" transform={(v) => v.toUpperCase()} info="Optional first segment of every code, usually the zone (P → P-A-01-1)" />
            <RangeInput label="Aisles" required value={values.aisles} onChange={(v) => form.setValue("aisles", v, { shouldDirty: true })} error={shownErrors.aisles} hint="e.g. A – F" />
            <RangeInput label="Racks" required value={values.racks} onChange={(v) => form.setValue("racks", v, { shouldDirty: true })} error={shownErrors.racks} hint="e.g. 01 – 10" />
            <RangeInput label="Levels" value={values.levels} onChange={(v) => form.setValue("levels", v, { shouldDirty: true })} error={shownErrors.levels} hint="Optional, e.g. 1 – 4" />
            <RangeInput label="Positions" value={values.positions} onChange={(v) => form.setValue("positions", v, { shouldDirty: true })} error={shownErrors.positions} hint="Optional, e.g. A – B" />
            <SelectField<G> name="separator" label="Separator" options={GENERATOR_SEPARATORS.map((s) => ({ value: s, label: SEPARATOR_LABELS[s] }))} />
          </FormGrid>
        </FormSection>
        <FormSection title="Attributes" description="Applied to every generated location. You can edit any of them later.">
          <FormGrid>
            <SelectField<G> name="locationType" label="Location type" required options={enumSelectOptions(LOCATION_TYPES)} />
            <SelectField<G> name="areaType" label="Area type" required options={enumSelectOptions(AREA_TYPES)} />
            <SelectField<G> name="locationZoneId" label="Location zone" clearable options={zones.options} disabled={!values.warehouseId} placeholder={values.warehouseId ? "Select zone" : "Select a warehouse first"} />
            <SelectField<G> name="locationGroupId" label="Location group" clearable options={groups.options} disabled={!values.warehouseId} placeholder={values.warehouseId ? "Select group" : "Select a warehouse first"} />
            <NumberField<G> name="walkingPathStart" label="Walking path starts at" max={999999} />
            <NumberField<G> name="walkingPathStep" label="Walking path step" max={1000} info="Added for each location, in aisle → rack → level → position order" />
          </FormGrid>
        </FormSection>

        <section aria-live="polite" className="rounded-xl border border-border bg-surface-sunken/50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden />
              <h3 className="text-[14px] font-semibold text-foreground">Preview</h3>
              {previewing ? <Spinner className="h-3.5 w-3.5" label="Checking codes" /> : null}
            </div>
            <span className={cn("text-[22px] font-semibold tabular-nums tracking-tight", localCount > GENERATOR_MAX ? "text-danger" : "text-foreground")}>
              {localCount.toLocaleString("en-US")}<span className="ml-1 text-[12px] font-normal text-secondary">{localCount === 1 ? "location" : "locations"}</span>
            </span>
          </div>
          {localCount > 0 && valid ? (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={`First ${GENERATOR_PREVIEW_COUNT} codes`}>
              {localCodes.slice(0, GENERATOR_PREVIEW_COUNT).map((g) => {
                const clash = preview?.collisions.includes(g.code);
                return <li key={g.code} className={cn("rounded-md border px-1.5 py-0.5 font-mono text-[11px]", clash ? "border-danger/40 bg-danger-soft text-danger line-through" : "border-border bg-surface text-body")}>{g.code}</li>;
              })}
              {localCount > GENERATOR_PREVIEW_COUNT ? <li className="px-1.5 py-0.5 text-[11px] text-faint">+{(localCount - GENERATOR_PREVIEW_COUNT).toLocaleString("en-US")} more</li> : null}
            </ul>
          ) : <p className="mt-2 text-[12px] text-secondary">{values.warehouseId ? "Fill the aisle and rack ranges to see the codes." : "Pick a warehouse to start."}</p>}
          {previewError ? (
            <Callout variant="error" className="mt-3" title={previewError} action={<Button size="sm" variant="secondary" onClick={() => setRetryTick((t) => t + 1)}>Retry</Button>}>
              Creating is paused until the collision check succeeds.
            </Callout>
          ) : null}
          {preview && preview.collisionCount > 0 ? (
            <Callout variant="attention" className="mt-3" title={`${plural(preview.collisionCount, "code")} already exist`}>
              <span className="font-mono text-[11px]">{preview.collisions.slice(0, 8).join(", ")}{preview.collisionCount > 8 ? "…" : ""}</span>
              <div className="mt-2"><Checkbox checked={skipExisting} onCheckedChange={(v) => setSkipExisting(v === true)} label={`Skip existing codes and create the other ${preview.createCount.toLocaleString("en-US")}`} /></div>
            </Callout>
          ) : preview && preview.total > 0 ? (
            <p className="mt-3 flex items-center gap-1.5 text-[12px] text-success"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />No collisions with existing locations.</p>
          ) : null}
          {createCount > GENERATOR_BACKGROUND_ABOVE ? <p className="mt-2 flex items-center gap-1.5 text-[12px] text-secondary"><AlertTriangle className="h-3.5 w-3.5 text-warning" aria-hidden />More than {GENERATOR_BACKGROUND_ABOVE} locations: the run continues in the background and you&apos;ll get a notification.</p> : null}
        </section>

        <div className="sticky bottom-0 -mx-5 -mb-4 flex items-center justify-end gap-2 border-t border-border bg-surface px-5 py-3">
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={form.formState.isSubmitting || (valid && blocked) || (submitted && !valid)} title={valid ? blockedReason : undefined}>
            {form.formState.isSubmitting ? <Spinner className="h-3.5 w-3.5" label="Creating" /> : null}
            {createCount > 0 ? `Create ${plural(createCount, "location")}` : "Create locations"}
          </Button>
        </div>
      </Form>
    </Drawer>
  );
}
