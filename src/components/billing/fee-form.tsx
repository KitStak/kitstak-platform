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
import {
  CALC_TYPE_TIPS, CHARGE_IF_BY_KEY, CHARGE_IF_FIELDS, COMPARATOR_LABELS, FEE_DEFAULTS, OPERATION_META, SPLIT_TIPS, chargeByOptions, chargeUnit, comparatorsFor, conditionText, feeByOptions, feeSchema, tieredAmount,
  type FeeInput, type OperationType,
} from "@/lib/grid-defs/organization/billing";
import { apiRequest, isApiError } from "@/lib/api-client";
import { applyServerFieldErrors } from "@/lib/query-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
    useMinPrice: f.useMinPrice, minPrice: f.minPrice, useMaxPrice: f.useMaxPrice, maxPrice: f.maxPrice, splitDay: f.splitDay ?? 15, standardRate: f.standardRate, alternateRate: f.alternateRate,
    conditions: f.conditions.map((c) => ({ field: c.field, comparator: c.comparator as Condition["comparator"], value: c.value as Condition["value"] })),
    tiers: f.tiers.map((t) => ({ fromQty: t.fromQty ?? 1, toQty: t.toQty, rate: t.rate })),
  };
}

function ConditionModal({ open, onOpenChange, onAdd }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly onAdd: (c: Condition) => void }) {
  const [field, setField] = React.useState<string | null>(null);
  const def = field ? CHARGE_IF_BY_KEY.get(field) : undefined;
  const comparators = def ? comparatorsFor(def.type) : [];
  const [comparator, setComparator] = React.useState<string | null>(null);
  const [text, setText] = React.useState("");
  const [n1, setN1] = React.useState<number | null>(null);
  const [n2, setN2] = React.useState<number | null>(null);
  const [flag, setFlag] = React.useState<boolean>(true);
  React.useEffect(() => { if (open) { setField(null); setComparator(null); setText(""); setN1(null); setN2(null); setFlag(true); } }, [open]);
  React.useEffect(() => { setComparator(comparators[0] ?? null); }, [field]); // eslint-disable-line react-hooks/exhaustive-deps
  const needsValue = comparator !== "isEmpty" && comparator !== "isNotEmpty";
  const value: Condition["value"] = !def ? null : def.type === "boolean" ? flag : def.type === "number" ? (comparator === "between" ? [n1 ?? 0, n2 ?? 0] : n1) : comparator === "in" || comparator === "notIn" ? text.split(",").map((s) => s.trim()).filter(Boolean) : text.trim();
  const error = !def ? "Choose a Charge If field" : !comparator ? "Choose a comparison" : !needsValue ? null : def.type === "number" ? (n1 === null || (comparator === "between" && (n2 === null || (n2 ?? 0) < (n1 ?? 0))) ? "Enter a valid number (range: low then high)" : null) : def.type === "text" && !text.trim() ? "Enter a value" : null;
  const groups = ["Location", "LP", "Product"] as const;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title="Add condition" description="The fee only charges activity that matches every condition." />
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-[12px] font-medium text-secondary">Charge if *
              <Select aria-label="Charge if field" placeholder="Choose a field" value={field} onChange={setField} options={groups.flatMap((g) => CHARGE_IF_FIELDS.filter((f) => f.group === g).map((f) => ({ value: f.key, label: f.label, group: g })))} />
            </label>
            {def ? (
              <label className="flex flex-col gap-1 text-[12px] font-medium text-secondary">Comparison *
                <Select aria-label="Comparison" value={comparator} onChange={setComparator} options={comparators.map((c) => ({ value: c, label: COMPARATOR_LABELS[c] }))} />
              </label>
            ) : null}
            {def && needsValue ? (
              def.type === "boolean" ? (
                <div className="flex flex-col gap-1 text-[12px] font-medium text-secondary">Value<YesNoToggle value={flag} onChange={setFlag} ariaLabel="Value" /></div>
              ) : def.type === "number" ? (
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-[12px] font-medium text-secondary">{comparator === "between" ? "From *" : "Value *"}<NumberInput value={n1} onChange={setN1} decimals={3} aria-label="Value" /></label>
                  {comparator === "between" ? <label className="flex flex-col gap-1 text-[12px] font-medium text-secondary">To *<NumberInput value={n2} onChange={setN2} decimals={3} aria-label="To value" /></label> : null}
                </div>
              ) : (
                <label className="flex flex-col gap-1 text-[12px] font-medium text-secondary">{comparator === "in" || comparator === "notIn" ? "Values (comma separated) *" : "Value *"}
                  <TextField value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder={def.key === "locationType" ? "e.g. Bin" : def.key === "sku" ? "e.g. CPC-ESP-12" : ""} aria-label="Value" />
                </label>
              )
            ) : null}
            {def && comparator ? <p className="rounded-md bg-surface-sunken px-3 py-2 text-[12px] text-secondary">Charges when <strong className="text-foreground">{conditionText({ field: def.key, comparator, value })}</strong></p> : null}
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

function Tiers({ form, unit }: { readonly form: UseFormReturn<F>; readonly unit: string }) {
  const tiers = useFieldArray({ control: form.control, name: "tiers" });
  const values = useWatch({ control: form.control, name: "tiers" }) ?? [];
  const error = form.formState.errors.tiers;
  const message = (error as { message?: string } | undefined)?.message ?? (error as { root?: { message?: string } } | undefined)?.root?.message;
  const [sample, setSample] = React.useState<number | null>(150);
  const preview = tieredAmount(sample ?? 0, values.map((t) => ({ fromQty: Number(t?.fromQty ?? 0), toQty: t?.toQty ?? null, rate: Number(t?.rate ?? 0) })));
  const addTier = () => {
    const last = values[values.length - 1];
    if (last && (last.toQty === null || last.toQty === undefined)) form.setValue(`tiers.${values.length - 1}.toQty`, Number(last.fromQty ?? 1) + 99, { shouldDirty: true });
    const from = last ? (last.toQty ?? Number(last.fromQty ?? 1) + 99) + 1 : 1;
    tiers.append({ fromQty: from, toQty: null, rate: last?.rate ?? 0 });
  };
  return (
    <div className="flex flex-col gap-3" data-invalid={message ? "true" : undefined}>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-[13px]">
          <thead className="bg-surface-sunken text-[11px] font-semibold uppercase tracking-wide text-secondary">
            <tr><th className="px-3 py-2 text-left">For each {unit} from</th><th className="px-3 py-2 text-left">To</th><th className="px-3 py-2 text-left">Rate</th><th className="w-10" /></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tiers.fields.map((t, i) => (
              <tr key={t.id}>
                <td className="px-3 py-2"><FormField<F> name={`tiers.${i}.fromQty`}>{(c) => <NumberInput id={c.id} value={(c.value as number | null) ?? null} onChange={c.onChange} onBlur={c.onBlur} invalid={c.invalid} min={0} aria-label={`Charge ${i + 1} from`} />}</FormField></td>
                <td className="px-3 py-2"><FormField<F> name={`tiers.${i}.toQty`}>{(c) => <NumberInput id={c.id} value={(c.value as number | null) ?? null} onChange={c.onChange} onBlur={c.onBlur} invalid={c.invalid} min={0} placeholder="and up" aria-label={`Charge ${i + 1} to`} />}</FormField></td>
                <td className="px-3 py-2"><FormField<F> name={`tiers.${i}.rate`}>{(c) => <NumberInput id={c.id} value={(c.value as number | null) ?? null} onChange={c.onChange} onBlur={c.onBlur} invalid={c.invalid} min={0} decimals={4} suffix="USD" aria-label={`Charge ${i + 1} rate`} />}</FormField></td>
                <td className="px-2 py-2 text-right"><Button size="icon-sm" variant="ghost" aria-label={`Remove charge ${i + 1}`} disabled={tiers.fields.length === 1} onClick={() => tiers.remove(i)}><Trash2 className="h-4 w-4" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {message ? <p role="alert" className="text-[12px] font-medium text-danger">{message}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button size="sm" variant="secondary" onClick={addTier}><Plus className="h-4 w-4" />Add charge</Button>
        <div className="flex items-center gap-2 rounded-md bg-surface-sunken px-3 py-1.5 text-[12px] text-secondary">
          Preview: <NumberInput value={sample} onChange={setSample} min={0} size="sm" className="w-24" aria-label="Sample quantity" /> {unit}s →
          <strong className="tabular-nums text-foreground">{moneyRail(preview.total)}</strong>
          {preview.parts.length > 1 ? <span className="text-faint">({preview.parts.map((p) => `${p.quantity} × ${p.rate.toFixed(2)}`).join(" + ")})</span> : null}
        </div>
      </div>
    </div>
  );
}

export function FeeForm({ contractId, fee, onDone, onCancel }: { readonly contractId: string; readonly fee: FeeView | null; readonly onDone: () => void; readonly onCancel: () => void }) {
  const form = useZodForm(feeSchema, fee ? feeToForm(fee) : FEE_DEFAULTS, { mode: "onSubmit" });
  const vas = useVasTypes();
  const [conditionOpen, setConditionOpen] = React.useState(false);
  const op = useWatch({ control: form.control, name: "operationType" }) as OperationType;
  const calc = useWatch({ control: form.control, name: "calculationType" });
  const feeBy = useWatch({ control: form.control, name: "feeBy" });
  const chargeBy = useWatch({ control: form.control, name: "chargeBy" });
  const useMin = useWatch({ control: form.control, name: "useMinPrice" });
  const useMax = useWatch({ control: form.control, name: "useMaxPrice" });
  const conditions = useWatch({ control: form.control, name: "conditions" }) ?? [];
  const feeByList = feeByOptions(op, calc ?? null);
  const chargeList = chargeByOptions(op, feeBy);
  const split = op === "Storage" && calc === "Split Month Storage";
  const conditional = op === "Storage" || op === "Receiving" || op === "Pick & Pack" || op === "Shipment" || op === "Return" || op === "Work Order";
  const set = (name: keyof F, value: unknown) => form.setValue(name, value as never, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
  const pickOp = (next: OperationType) => {
    set("operationType", next);
    set("calculationType", next === "Storage" ? "At Period End" : null);
    const fb = feeByOptions(next, next === "Storage" ? "At Period End" : null);
    set("feeBy", fb.length === 1 ? fb[0] : "");
    const cb = fb.length === 1 ? chargeByOptions(next, fb[0]) : [];
    set("chargeBy", cb.length === 1 ? cb[0] : "");
    if (!form.getValues("name")) set("name", next === "Recurring" ? "Monthly account fee" : `${next} fee`);
  };
  React.useEffect(() => {
    if (feeBy && !feeByList.includes(feeBy)) set("feeBy", feeByList.length === 1 ? feeByList[0] : "");
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
        <div><h3 className="text-[15px] font-semibold text-foreground">{fee ? `Edit fee ${fee.name}` : "Create fee"}</h3><p className="text-[12px] text-secondary">Choose what is billed, how it's counted, and the price.</p></div>
        <Button size="icon-sm" variant="ghost" aria-label="Close fee form" onClick={onCancel}><X className="h-4 w-4" /></Button>
      </div>
      <FormSection title="Operation type">
        <FormField<F> name="operationType" required>
          {(c) => <RadioCards<OperationType> ariaLabel="Operation type" columns={3} value={(c.value as OperationType) ?? null} onChange={pickOp} options={OP_OPTIONS} aria-invalid={c.invalid} className="lg:grid-cols-4" />}
        </FormField>
      </FormSection>
      <FormSection title="Fee">
        <FormGrid>
          <FormField<F> name="name" label="Fee name" required>{(c) => <TextField {...c} value={(c.value as string) ?? ""} maxLength={120} placeholder="e.g. Receiving per unit" />}</FormField>
          {op === "Storage" ? (
            <FormField<F> name="calculationType" label="Fee calculation type" required info={calc ? CALC_TYPE_TIPS[calc] : "How stored inventory is counted across the period"}>
              {(c) => <Select id={c.id} aria-label="Fee calculation type" value={(c.value as string | null) ?? null} invalid={c.invalid} onChange={(v) => c.onChange(v)} options={BILLING_CALCULATION_TYPES.map((t) => ({ value: t, label: t, description: CALC_TYPE_TIPS[t] }))} />}
            </FormField>
          ) : null}
          <FormField<F> name="feeBy" label="Fee by" required info={`Options depend on the operation (${feeByList.length} for ${op})`}>
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
        <FormSection title="Split month settings" description="Logiwa-style split billing for first receipts late in the month.">
          <FormGrid columns={3}>
            <FormField<F> name="splitDay" label={<span className="inline-flex items-center gap-1">Split day of month<InfoTip content={SPLIT_TIPS.splitDay} /></span>} required>{(c) => <NumberInput id={c.id} value={(c.value as number | null) ?? null} onChange={c.onChange} invalid={c.invalid} min={1} max={28} aria-label="Split day of month" />}</FormField>
            <FormField<F> name="standardRate" label={<span className="inline-flex items-center gap-1">Standard storage rate<InfoTip content={SPLIT_TIPS.standardRate} /></span>} required>{(c) => <NumberInput id={c.id} value={(c.value as number | null) ?? null} onChange={c.onChange} invalid={c.invalid} min={0} decimals={4} suffix="per LP" aria-label="Standard storage rate" />}</FormField>
            <FormField<F> name="alternateRate" label={<span className="inline-flex items-center gap-1">Alternate storage rate<InfoTip content={SPLIT_TIPS.alternateRate} /></span>} required>{(c) => <NumberInput id={c.id} value={(c.value as number | null) ?? null} onChange={c.onChange} invalid={c.invalid} min={0} decimals={4} suffix="per LP" aria-label="Alternate storage rate" />}</FormField>
          </FormGrid>
        </FormSection>
      ) : (
        <FormSection title="Charges" description={chargeBy ? `Graduated: each ${chargeUnit(chargeBy)} is priced at the rate of the range it falls in.` : "Choose Charge by to set prices."}>
          <Tiers form={form} unit={chargeBy ? chargeUnit(chargeBy) : "unit"} />
        </FormSection>
      )}
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
      {conditional ? (
        <FormSection title="Conditions" description="Only charge activity that matches every condition (location, LP or product attributes)."
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
          ) : <p className="text-[12px] text-faint">No conditions: all {op.toLowerCase()} activity is charged.</p>}
        </FormSection>
      ) : null}
      <SubmitBar submitLabel={fee ? "Save fee" : "Add fee"} onCancel={onCancel} />
      <ConditionModal open={conditionOpen} onOpenChange={setConditionOpen} onAdd={(c) => set("conditions", [...conditions, c])} />
    </Form>
  );
}
