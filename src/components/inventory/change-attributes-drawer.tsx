"use client";

/**
 * Change Attributes (bulk; spec 04 §2.8): Lot/Batch, Expiry, Production Date, Damage
 * Reason. One field + the spec's Attention copy. With a single row selected a
 * "Quantity" field lets you split the row (e.g. mark 3 of 20 units damaged) — a
 * KitStaks addition. Changing the damage reason moves units between Undamaged and
 * Damaged in Total Inventory and ATP. Partial failures are reported per row.
 */
import * as React from "react";
import { z } from "zod";
import { useApiMutation } from "@/lib/query-client";
import { toast } from "@/components/ui/toast";
import { Drawer } from "@/components/ui/drawer";
import { Callout } from "@/components/ui/callout";
import { Form, FormField, SubmitBar, useZodForm } from "@/components/ui/form";
import { NumberInput } from "@/components/ui/number-input";
import { TextField } from "@/components/ui/text-field";
import { DatePicker } from "@/components/ui/date-picker";
import { Combobox } from "@/components/ui/combobox";
import { BucketCard } from "./bucket-card";
import { formatQty, useInventoryReasons } from "./inventory-shared";
import { ATTRIBUTE_COPY, type AttributeKey, type BucketRow, type BulkResult } from "./by-location-types";

const NO_DAMAGE = "__none__";

