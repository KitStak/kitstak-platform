"use client";

/**
 * Transfer Product (bulk, one Stock row; spec 04 §2.7): partial quantity + Move to
 * LP/Location. Rule violations from the ledger (e.g. "Location X allows only 1 SKU
 * (holds Y)") land inline under the target field.
 */
import * as React from "react";
import { z } from "zod";
import { useApiMutation } from "@/lib/query-client";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Form, FormField, SubmitBar, useZodForm } from "@/components/ui/form";
import { NumberInput } from "@/components/ui/number-input";
import { LocationOrLpPicker } from "@/components/shared/entity-pickers";
import { BucketCard } from "./bucket-card";
import { formatQty } from "./inventory-shared";
import type { BucketRow, TransferResult } from "./by-location-types";

const targetSchema = z.object({ kind: z.enum(["location", "lp"]), id: z.string() }).nullable();

export function transferProductSchema(maxPacks: number) {
  return z.object({ qty: z.number().int("Use a whole number").nullable(), target: targetSchema }).superRefine((v, ctx) => {
    if (v.qty === null) ctx.addIssue({ code: "custom", path: ["qty"], message: "Transfer Product Quantity is required" });
    else if (v.qty <= 0) ctx.addIssue({ code: "custom", path: ["qty"], message: "Must be greater than 0" });
    else if (v.qty > maxPacks) ctx.addIssue({ code: "custom", path: ["qty"], message: `Only ${formatQty(maxPacks)} free to transfer` });
    if (!v.target) ctx.addIssue({ code: "custom", path: ["target"], message: "Move to LP/Location is required" });
  });
}

const TARGET_ERROR_CODES = new Set(["RULE_VIOLATION", "VALIDATION", "NOT_FOUND"]);

export function TransferProductDrawer({ row, onClose, onDone }: { readonly row: BucketRow | null; readonly onClose: () => void; readonly onDone: () => void }) {
  return (
    <Drawer open={row !== null} onOpenChange={(o) => (o ? undefined : onClose())} title="Transfer Product" width={35}>
      {row ? <TransferProductForm key={row.id} row={row} onClose={onClose} onDone={onDone} /> : null}
    </Drawer>
  );
}

function TransferProductForm({ row, onClose, onDone }: { readonly row: BucketRow; readonly onClose: () => void; readonly onDone: () => void }) {
  const schema = React.useMemo(() => transferProductSchema(row.freePackQty), [row.freePackQty]);
  const form = useZodForm(schema, { qty: null, target: null });
  const mutation = useApiMutation<z.output<typeof schema>, TransferResult, z.input<typeof schema>>({
    path: "/api/inventory/transfer-product",
    body: (v) => ({ inventoryId: row.id, qty: v.qty, target: v.target, version: row.version }),
    invalidate: [["grid"], ["inventory"]],
    successMessage: (d) => d.moved.map((m) => `${formatQty(m.qty)} × ${m.sku}: ${m.from} → ${m.to}`).join(" · "),
    form,
    onError: (error) => {
      if (TARGET_ERROR_CODES.has(error.code) && !error.fieldErrors) form.setError("target", { message: error.message });
      if (error.code === "INSUFFICIENT_STOCK") form.setError("qty", { message: error.message });
    },
    onSuccess: () => {
      form.reset(form.getValues());
      onDone();
    },
  });
  return (
    <Form form={form} onSubmit={(v) => mutation.mutateAsync(v)} className="flex h-full flex-col" guardUnsaved>
      <div className="flex flex-col gap-4">
        <BucketCard row={row} compact />
        <FormField name="qty" label="Transfer Product Quantity" required description={`Up to ${formatQty(row.freePackQty)} ${row.packType}`}>
          {(c) => (
            <div className="flex items-center gap-2">
              <NumberInput id={c.id} name={c.name} aria-describedby={c["aria-describedby"]} aria-invalid={c["aria-invalid"]} value={c.value as number | null} onChange={(v) => c.onChange(v)} onBlur={c.onBlur} invalid={c.invalid} min={1} max={row.freePackQty} placeholder="Enter quantity" className="flex-1" data-autofocus />
              <Button variant="ghost" size="sm" onClick={() => form.setValue("qty", row.freePackQty, { shouldDirty: true, shouldValidate: true })}>All {formatQty(row.freePackQty)}</Button>
            </div>
          )}
        </FormField>
        <FormField name="target" label="Move to LP/Location" required>
          {(c) => <LocationOrLpPicker value={c.value as z.infer<typeof targetSchema>} onChange={(v) => { c.onChange(v); form.clearErrors("target"); }} warehouseId={row.warehouseId} />}
        </FormField>
      </div>
      <SubmitBar sticky className="mt-auto" submitLabel="Transfer" onCancel={onClose} pending={mutation.isPending} />
    </Form>
  );
}
