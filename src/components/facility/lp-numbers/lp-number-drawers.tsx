"use client";

/**
 * LP Number drawers: Create (Warehouse*, LP type* as "CODE (WH)", Location defaulting to the
 * warehouse's receiving location; From Sequence with count + SSCC18 per client, or Custom
 * Numbers with an alternate barcode) and Edit (Logiwa's locks: warehouse, type, location;
 * number locked while the LP holds stock or is an SSCC).
 */
import * as React from "react";
import { z } from "zod";
import { Hash, ListOrdered } from "lucide-react";
import { apiRequest, isApiError } from "@/lib/api-client";
import { applyServerFieldErrors, useApiQuery } from "@/lib/query-client";
import { plural } from "@/lib/grid-defs/facility/common";
import { buildSscc18, companyPrefixFor, LP_CREATE_DEFAULTS, lpCreateSchema, lpUpdateSchema, MAX_LP_BATCH, type LpCreateInput, type LpUpdateInput } from "@/lib/grid-defs/facility/lp-numbers";
import { lpNumberPreview } from "@/lib/grid-defs/facility/lp-types";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Form, FormGrid, FormSection, useZodForm } from "@/components/ui/form";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { ComboField, NumberField, SelectField, TextInput, YesNoField } from "@/components/facility/form-controls";
import { useClientOptions, useWarehouseOptions, apiErrorMessage } from "@/components/facility/facility-shared";
import { useLpTypeOptions, useWarehouseLocationOptions } from "@/components/facility/pickers";
import type { LpNumberDetail } from "@/server/repositories/lp-numbers";

type C = LpCreateInput;
type U = LpUpdateInput;

const warehouseDefaults = z.object({ defaultReceivingLocationId: z.string().nullable(), defaultReceivingLocationCode: z.string().nullable() });

