"use client";

/** The four steps of the Create/Edit Work Order drawer (Logiwa 02 §8, 07 §Kit Inventory wizard). */
import * as React from "react";
import { Boxes, FileText, Paperclip, Pencil, Trash2, Upload } from "lucide-react";
import { ClientSelect, searchPicker, toOption, WarehouseSelect } from "@/components/shared/entity-pickers";
import { CustomFieldsSection } from "@/components/shared/custom-fields-section";
import { Callout } from "@/components/ui/callout";
import { Combobox } from "@/components/ui/combobox";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { NumberInput } from "@/components/ui/number-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { WORK_ORDER_TYPES } from "@/lib/enums";
import { MAX_KIT_QTY, WO_CODE_MAX, WO_INSTRUCTIONS_MAX, WO_NOTE_MAX, type WorkOrderType } from "@/lib/grid-defs/work-orders/work-order-model";
import { MAX_UPLOAD_BYTES } from "@/components/shared/upload-file";
import type { KitDetail } from "../wo-client";
import { Field, MetaChip, TrackFlag } from "../wo-ui";
import { EMPTY_SOURCE, type FormErrors, type WoForm } from "./wo-form";

type Patch = (p: Partial<WoForm>) => void;

/* --------------------------------------------------------------- general */

export function GeneralStep({ form, errors, onChange, lockOrg, lockCore }: { readonly form: WoForm; readonly errors: FormErrors; readonly onChange: Patch; readonly lockOrg: boolean; readonly lockCore: boolean }) {
  const loadOrders = React.useCallback(
    async (q: string, signal: AbortSignal) => (await searchPicker("orders", q, { warehouseId: form.warehouseId, clientId: form.clientId }, signal)).map(toOption),
    [form.warehouseId, form.clientId],
  );
  return (
    <section aria-label="General" className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Field id="warehouseId" label="Warehouse" required error={errors.warehouseId}>
        <WarehouseSelect id="warehouseId" value={form.warehouseId} disabled={lockOrg || lockCore} invalid={Boolean(errors.warehouseId)}
          onChange={(v) => onChange({ warehouseId: v, ...(v !== form.warehouseId ? { clientId: null, kitProductId: null, kitSku: null, sources: {}, shipmentOrderId: null, shipmentOrderCode: null } : {}) })} />
      </Field>
      <Field id="clientId" label="Client" required error={errors.clientId}>
        <ClientSelect id="clientId" warehouseId={form.warehouseId} value={form.clientId} disabled={lockOrg || lockCore || !form.warehouseId} invalid={Boolean(errors.clientId)}
          placeholder={form.warehouseId ? "Select client" : "Select a warehouse first"}
          onChange={(v) => onChange({ clientId: v, ...(v !== form.clientId ? { kitProductId: null, kitSku: null, sources: {}, shipmentOrderId: null, shipmentOrderCode: null } : {}) })} />
      </Field>
      <Field id="code" label="Work order code" required error={errors.code} info="Suggested from the work order sequence; you can type your own.">
        <TextField id="code" value={form.code} maxLength={WO_CODE_MAX} placeholder="Enter Work Order Code" invalid={Boolean(errors.code)} onChange={(e) => onChange({ code: e.target.value })} />
      </Field>
      <Field id="type" label="Work order type" required error={errors.type}
        info="With picking: components are allocated and picked to the kitting area by a job. Without picking: components are consumed straight from the source you choose for each.">
        <Select id="type" value={form.type} placeholder="Select Work Order Type" disabled={lockCore} invalid={Boolean(errors.type)}
          onChange={(v) => onChange({ type: (v as WorkOrderType | null) ?? null })}
          options={WORK_ORDER_TYPES.map((t) => ({ value: t, label: t, description: t === "Work Order with Picking" ? "Allocate and pick components with a job" : "Consume components from chosen sources" }))} />
      </Field>
      <Field id="extraNote" label="Extra note" className="md:col-span-2">
        <Textarea id="extraNote" value={form.extraNote} maxLength={WO_NOTE_MAX} showCount rows={3} placeholder="Enter extra note" onChange={(e) => onChange({ extraNote: e.target.value })} />
      </Field>
      <Field id="buildFor" label="Build for" info="Stock builds kits into inventory. SO ties the work order to a shipment order that needs the kits.">
        <SegmentedControl ariaLabel="Build for" value={form.buildFor} onChange={(v) => onChange({ buildFor: v, ...(v === "Stock" ? { shipmentOrderId: null, shipmentOrderCode: null } : {}) })}
          options={[{ value: "Stock", label: "Stock" }, { value: "SO", label: "SO" }]} />
      </Field>
      {form.buildFor === "SO" ? (
        <Field id="shipmentOrderId" label="Shipment order" required error={errors.shipmentOrderId}>
          <Combobox id="shipmentOrderId" aria-label="Shipment order" loadOptions={loadOrders} minChars={0} value={form.shipmentOrderId}
            selectedOptions={form.shipmentOrderId && form.shipmentOrderCode ? [{ value: form.shipmentOrderId, label: form.shipmentOrderCode }] : undefined}
            onChange={(v, o) => onChange({ shipmentOrderId: v, shipmentOrderCode: o?.label ?? null })} placeholder="Select Shipment Order"
            disabled={!form.clientId} invalid={Boolean(errors.shipmentOrderId)} emptyText="No open orders for this client" />
        </Field>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------- kit */

export interface KitStepProps {
  readonly form: WoForm;
  readonly errors: FormErrors;
  readonly onChange: Patch;
  readonly kit: KitDetail | null;
  readonly kitLoading: boolean;
  readonly lockCore: boolean;
  readonly onEditSource: (productId: string) => void;
}

export function KitStep({ form, errors, onChange, kit, kitLoading, lockCore, onEditSource }: KitStepProps) {
  const loadKits = React.useCallback(async (q: string, signal: AbortSignal) => {
    if (!form.clientId) return [];
    const rows = await apiFetch<readonly { id: string; label: string; description: string }[]>("/api/kits/search", { query: { clientId: form.clientId, q, limit: 50 }, signal });
    return rows.map((r) => ({ value: r.id, label: r.label, description: r.description }));
  }, [form.clientId]);
  const qty = form.requestedQty ?? 0;
  const totalUnits = (kit?.components ?? []).reduce((s, c) => s + c.bomQty * qty, 0);
  const withoutPicking = form.type === "Work Order without Picking";
  return (
    <section aria-label="Kit" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div>
          <h3 className="text-[13px] font-semibold text-foreground">Select kit</h3>
          <p className="text-[12px] text-secondary">The kit-to-stock product selection for this work order</p>
        </div>
        <Field id="kitProductId" label="Kit SKU" required error={errors.kitProductId}>
          <Combobox id="kitProductId" aria-label="Kit SKU" loadOptions={loadKits} minChars={0} value={form.kitProductId}
            selectedOptions={form.kitProductId && form.kitSku ? [{ value: form.kitProductId, label: form.kitSku }] : undefined}
            onChange={(v, o) => onChange({ kitProductId: v, kitSku: o?.label ?? null, sources: {} })}
            placeholder={form.clientId ? "Search kit SKU or name" : "Select a client in step 1 first"} disabled={!form.clientId || lockCore}
            invalid={Boolean(errors.kitProductId)} emptyText="No kit-to-stock products for this client" />
        </Field>
        {kitLoading ? <Skeleton className="h-24 w-full" /> : kit ? (
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface p-3 shadow-xs">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-sunken text-faint">
              {kit.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- product images come from arbitrary CDNs
                <img src={kit.imageUrl} alt="" width={56} height={56} className="h-full w-full object-cover" />
              ) : <Boxes className="h-6 w-6" aria-hidden />}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[14px] font-semibold text-foreground">{kit.sku}</span>
                <span className="truncate text-[12px] text-secondary">{kit.name}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <MetaChip label="Pack type" value={kit.packType} />
                <TrackFlag label="Lot number tracking" on={kit.trackLot} />
                <TrackFlag label="Exp. date tracking" on={kit.trackExpiry} />
                <TrackFlag label="Prod. date tracking" on={kit.trackProductionDate} />
              </div>
              {form.warehouseId ? (
                <p className="text-[11px] text-secondary">
                  On hand <strong className="tabular-nums text-foreground">{kit.onHandQty}</strong> · can build <strong className={cn("tabular-nums", kit.netKittingCapacity >= qty ? "text-success" : "text-warning")}>{kit.netKittingCapacity}</strong> from free component stock
                </p>
              ) : null}
            </div>
            <Field id="requestedQty" label="Kit quantity" required error={errors.requestedQty} className="w-40">
              <NumberInput id="requestedQty" value={form.requestedQty} min={1} max={MAX_KIT_QTY} disabled={lockCore} invalid={Boolean(errors.requestedQty)} onChange={(v) => onChange({ requestedQty: v })} />
            </Field>
          </div>
        ) : null}
      </div>

      {kit ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-[13px] font-semibold text-foreground">Components</h3>
              <p className="text-[12px] text-secondary">Components of the selected kit-to-stock product</p>
            </div>
            <div className="flex items-center gap-2 text-[12px]">
              <span className="rounded-md bg-surface-sunken px-2 py-1"><strong className="tabular-nums text-foreground">{kit.components.length}</strong> Component Qty</span>
              <span className="rounded-md bg-surface-sunken px-2 py-1"><strong className="tabular-nums text-foreground">{totalUnits}</strong> Total Qty</span>
            </div>
          </div>
          {withoutPicking ? <Callout variant="info">Without picking, every component needs a source. Use the pencil to choose the location, LP and lot it is consumed from.</Callout> : null}
          <ul className="flex flex-col gap-2">
            {kit.components.map((c) => {
              const src = form.sources[c.productId] ?? EMPTY_SOURCE;
              const need = c.bomQty * qty;
              const err = errors[`components.${c.productId}`];
              return (
                <li key={c.productId} data-field={`components.${c.productId}`} className={cn("flex flex-col gap-2 rounded-lg border bg-surface p-3", err ? "border-danger" : "border-border")}>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[13px] font-semibold text-foreground">{c.sku}</span>
                      <span className="truncate text-[12px] text-secondary">{c.name}</span>
                    </div>
                    <span className="text-[12px] text-secondary">Pack type <strong className="text-foreground">{c.packType}</strong></span>
                    <span className="text-[12px] text-secondary">BOM <strong className="tabular-nums text-foreground">{c.bomQty}</strong></span>
                    <span className="text-[12px] text-secondary">Qty <strong className="tabular-nums text-foreground">{need}</strong></span>
                    <Tooltip content={form.warehouseId ? "Free stock in the selected warehouse" : "Select a warehouse to see stock"}>
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", c.freeQty >= need ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>{c.freeQty} free</span>
                    </Tooltip>
                    <Tooltip content={lockCore ? "Sources are locked after picking started" : "Edit source inventory"}>
                      <button type="button" aria-label={`Edit source of ${c.sku}`} disabled={lockCore} onClick={() => onEditSource(c.productId)}
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-border-strong/70 text-secondary transition-colors hover:bg-surface-sunken hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-45">
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </Tooltip>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <MetaChip label="Location" value={src.locationCode} />
                    <MetaChip label="LP" value={src.lpNumber} />
                    <MetaChip label="Lot No" value={src.lotNumber} />
                    <MetaChip label="Exp Date" value={src.expiryDate?.slice(0, 10)} />
                    <MetaChip label="Prod Date" value={src.productionDate?.slice(0, 10)} />
                  </div>
                  {err ? <p role="alert" className="text-[12px] font-medium text-danger">{err}</p> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : !kitLoading && form.clientId ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
          <Boxes className="mx-auto h-6 w-6 text-faint" aria-hidden />
          <p className="mt-2 text-[13px] font-semibold text-foreground">No kit selected</p>
          <p className="text-[12px] text-secondary">Pick a kit-to-stock SKU to see its components and quantities.</p>
        </div>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------- advanced */

export function AdvancedStep({ form, errors, onChange, files, onFiles }: { readonly form: WoForm; readonly errors: FormErrors; readonly onChange: Patch; readonly files: readonly File[]; readonly onFiles: (files: readonly File[]) => void }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const dates = [
    ["plannedStartAt", "Planned start date"], ["plannedFinishAt", "Planned finish date"], ["actualStartAt", "Actual start date"], ["actualFinishAt", "Actual finish date"],
  ] as const;
  return (
    <section aria-label="Advanced" className="flex flex-col gap-5">
      <Field id="kittingInstructions" label="Kitting instructions">
        <Textarea id="kittingInstructions" value={form.kittingInstructions} maxLength={WO_INSTRUCTIONS_MAX} showCount rows={4} placeholder="Steps, packaging and quality checks for the kitting station" onChange={(e) => onChange({ kittingInstructions: e.target.value })} />
      </Field>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {dates.map(([key, label]) => (
          <Field key={key} id={key} label={label} error={errors[key]}>
            <DateTimePicker id={key} value={form[key]} onChange={(d) => onChange({ [key]: d } as Partial<WoForm>)} invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `${key}-err` : undefined} />
          </Field>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <div>
          <h3 className="text-[13px] font-semibold text-foreground">Document</h3>
          <p className="text-[12px] text-secondary">Upload documents for the kitting process</p>
        </div>
        <input ref={inputRef} type="file" multiple className="sr-only" aria-label="Upload document" accept="image/*,application/pdf"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            const tooBig = picked.find((f) => f.size > MAX_UPLOAD_BYTES);
            setFileError(tooBig ? `${tooBig.name} is larger than 10 MB` : null);
            onFiles([...files, ...picked.filter((f) => f.size <= MAX_UPLOAD_BYTES)]);
            e.target.value = "";
          }} />
        <button type="button" onClick={() => inputRef.current?.click()}
          className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong/70 bg-surface-sunken/40 px-4 py-5 text-[13px] font-semibold text-primary transition-colors hover:border-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
          <Upload className="h-4 w-4" aria-hidden />Upload document
          <span className="font-normal text-secondary">PDF or image, up to 10 MB each</span>
        </button>
        {fileError ? <p role="alert" className="text-[12px] text-danger">{fileError}</p> : null}
        {files.length ? (
          <ul className="flex flex-col gap-1.5">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[12px]">
                {f.type === "application/pdf" ? <FileText className="h-3.5 w-3.5 text-secondary" aria-hidden /> : <Paperclip className="h-3.5 w-3.5 text-secondary" aria-hidden />}
                <span className="min-w-0 flex-1 truncate text-foreground">{f.name}</span>
                <span className="text-faint">{Math.max(1, Math.round(f.size / 1024))} KB</span>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onFiles(files.filter((_, j) => j !== i))} className="rounded p-1 text-faint hover:bg-danger-soft hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {files.length ? <p className="text-[11px] text-secondary">Files are attached to the work order when you save.</p> : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ other info */

export function OtherStep({ form, onChange, canManage }: { readonly form: WoForm; readonly onChange: Patch; readonly canManage: boolean }) {
  return (
    <section aria-label="Other info" className="flex flex-col gap-3">
      <p className="text-[12px] text-secondary">You can optionally add or edit custom fields under &lsquo;Other Info&rsquo; tab.</p>
      <CustomFieldsSection entityType="work_order" values={form.customFields} onChange={(v) => onChange({ customFields: v })} canManage={canManage} />
    </section>
  );
}
