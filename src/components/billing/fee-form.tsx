"use client";

/**
 * Inline Create / Edit Fee form (08 §Edit Billing Form): 8 operation type cards, storage
 * calculation type, the operation-dependent Fee By → Charge By matrix, VAS type, Split
 * Month settings, min / max price toggles, Charge If conditions (Add Condition modal with
 * the full field list) and tiered charges "For each unit from – to". A live preview prices
 * a sample quantity with the graduated tiers.
 */
import * as React from "react";
import { ArrowDownToLine, Boxes, CalendarClock, Hammer, PackageOpen, Plus, RotateCcw, Sparkles, Trash2, Truck, Warehouse, X } from "lucide-react";
import { useFieldArray, useWatch, type UseFormReturn } from "react-hook-form";
import { BILLING_OPERATION_TYPES, BILLING_CALCULATION_TYPES } from "@/lib/enums";
import { z } from "zod";
import {
  CALC_TYPE_TIPS, CHARGE_IF_BY_KEY, CHARGE_IF_GROUPS_BY_OP, chargeIfFieldsFor, COMPARATOR_LABELS, FEE_DEFAULTS, OPERATION_META, PRICING_MODE_META, PRICING_MODES, SPLIT_TIPS, chargeByOptions, chargeUnit, comparatorsFor, conditionText, feeByOptions, feeSchema,
  isLookupChargeIf, priceFormula, priceQuantity, type FeeInput, type OperationType, type PricingMode,
} from "@/lib/grid-defs/organization/billing";
import { apiRequest, isApiError } from "@/lib/api-client";
import { applyServerFieldErrors, useApiQuery } from "@/lib/query-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Form, FormField, FormGrid, FormSection, SubmitBar, useZodForm } from "@/components/ui/form";
import { InfoTip } from "@/components/ui/info-tip";
import { NumberInput } from "@/components/ui/number-input";
import { RadioCards } from "@/components/ui/radio-cards";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { YesNoToggle } from "@/components/ui/yes-no-toggle";
import type { FeeView } from "@/server/repositories/billing";
import { moneyRail, useVasTypes } from "./billing-shared";

type F = FeeInput;
type Condition = F["conditions"] extends (infer C)[] | undefined ? C : never;

const OP_ICONS: Readonly<Record<OperationType, React.ComponentType<{ className?: string }>>> = {
  "Shipment": Truck, "Recurring": CalendarClock, "VAS": Sparkles, "Pick & Pack": PackageOpen, "Receiving": ArrowDownToLine, "Storage": Warehouse, "Return": RotateCcw, "Work Order": Hammer,
};
const OP_OPTIONS = BILLING_OPERATION_TYPES.map((op) => ({ value: op, title: op, description: OPERATION_META[op].description, icon: OP_ICONS[op] ?? Boxes }));

export function feeToForm(f: FeeView): F {
  return {
    name: f.name, operationType: f.operationType, calculationType: f.calculationType, feeBy: f.feeBy, chargeBy: f.chargeBy, vasTypeId: f.vasTypeId,
    useMinPrice: f.useMinPrice, minPrice: f.minPrice, useMaxPrice: f.useMaxPrice, maxPrice: f.maxPrice, chargeOneTime: f.chargeOneTime, pricingMode: f.pricingMode ?? "graduated", splitDay: f.splitDay ?? 15, standardRate: f.standardRate, alternateRate: f.alternateRate,
    conditions: f.conditions.map((c) => ({ field: c.field, comparator: c.comparator as Condition["comparator"], value: c.value as Condition["value"] })),
    tiers: f.tiers.map((t) => ({ fromQty: t.fromQty ?? 1, toQty: t.toQty, rate: t.rate })),
  };
}

const GROUP_LABEL: Readonly<Record<string, string>> = {
  "Location Custom": "Location custom fields", "LP Type Custom": "LP type custom fields", "Product Custom": "Product custom fields",
  "Shipment Plan Custom": "Shipment plan custom fields", "SO Custom": "Shipment order custom fields",
};

