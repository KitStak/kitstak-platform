"use client";

/** Add/Edit Product Capacity and LP Capacity modals used by the location wizard (steps 2–3). */
import * as React from "react";
import { z } from "zod";
import { lpCapacitySchema, productCapacitySchema } from "@/lib/grid-defs/facility/locations";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Form, FormField, FormGrid, useZodForm } from "@/components/ui/form";
import { ComboField, NumberField, SelectField } from "@/components/facility/form-controls";
import { useClientOptions, useLookups } from "@/components/facility/facility-shared";
import { ProductPicker, useLpTypeOptions } from "@/components/facility/pickers";

export interface ProductCapacityRow extends z.input<typeof productCapacitySchema> {
  readonly sku?: string;
  readonly clientName?: string;
}

export interface LpCapacityRow extends z.input<typeof lpCapacitySchema> {
  readonly lpTypeCode?: string;
  readonly sku?: string | null;
}

const PC_DEFAULTS: ProductCapacityRow = { clientId: "", productId: "", packType: "Each", minQty: 0, maxQty: 0 };
const LP_DEFAULTS: LpCapacityRow = { lpTypeId: "", minQty: 0, maxQty: 1, assignProduct: false, clientId: null, productId: null };

export function ProductCapacityModal({ open, onOpenChange, initial, onSave }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly initial: ProductCapacityRow | null; readonly onSave: (row: ProductCapacityRow) => void }) {
  const form = useZodForm(productCapacitySchema, initial ?? PC_DEFAULTS);
  const [sku, setSku] = React.useState<string | undefined>(initial?.sku);
  const clients = useClientOptions();
  const packTypes = useLookups("pack_type");
  const clientId = form.watch("clientId");
  React.useEffect(() => {
    if (open) {
      form.reset(initial ?? PC_DEFAULTS);
      setSku(initial?.sku);
    }
  }, [open, initial, form]);
  const packOptions = packTypes.options.length ? packTypes.options.map((o) => ({ value: o.label, label: o.label })) : [{ value: "Each", label: "Each" }];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title={initial ? "Edit product capacity" : "Add product capacity"} description="Min and max drive pick-face replenishment for this location." />
        <Form form={form} onSubmit={(values) => { onSave({ ...values, sku, clientName: clients.find((c) => c.value === values.clientId)?.label }); onOpenChange(false); }}>
          <DialogBody>
            <FormGrid>
              <ComboField<z.input<typeof productCapacitySchema>> name="clientId" label="Client" required options={clients} placeholder="Select client" onValueChange={() => { form.setValue("productId", ""); setSku(undefined); }} />
              <FormField<z.input<typeof productCapacitySchema>> name="productId" label="Product" required>
                {(c) => <ProductPicker id={c.id} clientId={clientId || null} value={(c.value as string) || null} selectedLabel={sku} invalid={c.invalid} onBlur={c.onBlur} onChange={(v, label) => { c.onChange(v ?? ""); setSku(label ?? undefined); }} />}
              </FormField>
              <SelectField<z.input<typeof productCapacitySchema>> name="packType" label="Pack type" required options={packOptions} />
              <div />
              <NumberField<z.input<typeof productCapacitySchema>> name="minQty" label="Min qty" />
              <NumberField<z.input<typeof productCapacitySchema>> name="maxQty" label="Max qty" required />
            </FormGrid>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="primary">Save</Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function LpCapacityModal({ open, onOpenChange, initial, warehouseId, onSave }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly initial: LpCapacityRow | null; readonly warehouseId: string | null; readonly onSave: (row: LpCapacityRow) => void }) {
  const form = useZodForm(lpCapacitySchema, initial ?? LP_DEFAULTS);
  const [sku, setSku] = React.useState<string | undefined>(initial?.sku ?? undefined);
  const clients = useClientOptions();
  const types = useLpTypeOptions(warehouseId);
  const assign = form.watch("assignProduct");
  const clientId = form.watch("clientId");
  React.useEffect(() => {
    if (open) {
      form.reset(initial ?? LP_DEFAULTS);
      setSku(initial?.sku ?? undefined);
    }
  }, [open, initial, form]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title={initial ? "Edit LP capacity" : "Add LP capacity"} description="How many license plates of a type this location can hold." />
        <Form form={form} onSubmit={(values) => { onSave({ ...values, lpTypeCode: types.options.find((t) => t.value === values.lpTypeId)?.label, sku: values.assignProduct ? sku ?? null : null }); onOpenChange(false); }}>
          <DialogBody>
            <FormGrid>
              <SelectField<z.input<typeof lpCapacitySchema>> name="lpTypeId" label="LP type" required options={types.options} placeholder={types.loading ? "Loading…" : types.options.length ? "Select LP type" : "No LP types in this warehouse"} />
              <div />
              <NumberField<z.input<typeof lpCapacitySchema>> name="minQty" label="Min qty" />
              <NumberField<z.input<typeof lpCapacitySchema>> name="maxQty" label="Max qty" required />
            </FormGrid>
            <div className="mt-4 rounded-lg border border-border bg-surface-sunken/50 p-3">
              <Checkbox checked={Boolean(assign)} onCheckedChange={(v) => form.setValue("assignProduct", v === true, { shouldDirty: true })} label="Assign product for this LP" description="Reserve the LP slots for one client's SKU." />
              {assign ? (
                <FormGrid className="mt-3">
                  <ComboField<z.input<typeof lpCapacitySchema>> name="clientId" label="Client" required options={clients} onValueChange={() => { form.setValue("productId", null); setSku(undefined); }} />
                  <FormField<z.input<typeof lpCapacitySchema>> name="productId" label="Product" required>
                    {(c) => <ProductPicker id={c.id} clientId={clientId || null} value={(c.value as string) || null} selectedLabel={sku} invalid={c.invalid} onBlur={c.onBlur} onChange={(v, label) => { c.onChange(v); setSku(label ?? undefined); }} />}
                  </FormField>
                </FormGrid>
              ) : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="primary">Save</Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
