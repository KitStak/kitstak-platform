"use client";

/**
 * Header "Add Inventory" drawer (spec 04 §2.4). Cascades Warehouse → Location (3+
 * chars) / LP → Client → Product → Pack Type; changing a parent clears its children.
 * Lot / expiry / production date appear only when the product tracks them.
 */
import * as React from "react";
import { z } from "zod";
import { useApiMutation, useApiQuery } from "@/lib/query-client";
import { useMe } from "@/lib/permissions-client";
import { Drawer } from "@/components/ui/drawer";
import { Form, FormField, FormGrid, SubmitBar, useZodForm } from "@/components/ui/form";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { TextField } from "@/components/ui/text-field";
import { DatePicker } from "@/components/ui/date-picker";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { ClientSelect, LocationPicker, LpPicker, WarehouseSelect, searchPicker, toOption } from "@/components/shared/entity-pickers";
import { formatQty, useInventoryReasons } from "./inventory-shared";

interface ProductOptions {
  readonly productId: string;
  readonly sku: string;
  readonly uom: string;
  readonly packTypes: readonly { readonly packType: string; readonly uomQty: number }[];
  readonly trackLot: boolean;
  readonly trackExpiry: boolean;
  readonly trackProductionDate: boolean;
}

const toIso = (d: Date | null): string | null =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null;
const fromIso = (s: string | null): Date | null => (s ? new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) : null);

export function addInventorySchema(opts: { reasonRequired: boolean; product: ProductOptions | null }) {
  return z.object({
    warehouseId: z.string().nullable(),
    locationId: z.string().nullable(),
    lpId: z.string().nullable(),
    clientId: z.string().nullable(),
    productId: z.string().nullable(),
    packType: z.string().nullable(),
    reasonId: z.string().nullable(),
    damageReason: z.string().nullable(),
    qty: z.number().int("Use a whole number").nullable(),
    lotNumber: z.string().max(60, "At most 60 characters"),
    expiryDate: z.string().nullable(),
    productionDate: z.string().nullable(),
    note: z.string().max(400, "At most 400 characters"),
  }).superRefine((v, ctx) => {
    const need = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (!v.warehouseId) need("warehouseId", "Warehouse is required");
    if (!v.locationId) need("locationId", "Location is required");
    if (!v.clientId) need("clientId", "Client is required");
    if (!v.productId) need("productId", "Product is required");
    if (!v.packType) need("packType", "Pack Type is required");
    if (opts.reasonRequired && !v.reasonId) need("reasonId", "Adjustment Reason is required by this warehouse");
    if (v.qty === null) need("qty", "Quantity to Add is required");
    else if (v.qty <= 0) need("qty", "Must be greater than 0");
    if (opts.product?.trackLot && !v.lotNumber.trim()) need("lotNumber", "This product tracks lot/batch numbers");
    if (opts.product?.trackExpiry && !v.expiryDate) need("expiryDate", "This product tracks expiry dates");
    if (opts.product?.trackProductionDate && !v.productionDate) need("productionDate", "This product tracks production dates");
  });
}

type Values = z.input<ReturnType<typeof addInventorySchema>>;

const EMPTY: Values = {
  warehouseId: null, locationId: null, lpId: null, clientId: null, productId: null, packType: null, reasonId: null,
  damageReason: null, qty: null, lotNumber: "", expiryDate: null, productionDate: null, note: "",
};

function ProductPicker({ clientId, value, onChange, invalid, id, onBlur }: { readonly clientId: string | null; readonly value: string | null; readonly onChange: (v: string | null, o: ComboboxOption | null) => void; readonly invalid: boolean; readonly id: string; readonly onBlur: () => void }) {
  const load = React.useCallback(async (q: string, signal: AbortSignal) => (await searchPicker("products", q, { clientId: clientId ?? undefined }, signal)).map(toOption), [clientId]);
  return <Combobox key={clientId ?? "none"} id={id} aria-label="Product" loadOptions={load} minChars={1} value={value} onChange={onChange} onBlur={onBlur} invalid={invalid} disabled={!clientId} placeholder={clientId ? "Search SKU, name or barcode" : "Select a client first"} />;
}