export function CreateLpNumberDrawer({ open, onOpenChange, defaultWarehouseId, onCreated }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly defaultWarehouseId: string | null; readonly onCreated: (numbers: readonly string[]) => void }) {
  const form = useZodForm(lpCreateSchema, { ...LP_CREATE_DEFAULTS, warehouseId: defaultWarehouseId ?? "" });
  React.useEffect(() => { if (open) form.reset({ ...LP_CREATE_DEFAULTS, warehouseId: defaultWarehouseId ?? "" }); }, [open, defaultWarehouseId, form]);
  const warehouses = useWarehouseOptions();
  const clients = useClientOptions();
  const warehouseId = form.watch("warehouseId") || null;
  const types = useLpTypeOptions(warehouseId);
  const locations = useWarehouseLocationOptions(warehouseId, []);
  const wh = useApiQuery<unknown>(["warehouse", warehouseId ?? ""], warehouseId ? `/api/warehouses/${warehouseId}` : null, { staleTime: 30_000 });
  const defaults = warehouseDefaults.safeParse(wh.data?.data);
  const receivingCode = defaults.success ? defaults.data.defaultReceivingLocationCode : null;
  const method = form.watch("method");
  const sscc = form.watch("isSscc18");
  const count = Number(form.watch("count")) || 0;
  const typeId = form.watch("lpTypeId");
  const clientId = form.watch("clientId");
  const type = types.options.find((t) => t.value === typeId);
  const clientCode = clients.find((c) => c.value === clientId)?.label.split(" · ")[0] ?? "";

  const preview = method === "custom"
    ? []
    : sscc
      ? clientId ? [buildSscc18(0, companyPrefixFor(clientCode), 1)].map((n) => `${n.slice(0, 8)}…`) : []
      : type ? Array.from({ length: Math.min(3, Math.max(count, 1)) }, (_, i) => lpNumberPreview(type.prefix, type.length, type.next + i)) : [];

  const submit = async (values: z.output<typeof lpCreateSchema>) => {
    try {
      const { data } = await apiRequest<{ created: number; numbers: string[] }>("/api/lp-numbers", { method: "POST", body: values });
      const range = data.numbers.length > 1 ? `${data.numbers[0]} – ${data.numbers[data.numbers.length - 1]}` : data.numbers[0];
      toast.success("Success", `${plural(data.created, "LP number")} created: ${range}`);
      onCreated(data.numbers);
      onOpenChange(false);
    } catch (error) {
      applyServerFieldErrors(form, error);
      toast.error("Couldn't create LP numbers", apiErrorMessage(error));
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange} dirty={form.formState.isDirty} width={45} title="Create LP number" description="Issue numbers from the LP type's sequence, or register custom numbers."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" type="submit" form="lp-create-form" disabled={form.formState.isSubmitting}>{method === "custom" ? "Create LP number" : `Create ${count > 1 ? `${count} LP numbers` : "LP number"}`}</Button>
        </div>
      }>
      <Form form={form} onSubmit={submit} id="lp-create-form" className="flex flex-col gap-5">
        <FormSection title="Type and location">
          <FormGrid>
            <ComboField<C> name="warehouseId" label="Warehouse" required options={warehouses.options} onValueChange={() => { form.setValue("lpTypeId", ""); form.setValue("locationId", null); }} />
            <SelectField<C> name="lpTypeId" label="LP type" required options={types.options} placeholder={!warehouseId ? "Select a warehouse first" : types.loading ? "Loading…" : types.options.length ? "Select LP type" : "No LP types in this warehouse"} disabled={!warehouseId} />
            <ComboField<C> name="locationId" label="Location" options={locations.options} placeholder={receivingCode ? `Defaults to ${receivingCode}` : "No default receiving location"} disabled={!warehouseId} info="Where the empty LPs start; the warehouse's default receiving location when left blank" />
          </FormGrid>
        </FormSection>
        <div className="flex flex-col gap-3">
          <SegmentedControl<C["method"]> ariaLabel="Create method" value={method} onChange={(v) => form.setValue("method", v, { shouldDirty: true })} options={[{ value: "sequence", label: "From sequence", icon: ListOrdered }, { value: "custom", label: "Custom numbers", icon: Hash }]} />
          {method === "sequence" ? (
            <FormGrid>
              <NumberField<C> name="count" label="LP number count" required min={1} max={MAX_LP_BATCH} nullable />
              <YesNoField<C> name="isSscc18" label="SSCC18" info="GS1 serial shipping container code with a check digit; requires a client" />
              {sscc ? <ComboField<C> name="clientId" label="Client" required options={clients} placeholder="Select client" className="md:col-span-2" /> : null}
            </FormGrid>
          ) : (
            <FormGrid>
              <TextInput<C> name="number" label="LP number" required maxLength={40} transform={(v) => v.toUpperCase()} placeholder="e.g. PLT-CUSTOM-01" />
              <TextInput<C> name="alternateBarcode" label="Alternate barcode" maxLength={60} placeholder="Optional second scan code" />
            </FormGrid>
          )}
          {preview.length ? (
            <div className="rounded-lg border border-border bg-surface-sunken/50 px-3 py-2.5">
              <p className="text-[11px] text-faint">{sscc ? "SSCC18 numbers start with" : count > 3 ? `First 3 of ${count}` : "Will create"}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">{preview.map((n) => <code key={n} className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[12px]">{n}</code>)}</div>
            </div>
          ) : null}
        </div>
      </Form>
    </Drawer>
  );
}

type LpDetailWithLocks = LpNumberDetail & { readonly locks: { readonly number: string | null; readonly isSscc18: string | null } };

