"use client";

/**
 * Add / Adjust / Remove Inventory drawer (spec 04 §2.1–2.3) for one Stock row.
 * Adjust takes the absolute New Quantity; the server posts the delta. The reason is
 * mandatory when the warehouse says so; Save stays disabled until the form is valid.
 * Beats Logiwa: a live "after save" preview and inline errors under each field.
 */
import * as React from "react";
import { z } from "zod";
import { ArrowRight } from "lucide-react";
import { useApiMutation } from "@/lib/query-client";
import { Drawer } from "@/components/ui/drawer";
import { Form, FormField, SubmitBar, useZodForm } from "@/components/ui/form";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/utils";
import { BucketCard } from "./bucket-card";
import { formatQty, useInventoryReasons } from "./inventory-shared";
import type { BucketRow, QuantityMode } from "./by-location-types";

const TITLES: Readonly<Record<QuantityMode, string>> = { add: "Add Inventory", adjust: "Adjust Inventory", remove: "Remove Inventory" };
const QTY_LABELS: Readonly<Record<QuantityMode, string>> = { add: "Quantity to Add", adjust: "New Quantity", remove: "Quantity to Remove" };
const PLACEHOLDERS: Readonly<Record<QuantityMode, string>> = { add: "Enter quantity to add", adjust: "Enter new quantity", remove: "Enter quantity to remove" };

export function quantitySchema(mode: QuantityMode, row: Pick<BucketRow, "totalPackQty" | "freePackQty" | "allocatedPackQty">, reasonRequired: boolean) {
  return z.object({
    qty: z.number({ error: "Enter a quantity" }).int("Use a whole number").nullable(),
    reasonId: z.string().nullable(),
    note: z.string().max(400, "At most 400 characters"),
  }).superRefine((v, ctx) => {
    if (reasonRequired && !v.reasonId) ctx.addIssue({ code: "custom", path: ["reasonId"], message: "Select an adjustment reason" });
    if (v.qty === null) { ctx.addIssue({ code: "custom", path: ["qty"], message: "Enter a quantity" }); return; }
    if (mode !== "adjust" && v.qty <= 0) ctx.addIssue({ code: "custom", path: ["qty"], message: "Must be greater than 0" });
    if (mode === "remove" && v.qty > row.freePackQty) ctx.addIssue({ code: "custom", path: ["qty"], message: `Only ${formatQty(row.freePackQty)} unallocated can be removed` });
    if (mode === "adjust") {
      if (v.qty < 0) ctx.addIssue({ code: "custom", path: ["qty"], message: "Can't be negative" });
      else if (v.qty < row.allocatedPackQty) ctx.addIssue({ code: "custom", path: ["qty"], message: `${formatQty(row.allocatedPackQty)} are allocated; the quantity can't go below that` });
      else if (v.qty === row.totalPackQty) ctx.addIssue({ code: "custom", path: ["qty"], message: "Enter a different quantity" });
    }
  });
}

export function resultingQty(mode: QuantityMode, current: number, qty: number | null): number | null {
  if (qty === null || Number.isNaN(qty)) return null;
  if (mode === "add") return current + qty;
  if (mode === "remove") return current - qty;
  return qty;
}

export interface QuantityDrawerProps {
  readonly row: BucketRow | null;
  readonly mode: QuantityMode;
  readonly onClose: () => void;
  readonly onDone: () => void;
}

export function QuantityDrawer({ row, mode, onClose, onDone }: QuantityDrawerProps) {
  return (
    <Drawer open={row !== null} onOpenChange={(o) => (o ? undefined : onClose())} title={TITLES[mode]} width={35}>
      {row ? <QuantityForm key={`${row.id}:${mode}`} row={row} mode={mode} onClose={onClose} onDone={onDone} /> : null}
    </Drawer>
  );
}