export function AddInventoryDrawer({ open, onClose, onDone }: { readonly open: boolean; readonly onClose: () => void; readonly onDone: () => void }) {
  return (
    <Drawer open={open} onOpenChange={(o) => (o ? undefined : onClose())} title="Add Inventory" description="Adds stock as an Inventory Adjustment in the ledger." width={45}>
      {open ? <AddInventoryForm onClose={onClose} onDone={onDone} /> : null}
    </Drawer>
  );
}

function AddInventoryForm({ onClose, onDone }: { readonly onClose: () => void; readonly onDone: () => void }) {
  const me = useMe();
  const reasons = useInventoryReasons();
  const [productId, setProductId] = React.useState<string | null>(null);
  const productQuery = useApiQuery<ProductOptions>(["inventory", "product-options", productId ?? ""], productId ? `/api/inventory/product-options/${productId}` : null);
  const product = productId ? productQuery.data?.data ?? null : null;
  const [warehouseId, setWarehouseId] = React.useState<string | null>(me.data?.data.context.warehouseId ?? null);
  const reasonRequired = warehouseId ? reasons?.mandatoryReason[warehouseId] ?? true : false;
  const schema = React.useMemo(() => addInventorySchema({ reasonRequired, product }), [reasonRequired, product]);
  // Validate on submit first: blurring the first picker must not disable Save before every required field is shown.
  const form = useZodForm(schema, { ...EMPTY, warehouseId }, { mode: "onSubmit" });
  const values = form.watch();
  const ratio = product?.packTypes.find((p) => p.packType === values.packType)?.uomQty ?? 1;

  const setField = (name: keyof Values, value: unknown) => form.setValue(name, value as never, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });

  const mutation = useApiMutation<z.output<typeof schema>, { to: number; delta: number }, z.input<typeof schema>>({
    path: "/api/inventory/add",
    body: (v) => ({
      warehouseId: v.warehouseId, locationId: v.locationId, lpId: v.lpId, clientId: v.clientId, productId: v.productId,
      packType: v.packType, reasonId: v.reasonId, damageReason: v.damageReason, qty: v.qty,
      lotNumber: v.lotNumber.trim() || null, expiryDate: v.expiryDate, productionDate: v.productionDate, note: v.note || null,
    }),
    invalidate: [["grid"], ["inventory"]],
    successMessage: (d) => `Added ${formatQty(d.delta)} ${product?.uom ?? "units"} of ${product?.sku ?? "the product"}; the row now holds ${formatQty(d.to)}.`,
    form,
    onError: (error) => {
      if (error.code === "RULE_VIOLATION") form.setError(values.lpId ? "lpId" : "locationId", { message: error.message });
    },
    onSuccess: () => {
      form.reset(form.getValues());
      onDone();
    },
  });

  const reasonOptions = (reasons?.adjustmentReasons ?? []).map((r) => ({ value: r.id, label: r.name }));
  const damageOptions = (reasons?.damageReasons ?? []).map((r) => ({ value: r.name, label: r.name }));
  const packOptions = (product?.packTypes ?? []).map((p) => ({ value: p.packType, label: p.uomQty > 1 ? `${p.packType} (${p.uomQty} ${product?.uom})` : p.packType }));

  return (
    <Form form={form} onSubmit={(v) => mutation.mutateAsync(v)} className="flex h-full flex-col" guardUnsaved>
      <div className="flex flex-col gap-4">
        <FormGrid columns={2}>
          <FormField name="warehouseId" label="Warehouse" required>
            {(c) => <WarehouseSelect id={c.id} value={c.value as string | null} invalid={c.invalid} onBlur={c.onBlur} onChange={(v) => { c.onChange(v); setWarehouseId(v); setField("locationId", null); setField("lpId", null); setField("clientId", null); setField("productId", null); setField("packType", null); setProductId(null); }} />}
          </FormField>
          <FormField name="clientId" label="Client" required>
            {(c) => <ClientSelect id={c.id} warehouseId={values.warehouseId} disabled={!values.warehouseId} placeholder={values.warehouseId ? "Select client" : "Select a warehouse first"} value={c.value as string | null} invalid={c.invalid} onBlur={c.onBlur} onChange={(v) => { c.onChange(v); setField("productId", null); setField("packType", null); setProductId(null); }} />}
          </FormField>
          <FormField name="locationId" label="Location" required description="Type at least 3 characters to search.">
            {(c) => <LocationPicker id={c.id} warehouseId={values.warehouseId} disabled={!values.warehouseId} value={c.value as string | null} invalid={c.invalid} onBlur={c.onBlur} onChange={(v) => { c.onChange(v); form.clearErrors("locationId"); }} placeholder={values.warehouseId ? "Search location" : "Select a warehouse first"} />}
          </FormField>
          <FormField name="lpId" label="LP Number" description="Optional. The LP is placed in the location if it has none.">
            {(c) => <LpPicker id={c.id} warehouseId={values.warehouseId} disabled={!values.warehouseId} value={c.value as string | null} invalid={c.invalid} onBlur={c.onBlur} onChange={(v) => { c.onChange(v); form.clearErrors("lpId"); }} placeholder="Search LP number" />}
          </FormField>
          <FormField name="productId" label="Product" required>
            {(c) => <ProductPicker id={c.id} clientId={values.clientId} value={c.value as string | null} invalid={c.invalid} onBlur={c.onBlur} onChange={(v) => { c.onChange(v); setProductId(v); setField("packType", null); }} />}
          </FormField>
          <FormField name="packType" label="Pack Type" required>
            {(c) => <Combobox id={c.id} aria-label="Pack type" options={packOptions} value={c.value as string | null} onChange={(v) => c.onChange(v)} onBlur={c.onBlur} invalid={c.invalid} disabled={!product} placeholder={product ? "Select pack type" : "Select a product first"} />}
          </FormField>
          <FormField name="reasonId" label="Adjustment Reason" required={reasonRequired}>
            {(c) => <Combobox id={c.id} aria-label="Adjustment reason" options={reasonOptions} value={c.value as string | null} onChange={(v) => c.onChange(v)} onBlur={c.onBlur} invalid={c.invalid} placeholder="Select adjustment reason" />}
          </FormField>
          <FormField name="damageReason" label="Damage Reason" description="Leave empty for sellable stock.">
            {(c) => <Combobox id={c.id} aria-label="Damage reason" options={damageOptions} value={c.value as string | null} onChange={(v) => c.onChange(v)} onBlur={c.onBlur} invalid={c.invalid} placeholder="No damage reason" />}
          </FormField>
          <FormField name="qty" label="Quantity to Add" required description={ratio > 1 && values.qty ? `= ${formatQty(values.qty * ratio)} ${product?.uom}` : undefined}>
            {(c) => <NumberInput id={c.id} name={c.name} aria-describedby={c["aria-describedby"]} aria-invalid={c["aria-invalid"]} value={c.value as number | null} onChange={(v) => c.onChange(v)} onBlur={c.onBlur} invalid={c.invalid} min={1} placeholder="Enter quantity" />}
          </FormField>
          {product?.trackLot ? (
            <FormField name="lotNumber" label="Lot/Batch Number" required>
              {(c) => <TextField id={c.id} name={c.name} aria-invalid={c["aria-invalid"]} aria-describedby={c["aria-describedby"]} value={c.value as string} onChange={(e) => c.onChange(e.target.value)} onBlur={c.onBlur} maxLength={60} placeholder="Enter lot/batch number" />}
            </FormField>
          ) : null}
          {product?.trackExpiry ? (
            <FormField name="expiryDate" label="Expiry Date" required>
              {(c) => <DatePicker id={c.id} aria-label="Expiry date" value={fromIso(c.value as string | null)} onChange={(d) => c.onChange(toIso(d))} onBlur={c.onBlur} invalid={c.invalid} placeholder="Enter date" />}
            </FormField>
          ) : null}
          {product?.trackProductionDate ? (
            <FormField name="productionDate" label="Production Date" required>
              {(c) => <DatePicker id={c.id} aria-label="Production date" value={fromIso(c.value as string | null)} onChange={(d) => c.onChange(toIso(d))} onBlur={c.onBlur} invalid={c.invalid} placeholder="Enter date" />}
            </FormField>
          ) : null}
        </FormGrid>
        <FormField name="note" label="Note">
          {(c) => <Textarea id={c.id} name={c.name} aria-describedby={c["aria-describedby"]} value={c.value as string} onChange={(e) => c.onChange(e.target.value)} onBlur={c.onBlur} maxLength={400} placeholder="Enter note" rows={3} />}
        </FormField>
      </div>
      <SubmitBar sticky className="mt-auto" onCancel={onClose} pending={mutation.isPending} />
    </Form>
  );
}