function EditForm({ detail, onDone, onCancel, onDirty }: { readonly detail: LpDetailWithLocks; readonly onDone: () => void; readonly onCancel: () => void; readonly onDirty: (d: boolean) => void }) {
  const form = useZodForm(lpUpdateSchema, {
    number: detail.number, alternateBarcode: detail.alternateBarcode ?? "", length: detail.length, width: detail.width, height: detail.height,
    weight: detail.weight, actualVolume: detail.actualVolume, isSscc18: detail.isSscc18, version: detail.version,
  });
  const [conflict, setConflict] = React.useState(false);
  const dirty = form.formState.isDirty;
  React.useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const submit = async (values: z.output<typeof lpUpdateSchema>) => {
    try {
      const { data } = await apiRequest<{ number: string }>(`/api/lp-numbers/${detail.id}`, { method: "PATCH", body: values });
      toast.success("Success", `LP number ${data.number} updated.`);
      onDone();
    } catch (error) {
      if (isApiError(error) && error.code === "CONFLICT") setConflict(true);
      applyServerFieldErrors(form, error);
      toast.error("Couldn't save the LP number", apiErrorMessage(error));
    }
  };
  return (
    <Form form={form} onSubmit={submit} id="lp-edit-form" className="flex flex-col gap-5">
      {conflict ? <Callout variant="attention" title="This record changed since you opened it" action={<Button size="sm" onClick={() => window.location.reload()}>Reload</Button>}>Someone else saved this LP. Reload to see their changes.</Callout> : null}
      <FormSection title="Locked" description="Set when the LP was created.">
        <dl className="grid grid-cols-3 gap-3 text-[13px]">
          <div><dt className="text-[11px] text-faint">Warehouse</dt><dd>{detail.warehouseCode}</dd></div>
          <div><dt className="text-[11px] text-faint">LP type</dt><dd>{detail.lpTypeCode}</dd></div>
          <div><dt className="text-[11px] text-faint">Location</dt><dd>{detail.locationCode ?? "—"}</dd></div>
        </dl>
      </FormSection>
      <FormSection title="Number">
        <FormGrid>
          <TextInput<U> name="number" label="LP number" required maxLength={40} transform={(v) => v.toUpperCase()} disabled={Boolean(detail.locks.number)} info={detail.locks.number ?? undefined} />
          <TextInput<U> name="alternateBarcode" label="Alternate barcode" maxLength={60} />
          <YesNoField<U> name="isSscc18" label="SSCC18" disabled={Boolean(detail.locks.isSscc18)} info={detail.locks.isSscc18 ?? undefined} />
        </FormGrid>
      </FormSection>
      <FormSection title="Dimensions and weight">
        <FormGrid columns={3}>
          <NumberField<U> name="length" label="Length" decimals={2} />
          <NumberField<U> name="width" label="Width" decimals={2} />
          <NumberField<U> name="height" label="Height" decimals={2} />
          <NumberField<U> name="weight" label="Weight" decimals={2} />
          <NumberField<U> name="actualVolume" label="Actual volume" decimals={3} />
        </FormGrid>
      </FormSection>
      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!dirty || form.formState.isSubmitting} title={!dirty ? "Change a field to save" : undefined}>Save</Button>
      </div>
    </Form>
  );
}

export function EditLpNumberDrawer({ id, onOpenChange, onSaved }: { readonly id: string | null; readonly onOpenChange: (o: boolean) => void; readonly onSaved: () => void }) {
  const [dirty, setDirty] = React.useState(false);
  const q = useApiQuery<LpDetailWithLocks>(["lp-number", id ?? ""], id ? `/api/lp-numbers/${id}` : null, { staleTime: 0 });
  const close = () => { setDirty(false); onOpenChange(false); };
  return (
    <Drawer open={id !== null} onOpenChange={(o) => (o ? onOpenChange(o) : close())} dirty={dirty} width={45} title={`Edit LP number ${q.data?.data.number ?? ""}`.trim()} description="Warehouse, type and location are locked after creation.">
      {q.isPending ? <Skeleton className="h-64 w-full" /> : q.isError || !q.data ? <EmptyState title="Couldn't load this LP number" description={q.error?.message} action={<Button onClick={() => void q.refetch()}>Retry</Button>} /> : (
        <EditForm key={q.dataUpdatedAt} detail={q.data.data} onDirty={setDirty} onCancel={close} onDone={() => { setDirty(false); onSaved(); onOpenChange(false); }} />
      )}
    </Drawer>
  );
}