const valueRow = z.object({ value: z.string(), source: z.string() });

/** Lookup-backed attributes (carrier, store, order type…) pick from the values that really exist for the contract. */
function useChargeIfValues(contractId: string, field: string | null, enabled: boolean) {
  const q = useApiQuery<unknown>(["charge-if-values", contractId, field ?? ""], enabled && field ? `/api/billing/${contractId}/charge-if-values` : null, { query: { field: field ?? "" }, staleTime: 60_000 });
  const parsed = z.array(valueRow).safeParse(q.data?.data);
  return { rows: parsed.success ? parsed.data : [], loading: q.isPending && enabled, error: q.isError };
}

function ConditionModal({ open, operation, contractId, onOpenChange, onAdd }: { readonly open: boolean; readonly operation: OperationType; readonly contractId: string; readonly onOpenChange: (o: boolean) => void; readonly onAdd: (c: Condition) => void }) {
  const [field, setField] = React.useState<string | null>(null);
  const def = field ? CHARGE_IF_BY_KEY.get(field) : undefined;
  const lookup = Boolean(def && isLookupChargeIf(def.key));
  const comparators = def ? comparatorsFor(def.type, def.key) : [];
  const [comparator, setComparator] = React.useState<string | null>(null);
  const [text, setText] = React.useState("");
  const [picked, setPicked] = React.useState<readonly string[]>([]);
  const [n1, setN1] = React.useState<number | null>(null);
  const [n2, setN2] = React.useState<number | null>(null);
  const [flag, setFlag] = React.useState<boolean>(true);
  const values = useChargeIfValues(contractId, def?.key ?? null, open && lookup);
  // No lookup values exist yet (e.g. no priorities on this client's orders): let the user type the values instead of a dead empty list.
  const freeText = lookup && !values.loading && (values.error || values.rows.length === 0);
  React.useEffect(() => { if (open) { setField(null); setComparator(null); setText(""); setPicked([]); setN1(null); setN2(null); setFlag(true); } }, [open]);
  React.useEffect(() => { setComparator(comparators[0] ?? null); setPicked([]); }, [field]); // eslint-disable-line react-hooks/exhaustive-deps
  const needsValue = comparator !== "isEmpty" && comparator !== "isNotEmpty";
  const listValue = comparator === "in" || comparator === "notIn";
  const value: Condition["value"] = !def ? null : !needsValue ? null : def.type === "boolean" ? flag : def.type === "number" ? (comparator === "between" ? [n1 ?? 0, n2 ?? 0] : n1) : lookup && !freeText ? [...picked] : listValue || freeText ? text.split(",").map((s) => s.trim()).filter(Boolean) : text.trim();
  const error = !def ? "Choose a Charge If field" : !comparator ? "Choose a comparison" : !needsValue ? null : def.type === "number" ? (n1 === null || (comparator === "between" && (n2 === null || (n2 ?? 0) < (n1 ?? 0))) ? "Enter a valid number (range: low then high)" : null) : lookup && !freeText ? (picked.length === 0 ? `Pick at least one ${def.label.toLowerCase()}` : null) : freeText && !text.trim() ? "Enter at least one value" : def.type === "text" && !text.trim() ? "Enter a value" : null;
  const valueOptions = values.rows.map((v) => ({ value: v.value, label: v.value, description: v.source }));
  const fieldOptions = chargeIfFieldsFor(operation).map((f) => ({ value: f.key, label: f.label, description: GROUP_LABEL[f.group] ?? f.group }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title="Add condition" description={`The fee only charges ${operation.toLowerCase()} activity that matches every condition. ${fieldOptions.length} attributes apply to ${operation} fees.`} />
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-xs font-medium text-secondary">Charge if *
              <Combobox aria-label="Charge if field" placeholder="Search attributes" value={field} onChange={(v) => setField(v)} options={fieldOptions} emptyText="No matching attribute" />
            </label>
            {def ? (
              <label className="flex flex-col gap-1 text-xs font-medium text-secondary">Comparison *
                <Select aria-label="Comparison" value={comparator} onChange={setComparator} options={comparators.map((c) => ({ value: c, label: COMPARATOR_LABELS[c] }))} />
              </label>
            ) : null}
            {def && needsValue ? (
              def.type === "boolean" ? (
                <div className="flex flex-col gap-1 text-xs font-medium text-secondary">Value<YesNoToggle value={flag} onChange={setFlag} ariaLabel="Value" /></div>
              ) : def.type === "number" ? (
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-xs font-medium text-secondary">{comparator === "between" ? "From *" : "Value *"}<NumberInput value={n1} onChange={setN1} decimals={3} aria-label="Value" /></label>
                  {comparator === "between" ? <label className="flex flex-col gap-1 text-xs font-medium text-secondary">To *<NumberInput value={n2} onChange={setN2} decimals={3} aria-label="To value" /></label> : null}
                </div>
              ) : lookup && !freeText ? (
                <div className="flex flex-col gap-1 text-xs font-medium text-secondary">
                  <span>{def.label} values *</span>
                  <Combobox multiple aria-label={`${def.label} values`} placeholder={values.loading ? "Loading values…" : `Select ${def.label.toLowerCase()}`} value={picked} onChange={(v) => setPicked(v)} options={valueOptions}
                    emptyText={values.loading ? "Loading values…" : `No ${def.label.toLowerCase()} values found for this client`} />
                  <span className="text-2xs font-normal text-faint">Values come from master data and this client&rsquo;s activity, so a typo can&rsquo;t silently stop the fee from charging.</span>
                </div>
              ) : (
                <label className="flex flex-col gap-1 text-xs font-medium text-secondary">{listValue || freeText ? "Values (comma separated) *" : "Value *"}
                  {freeText ? <span role="note" className="text-2xs font-normal text-secondary">{values.error ? `Couldn't load the ${def.label.toLowerCase()} list.` : `No ${def.label.toLowerCase()} values found for this client yet.`} Type the values to match, separated by commas.</span> : null}
                  <TextField value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder={def.key === "locationType" ? "e.g. Bin" : def.key === "sku" ? "e.g. CPC-ESP-12" : ""} aria-label="Value" />
                </label>
              )
            ) : null}
            {def && comparator ? <p className="rounded-md bg-surface-sunken px-3 py-2 text-xs text-secondary">Charges when <strong className="text-foreground">{conditionText({ field: def.key, comparator, value })}</strong></p> : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={Boolean(error)} title={error ?? undefined} onClick={() => { if (def && comparator) { onAdd({ field: def.key, comparator: comparator as Condition["comparator"], value }); onOpenChange(false); } }}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const MODE_OPTIONS = PRICING_MODES.map((m) => ({ value: m, title: PRICING_MODE_META[m].title, description: PRICING_MODE_META[m].description }));

function Tiers({ form, unit }: { readonly form: UseFormReturn<F>; readonly unit: string }) {
  const tiers = useFieldArray({ control: form.control, name: "tiers" });
  const values = useWatch({ control: form.control, name: "tiers" }) ?? [];
  const mode = (useWatch({ control: form.control, name: "pricingMode" }) ?? "graduated") as PricingMode;
  const error = form.formState.errors.tiers;
  const message = (error as { message?: string } | undefined)?.message ?? (error as { root?: { message?: string } } | undefined)?.root?.message;
  const [sample, setSample] = React.useState<number | null>(150);
  const clean = values.map((t) => ({ fromQty: Number(t?.fromQty ?? 0), toQty: t?.toQty ?? null, rate: Number(t?.rate ?? 0) }));
  const preview = priceQuantity(sample ?? 0, clean, mode);
  const single = mode === "perUnit" || mode === "fromQuantity";
  const pickMode = (next: PricingMode) => {
    form.setValue("pricingMode", next, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
    const first = form.getValues("tiers")?.[0] ?? { fromQty: 1, toQty: null, rate: 0 };
    // Single-rate modes keep one row: from 1 (per unit) or the threshold (from quantity), open-ended.
    if (next === "perUnit") form.setValue("tiers", [{ fromQty: 1, toQty: null, rate: Number(first.rate ?? 0) }], { shouldDirty: true });
    if (next === "fromQuantity") form.setValue("tiers", [{ fromQty: Math.max(2, Number(first.fromQty ?? 1)), toQty: null, rate: Number(first.rate ?? 0) }], { shouldDirty: true });
  };
  const addTier = () => {
    const last = values[values.length - 1];
    const lastFrom = Number(last?.fromQty ?? 0);
    const suggestedTo = (lastFrom <= 1 ? 0 : lastFrom) + 100;
    if (last && (last.toQty === null || last.toQty === undefined)) form.setValue(`tiers.${values.length - 1}.toQty`, suggestedTo, { shouldDirty: true });
    // "Up to / above" boundaries: the new charge starts where the previous one ends (works for decimal units too).
    const from = last ? (last.toQty ?? suggestedTo) : 0;
    tiers.append({ fromQty: from, toQty: null, rate: last?.rate ?? 0 });
  };
  return (
    <div className="flex flex-col gap-3" data-invalid={message ? "true" : undefined}>
      <RadioCards<PricingMode> ariaLabel="Charge" columns={2} value={mode} onChange={pickMode} options={MODE_OPTIONS} className="lg:grid-cols-4" />
      {mode === "perUnit" ? (
        <div className="flex flex-wrap items-end gap-3">
          <FormField<F> name="tiers.0.rate" label={`Rate per ${unit}`} required>{(c) => <NumberInput id={c.id} value={(c.value as number | null) ?? null} onChange={c.onChange} onBlur={c.onBlur} invalid={c.invalid} min={0} decimals={4} suffix="USD" className="w-48" aria-label={`Rate per ${unit}`} />}</FormField>
        </div>
      ) : mode === "fromQuantity" ? (
        <div className="flex flex-wrap items-end gap-3">
          <FormField<F> name="tiers.0.fromQty" label={`Charge from ${unit} #`} required info={`Units before this one are free; e.g. 101 charges from the 101st ${unit}`}>{(c) => <NumberInput id={c.id} value={(c.value as number | null) ?? null} onChange={c.onChange} onBlur={c.onBlur} invalid={c.invalid} min={1} className="w-40" aria-label="Charge from quantity" />}</FormField>
          <FormField<F> name="tiers.0.rate" label={`Rate per ${unit}`} required>{(c) => <NumberInput id={c.id} value={(c.value as number | null) ?? null} onChange={c.onChange} onBlur={c.onBlur} invalid={c.invalid} min={0} decimals={4} suffix="USD" className="w-48" aria-label={`Rate per ${unit}`} />}</FormField>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-surface-sunken text-2xs font-semibold text-secondary">
              <tr><th className="px-3 py-2 text-left">{mode === "tierBase" ? `Total ${unit}s from` : `For each ${unit} from`}</th><th className="px-3 py-2 text-left">Up to (incl.)</th><th className="px-3 py-2 text-left">Rate</th><th className="w-10" /></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tiers.fields.map((t, i) => (
                <tr key={t.id}>
                  <td className="px-3 py-2"><FormField<F> name={`tiers.${i}.fromQty`}>{(c) => <NumberInput id={c.id} value={(c.value as number | null) ?? null} onChange={c.onChange} onBlur={c.onBlur} invalid={c.invalid} min={0} decimals={3} aria-label={`Charge ${i + 1} from`} />}</FormField></td>
                  <td className="px-3 py-2"><FormField<F> name={`tiers.${i}.toQty`}>{(c) => <NumberInput id={c.id} value={(c.value as number | null) ?? null} onChange={c.onChange} onBlur={c.onBlur} invalid={c.invalid} min={0} decimals={3} placeholder="and up" aria-label={`Charge ${i + 1} up to`} />}</FormField></td>
                  <td className="px-3 py-2"><FormField<F> name={`tiers.${i}.rate`}>{(c) => <NumberInput id={c.id} value={(c.value as number | null) ?? null} onChange={c.onChange} onBlur={c.onBlur} invalid={c.invalid} min={0} decimals={4} suffix="USD" aria-label={`Charge ${i + 1} rate`} />}</FormField></td>
                  <td className="px-2 py-2 text-right"><Button size="icon-sm" variant="ghost" aria-label={`Remove charge ${i + 1}`} disabled={tiers.fields.length === 1} onClick={() => tiers.remove(i)}><Trash2 className="h-4 w-4" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-border bg-surface-sunken/60 px-3 py-1.5 text-2xs text-faint">Each charge starts where the previous one ends: 0–100 then 100–500 bills everything above 100 (including fractions such as 100.5) at the second rate.</p>
        </div>
      )}
      {message ? <p role="alert" className="text-xs font-medium text-danger">{message}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {single ? <span /> : <Button size="sm" variant="secondary" onClick={addTier}><Plus className="h-4 w-4" />Add tier</Button>}
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-sunken px-3 py-1.5 text-xs text-secondary" aria-live="polite">
          Preview: <NumberInput value={sample} onChange={setSample} min={0} size="sm" className="w-24" aria-label="Sample quantity" /> {unit}s →
          <strong className="tabular-nums text-foreground">{moneyRail(preview.total)}</strong>
          <span className="tabular-nums text-faint">({priceFormula(sample ?? 0, clean, mode)})</span>
        </div>
      </div>
    </div>
  );
}

export function FeeForm({ contractId, fee, onDone, onCancel, onBusyChange }: { readonly contractId: string; readonly fee: FeeView | null; readonly onDone: () => void; readonly onCancel: () => void; readonly onBusyChange?: (busy: boolean) => void }) {
  const form = useZodForm(feeSchema, fee ? feeToForm(fee) : FEE_DEFAULTS, { mode: "onSubmit" });
  const vas = useVasTypes();
  const [conditionOpen, setConditionOpen] = React.useState(false);
  // No operation is preselected on Create fee, so `op` is undefined until a card is picked.
  const op = useWatch({ control: form.control, name: "operationType" }) as OperationType | undefined;
  const calc = useWatch({ control: form.control, name: "calculationType" });
  const feeBy = useWatch({ control: form.control, name: "feeBy" });
  const chargeBy = useWatch({ control: form.control, name: "chargeBy" });
  const useMin = useWatch({ control: form.control, name: "useMinPrice" });
  const useMax = useWatch({ control: form.control, name: "useMaxPrice" });
  const conditions = useWatch({ control: form.control, name: "conditions" }) ?? [];
  const feeByList = feeByOptions(op, calc ?? null);
  const chargeList = chargeByOptions(op, feeBy);
  const split = op === "Storage" && calc === "Split Month Storage";
  const rateUnit = chargeUnit(chargeBy || feeBy || "unit");
  const conditional = op ? (CHARGE_IF_GROUPS_BY_OP[op] ?? []).length > 0 : false;
  const oneTime = useWatch({ control: form.control, name: "chargeOneTime" });
  const tierValues = useWatch({ control: form.control, name: "tiers" });
  const pricingMode = useWatch({ control: form.control, name: "pricingMode" });
  const standardRate = useWatch({ control: form.control, name: "standardRate" });
  const alternateRate = useWatch({ control: form.control, name: "alternateRate" });
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const submitting = form.formState.isSubmitting;
  React.useEffect(() => { onBusyChange?.(submitting); }, [submitting]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => () => onBusyChange?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  // Cross-field rules ("Enter a rate greater than 0", tier gaps) live on the tiers / rates paths, so a
  // change to one rate input never re-validated them: re-run them on every change once submitted.
  const tierKey = JSON.stringify(tierValues ?? []);
  React.useEffect(() => {
    if (form.formState.isSubmitted) void form.trigger(["tiers", "standardRate", "alternateRate"]);
  }, [tierKey, pricingMode, standardRate, alternateRate]); // eslint-disable-line react-hooks/exhaustive-deps
  const requestCancel = () => { if (form.formState.isDirty) setDiscardOpen(true); else onCancel(); };
  const set = (name: keyof F, value: unknown) => form.setValue(name, value as never, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
  const pickOp = (next: OperationType) => {
    set("operationType", next);
    set("calculationType", next === "Storage" ? "At Period End" : null);
    const fb = feeByOptions(next, next === "Storage" ? "At Period End" : null);
    set("feeBy", fb.length === 1 ? fb[0] : "");
    const cb = fb.length === 1 ? chargeByOptions(next, fb[0]) : [];
    set("chargeBy", cb.length === 1 ? cb[0] : "");
    const allowed = new Set(chargeIfFieldsFor(next).map((f) => f.key));
    const kept = (form.getValues("conditions") ?? []).filter((c) => allowed.has(c.field));
    if (kept.length !== (form.getValues("conditions") ?? []).length) {
      set("conditions", kept);
      toast.info("Conditions removed", `Some conditions don't apply to ${next} fees and were removed.`);
    }
    if (next !== "Recurring") set("chargeOneTime", false);
    // Keep a suggested name in step with the operation until the user types their own.
    const current = form.getValues("name")?.trim() ?? "";
    const suggested = current === "Monthly account fee" || BILLING_OPERATION_TYPES.some((o) => current === `${o} fee`);
    if (!current || suggested) set("name", next === "Recurring" ? "Monthly account fee" : `${next} fee`);
  };
  // A calculation type that narrows Fee by to one option selects it (e.g. Split Month Storage → LP); the Charge by effect follows.
  React.useEffect(() => {
    if (feeByList.length === 1 && feeBy !== feeByList[0]) set("feeBy", feeByList[0]);
    else if (feeBy && !feeByList.includes(feeBy)) set("feeBy", "");
  }, [calc]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (chargeList.length === 1 && chargeBy !== chargeList[0]) set("chargeBy", chargeList[0]);
    else if (chargeBy && !chargeList.includes(chargeBy)) set("chargeBy", "");
  }, [feeBy]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (values: unknown) => {
    try {
      await apiRequest(fee ? `/api/billing/${contractId}/fees/${fee.id}` : `/api/billing/${contractId}/fees`, { method: fee ? "PATCH" : "POST", body: values });
      toast.success("Success", fee ? "Fee updated." : "Fee added to the billing form.");
      onDone();
    } catch (error) {
      applyServerFieldErrors(form, error);
      toast.error("Couldn't save the fee", isApiError(error) ? error.message : "Something went wrong");
      throw error;
    }
  };

  return (
    <Form form={form} onSubmit={submit} className="flex flex-col gap-5 rounded-xl border border-primary/30 bg-surface p-5 shadow-sm ring-4 ring-primary/5">
      <div className="flex items-start justify-between gap-3">
        <div><h3 className="text-base font-semibold text-foreground">{fee ? `Edit fee ${fee.name}` : "Create fee"}</h3><p className="text-xs text-secondary">Choose what is billed, how it&rsquo;s counted, and the price.</p></div>
        <Button size="icon-sm" variant="ghost" aria-label="Close fee form" onClick={requestCancel} disabled={submitting}><X className="h-4 w-4" /></Button>
      </div>
      <FormSection title="Operation type">
        <FormField<F> name="operationType" required>
          {(c) => <RadioCards<OperationType> ariaLabel="Operation type" columns={3} value={(c.value as OperationType) ?? null} onChange={pickOp} options={OP_OPTIONS} aria-invalid={c.invalid} className="lg:grid-cols-4" />}
        </FormField>
      </FormSection>
      <FormSection title="Fee">
        <FormGrid>
          <FormField<F> name="name" label="Fee name" required>{(c) => <TextField {...c} value={(c.value as string) ?? ""} maxLength={100} placeholder="e.g. Receiving per unit" />}</FormField>
          {op === "Storage" ? (
            <FormField<F> name="calculationType" label="Fee calculation type" required info={calc ? CALC_TYPE_TIPS[calc] : "How stored inventory is counted across the period"}>
              {(c) => <Select id={c.id} aria-label="Fee calculation type" value={(c.value as string | null) ?? null} invalid={c.invalid} onChange={(v) => c.onChange(v)} options={BILLING_CALCULATION_TYPES.map((t) => ({ value: t, label: t, description: CALC_TYPE_TIPS[t] }))} />}
            </FormField>
          ) : null}
          <FormField<F> name="feeBy" label="Fee by" required info={op ? `Options depend on the operation (${feeByList.length} for ${op})` : "Choose an operation type first"}>
            {(c) => <Select id={c.id} aria-label="Fee by" placeholder="Choose" value={(c.value as string) || null} invalid={c.invalid} onChange={(v) => c.onChange(v ?? "")} options={feeByList.map((v) => ({ value: v, label: v }))} disabled={feeByList.length === 0} />}
          </FormField>
          <FormField<F> name="chargeBy" label="Charge by" required>
            {(c) => <Select id={c.id} aria-label="Charge by" placeholder={feeBy ? "Choose" : "Choose Fee by first"} value={(c.value as string) || null} invalid={c.invalid} onChange={(v) => c.onChange(v ?? "")} options={chargeList.map((v) => ({ value: v, label: v }))} disabled={chargeList.length === 0} />}
          </FormField>
          {op === "VAS" ? (
            <FormField<F> name="vasTypeId" label="VAS type" required info="Logged VAS operations of this type are billed">
              {(c) => <Select id={c.id} aria-label="VAS type" placeholder={vas.loading ? "Loading…" : "Choose a VAS type"} value={(c.value as string | null) ?? null} invalid={c.invalid} onChange={(v) => c.onChange(v)} options={vas.rows.map((v) => ({ value: v.id, label: v.name, description: v.calculationType === "Total Price" ? "Value is a price" : "Value is a quantity" }))} />}
            </FormField>
          ) : null}
        </FormGrid>
      </FormSection>
      {split ? (
        <FormSection title="Split month settings" description="Split billing for first receipts after the split day: carried-over and early receipts bill at the standard rate, later first receipts at the alternate rate.">
          <FormGrid columns={3}>
            <FormField<F> name="splitDay" label={<span className="inline-flex items-center gap-1">Split day of month<InfoTip content={SPLIT_TIPS.splitDay} /></span>} required>{(c) => <NumberInput id={c.id} value={(c.value as number | null) ?? null} onChange={c.onChange} invalid={c.invalid} min={1} max={28} aria-label="Split day of month" />}</FormField>
            <FormField<F> name="standardRate" label={<span className="inline-flex items-center gap-1">Standard storage rate<InfoTip content={SPLIT_TIPS.standardRate} /></span>} required>{(c) => <NumberInput id={c.id} value={(c.value as number | null) ?? null} onChange={c.onChange} invalid={c.invalid} min={0} decimals={4} suffix={`per ${rateUnit}`} aria-label="Standard storage rate" />}</FormField>
            <FormField<F> name="alternateRate" label={<span className="inline-flex items-center gap-1">Alternate storage rate<InfoTip content={SPLIT_TIPS.alternateRate} /></span>} required>{(c) => <NumberInput id={c.id} value={(c.value as number | null) ?? null} onChange={c.onChange} invalid={c.invalid} min={0} decimals={4} suffix={`per ${rateUnit}`} aria-label="Alternate storage rate" />}</FormField>
          </FormGrid>
        </FormSection>
      ) : (
        <FormSection title="Charges" description={chargeBy ? `How each ${chargeUnit(chargeBy)} in the period is priced.` : "Choose Charge by to set prices."}>
          <Tiers form={form} unit={chargeBy ? chargeUnit(chargeBy) : "unit"} />
        </FormSection>
      )}
      {op === "Recurring" ? (
        <FormSection title="Recurrence" description="Recurring fees charge once per billing period unless set to charge one time.">
          <div className="rounded-lg border border-border p-3">
            <Switch checked={Boolean(oneTime)} onCheckedChange={(v) => set("chargeOneTime", v)} label="Charge one time"
              description="Bill this fee on the next calculation only, e.g. an onboarding or setup fee. Later periods skip it once a successful bill includes it." />
          </div>
        </FormSection>
      ) : null}
      <FormSection title="Minimum and maximum price" description="Adjusts this fee's period total.">
        <div className="grid gap-4 md:grid-cols-2">
          {(["Min", "Max"] as const).map((k) => {
            const on = k === "Min" ? useMin : useMax;
            const flag = k === "Min" ? "useMinPrice" : "useMaxPrice";
            const price = k === "Min" ? "minPrice" : "maxPrice";
            return (
              <div key={k} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <Switch checked={Boolean(on)} onCheckedChange={(v) => set(flag, v)} label={`Use ${k === "Min" ? "minimum" : "maximum"} price`} description={k === "Min" ? "Bill at least this amount for the period" : "Never bill more than this amount for the period"} />
                {on ? <FormField<F> name={price} label={`${k === "Min" ? "Minimum" : "Maximum"} price`} required>{(c) => <NumberInput id={c.id} value={(c.value as number | null) ?? null} onChange={c.onChange} invalid={c.invalid} min={0} decimals={2} suffix="USD" aria-label={`${k} price`} />}</FormField> : null}
              </div>
            );
          })}
        </div>
      </FormSection>
      {conditional && op ? (
        <FormSection title="Conditions" description={`Only charge activity that matches every condition (${(CHARGE_IF_GROUPS_BY_OP[op] ?? []).filter((g) => !g.endsWith("Custom")).join(", ")} or custom-field attributes).`}
          action={<Button size="sm" variant="secondary" onClick={() => setConditionOpen(true)} disabled={conditions.length >= 20}><Plus className="h-4 w-4" />Add condition</Button>}>
          {conditions.length ? (
            <div className="flex flex-wrap gap-2">
              {conditions.map((c, i) => (
                <Badge key={`${c.field}-${i}`} tone="primary" size="md" shape="pill" className="gap-1.5 py-1 pl-2.5 pr-1">
                  {conditionText(c)}
                  <button type="button" aria-label={`Remove condition ${conditionText(c)}`} className="rounded-full p-0.5 hover:bg-primary/15" onClick={() => set("conditions", conditions.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
                </Badge>
              ))}
            </div>
          ) : <p className="text-xs text-faint">No conditions: all {op.toLowerCase()} activity is charged.</p>}
        </FormSection>
      ) : null}
      <SubmitBar submitLabel={fee ? "Save fee" : "Add fee"} onCancel={requestCancel} />
      <ConfirmDialog open={discardOpen} onOpenChange={setDiscardOpen} variant="attention" title={fee ? `Discard your changes to ${fee.name}?` : "Discard this fee?"}
        description={fee ? "The fee keeps its saved settings." : "Nothing you entered is saved."} confirmLabel="Discard" cancelLabel="Keep editing"
        onConfirm={() => { setDiscardOpen(false); onCancel(); }} />
      {op ? <ConditionModal open={conditionOpen} operation={op} contractId={contractId} onOpenChange={setConditionOpen} onAdd={(c) => set("conditions", [...conditions, c])} /> : null}
    </Form>
  );
}