const toIsoDate = (d: Date | null): string | null =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null;
const fromIsoDate = (s: string | null): Date | null => {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

export function attributeSchema(attribute: AttributeKey, single: BucketRow | null) {
  return z.object({ value: z.string().nullable(), qty: z.number().int("Use a whole number").nullable() }).superRefine((v, ctx) => {
    if (attribute === "lotNumber" && v.value && v.value.length > 60) ctx.addIssue({ code: "custom", path: ["value"], message: "At most 60 characters" });
    if (single && v.qty !== null) {
      if (v.qty <= 0) ctx.addIssue({ code: "custom", path: ["qty"], message: "Must be greater than 0" });
      else if (v.qty > single.freePackQty) ctx.addIssue({ code: "custom", path: ["qty"], message: `Only ${formatQty(single.freePackQty)} free` });
    }
    if (single) {
      const current = single[attribute] ?? null;
      if ((v.value || null) === current) ctx.addIssue({ code: "custom", path: ["value"], message: "Enter a different value than the current one" });
    }
  });
}

export interface ChangeAttributesDrawerProps {
  readonly attribute: AttributeKey | null;
  readonly rows: readonly BucketRow[];
  readonly onClose: () => void;
  readonly onDone: () => void;
}

export function ChangeAttributesDrawer({ attribute, rows, onClose, onDone }: ChangeAttributesDrawerProps) {
  const copy = attribute ? ATTRIBUTE_COPY[attribute] : null;
  return (
    <Drawer open={attribute !== null} onOpenChange={(o) => (o ? undefined : onClose())} title={copy?.title ?? ""} width={35}>
      {attribute ? <AttributeForm key={`${attribute}:${rows.map((r) => r.id).join(",")}`} attribute={attribute} rows={rows} onClose={onClose} onDone={onDone} /> : null}
    </Drawer>
  );
}

function AttributeForm({ attribute, rows, onClose, onDone }: { readonly attribute: AttributeKey; readonly rows: readonly BucketRow[]; readonly onClose: () => void; readonly onDone: () => void }) {
  const copy = ATTRIBUTE_COPY[attribute];
  const single = rows.length === 1 ? rows[0] : null;
  const reasons = useInventoryReasons(attribute === "damageReason");
  const schema = React.useMemo(() => attributeSchema(attribute, single), [attribute, single]);
  const form = useZodForm(schema, { value: single ? single[attribute] : null, qty: null });
  const label = (id: string) => rows.find((r) => r.id === id);
  const mutation = useApiMutation<z.output<typeof schema>, BulkResult, z.input<typeof schema>>({
    path: "/api/inventory/change-attributes",
    body: (v) => ({ ids: rows.map((r) => r.id), attribute, value: v.value || null, ...(single && v.qty !== null ? { qty: v.qty } : {}) }),
    invalidate: [["grid"], ["inventory"]],
    successMessage: false,
    form,
    onSuccess: (res) => {
      const total = rows.length;
      if (res.failed.length === 0) {
        toast.success("Success", `${copy.label} updated on ${res.succeeded.length} of ${total} row${total === 1 ? "" : "s"}.`);
      } else {
        const first = res.failed[0];
        const r = first ? label(first.id) : undefined;
        toast.error("Partly updated", `${res.succeeded.length} of ${total} updated · ${res.failed.length} failed${r && first ? ` (${r.sku} @ ${r.location}: ${first.message})` : ""}`);
      }
      form.reset(form.getValues());
      if (res.succeeded.length > 0) onDone();
    },
  });
  const damageOptions = [{ value: NO_DAMAGE, label: "No damage reason" }, ...(reasons?.damageReasons ?? []).map((r) => ({ value: r.name, label: r.name }))];
  const allocated = rows.reduce((s, r) => s + r.allocatedQty, 0);

  return (
    <Form form={form} onSubmit={(v) => mutation.mutateAsync(v)} className="flex h-full flex-col" guardUnsaved>
      <div className="flex flex-col gap-4">
        {single ? <BucketCard row={single} compact /> : (
          <div className="rounded-lg border border-border bg-surface-sunken/60 p-3 text-[13px]">
            <div className="font-semibold text-foreground">{rows.length} rows selected</div>
            <ul className="mt-1 max-h-32 overflow-auto text-secondary">
              {rows.slice(0, 20).map((r) => <li key={r.id} className="truncate">{r.sku} · {r.location}{r.lpNumber ? ` / ${r.lpNumber}` : ""} · {formatQty(r.freePackQty)} {r.packType}</li>)}
              {rows.length > 20 ? <li className="text-faint">+{rows.length - 20} more</li> : null}
            </ul>
          </div>
        )}
        <FormField name="value" label={copy.label} required={attribute === "expiryDate" || attribute === "productionDate" ? false : undefined}>
          {(c) => {
            const value = c.value as string | null;
            if (attribute === "damageReason") return <Combobox id={c.id} aria-label={copy.label} options={damageOptions} value={value ?? NO_DAMAGE} onChange={(v) => c.onChange(v === NO_DAMAGE ? null : v)} onBlur={c.onBlur} invalid={c.invalid} placeholder={copy.placeholder} clearable={false} />;
            if (attribute === "lotNumber") return <TextField id={c.id} name={c.name} aria-invalid={c["aria-invalid"]} aria-describedby={c["aria-describedby"]} value={value ?? ""} onChange={(e) => c.onChange(e.target.value || null)} onBlur={c.onBlur} placeholder={copy.placeholder} maxLength={60} data-autofocus />;
            return <DatePicker id={c.id} aria-label={copy.label} aria-describedby={c["aria-describedby"]} value={fromIsoDate(value)} onChange={(d) => c.onChange(toIsoDate(d))} onBlur={c.onBlur} invalid={c.invalid} placeholder={copy.placeholder} clearable />;
          }}
        </FormField>
        {single ? (
          <FormField name="qty" label="Quantity to change" description={`Leave empty to change all ${formatQty(single.freePackQty)} free ${single.packType}. A smaller quantity splits the row.`}>
            {(c) => <NumberInput id={c.id} name={c.name} aria-describedby={c["aria-describedby"]} aria-invalid={c["aria-invalid"]} value={c.value as number | null} onChange={(v) => c.onChange(v)} onBlur={c.onBlur} invalid={c.invalid} min={1} max={single.freePackQty} placeholder={`All ${formatQty(single.freePackQty)}`} />}
          </FormField>
        ) : null}
        <Callout variant="attention" title="Attention">
          {copy.attention}
          {allocated > 0 ? ` Allocated units (${formatQty(allocated)}) keep their current value.` : ""}
          {attribute === "damageReason" ? " Damaged units leave Undamaged Quantity and Current ATP." : ""}
        </Callout>
      </div>
      <SubmitBar sticky className="mt-auto" onCancel={onClose} pending={mutation.isPending} />
    </Form>
  );
}