function QuantityForm({ row, mode, onClose, onDone }: { readonly row: BucketRow; readonly mode: QuantityMode; readonly onClose: () => void; readonly onDone: () => void }) {
  const reasons = useInventoryReasons();
  const required = reasons?.mandatoryReason[row.warehouseId] ?? true;
  const schema = React.useMemo(() => quantitySchema(mode, row, required), [mode, row, required]);
  const form = useZodForm(schema, { qty: null, reasonId: null, note: "" });
  const qty = form.watch("qty");
  const after = resultingQty(mode, row.totalPackQty, qty);
  const mutation = useApiMutation<z.output<typeof schema>, { from: number; to: number }, z.input<typeof schema>>({
    path: `/api/inventory/buckets/${row.id}/quantity`,
    body: (v) => ({ mode, qty: v.qty, reasonId: v.reasonId, note: v.note || null, version: row.version }),
    invalidate: [["grid"], ["inventory"]],
    successMessage: (d) => `${row.sku} @ ${row.location}: ${formatQty(d.from)} → ${formatQty(d.to)} ${row.uomPackType}.`,
    form,
    onSuccess: () => {
      form.reset(form.getValues());
      onDone();
    },
  });

  const reasonOptions = (reasons?.adjustmentReasons ?? []).map((r) => ({ value: r.id, label: r.name }));
  return (
    <Form form={form} onSubmit={(v) => mutation.mutateAsync(v)} className="flex h-full flex-col" guardUnsaved>
      <div className="flex flex-col gap-4">
        <BucketCard row={row} compact />
        <FormField name="reasonId" label="Adjustment Reason" required={required} description={required ? undefined : "Optional for this warehouse"}>
          {(c) => <Combobox id={c.id} aria-label="Adjustment reason" aria-describedby={c["aria-describedby"]} options={reasonOptions} value={c.value as string | null} onChange={(v) => c.onChange(v)} onBlur={c.onBlur} invalid={c.invalid} placeholder="Select adjustment reason" />}
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-secondary">Current Quantity</span>
            <div className="flex h-8 items-center rounded-md border border-border bg-surface-sunken px-3 tabular-nums text-body" aria-label="Current quantity">{formatQty(row.totalPackQty)} <span className="ml-1 text-faint">{row.packType}</span></div>
          </div>
          <FormField name="qty" label={QTY_LABELS[mode]} required>
            {(c) => <NumberInput id={c.id} name={c.name} aria-describedby={c["aria-describedby"]} aria-invalid={c["aria-invalid"]} value={c.value as number | null} onChange={(v) => c.onChange(v)} onBlur={c.onBlur} invalid={c.invalid} min={0} placeholder={PLACEHOLDERS[mode]} data-autofocus />}
          </FormField>
        </div>
        <div className={cn("flex items-center gap-3 rounded-lg border px-3 py-2 text-[13px]", after !== null && after < 0 ? "border-danger/40 bg-danger-soft" : "border-border bg-surface")} aria-live="polite">
          <span className="text-secondary">After save</span>
          <span className="tabular-nums text-body">{formatQty(row.totalPackQty)}</span>
          <ArrowRight className="h-3.5 w-3.5 text-faint" aria-hidden />
          <span className="font-semibold tabular-nums text-foreground">{after === null ? "—" : formatQty(after)}</span>
          <span className="text-faint">{row.packType}</span>
          {after !== null && row.unitsPerPack > 1 ? <span className="ml-auto text-faint">{formatQty(after * row.unitsPerPack)} {row.uomPackType}</span> : null}
        </div>
        {row.allocatedQty > 0 ? (
          <Callout variant="attention" title={`${formatQty(row.allocatedPackQty)} ${row.packType} allocated`}>
            Allocated units stay reserved; {mode === "adjust" ? "the new quantity can't go below them." : "only free units can be removed."}
          </Callout>
        ) : null}
        <FormField name="note" label="Note">
          {(c) => <Textarea id={c.id} name={c.name} aria-describedby={c["aria-describedby"]} value={c.value as string} onChange={(e) => c.onChange(e.target.value)} onBlur={c.onBlur} maxLength={400} placeholder="Enter note" rows={3} />}
        </FormField>
      </div>
      <SubmitBar sticky className="mt-auto" onCancel={onClose} pending={mutation.isPending} />
    </Form>
  );
}
