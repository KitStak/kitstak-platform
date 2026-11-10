"use client";

/** The four steps of the Create/Edit Work Order drawer (Logiwa 02 §8, 07 §Kit Inventory wizard). */
import * as React from "react";
import { Boxes, FileText, Lock, Wand2, Paperclip, Pencil, RefreshCw, Trash2, Upload } from "lucide-react";
import { ClientSelect, searchPicker, toOption, WarehouseSelect } from "@/components/shared/entity-pickers";
import { CustomFieldsSection } from "@/components/shared/custom-fields-section";
import { Callout } from "@/components/ui/callout";
import { Combobox } from "@/components/ui/combobox";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { parseNumberText } from "@/components/ui/number-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { WORK_ORDER_TYPES } from "@/lib/enums";
import { kitQtyError, MAX_KIT_QTY, WO_CODE_MAX, WO_INSTRUCTIONS_MAX, WO_NOTE_MAX, type WorkOrderType } from "@/lib/grid-defs/work-orders/work-order-model";
import { MAX_UPLOAD_BYTES } from "@/components/shared/upload-file";
import { suggestSource } from "@/lib/grid-defs/work-orders/source-suggest";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { KitDetail, StockBucket } from "../wo-client";
import { Field, MetaChip, TrackFlag } from "../wo-ui";
import { EMPTY_SOURCE, type FormErrors, type WoForm } from "./wo-form";

type Patch = (p: Partial<WoForm>) => void;

/**
 * Kit quantity input. Unlike the shared NumberInput (which rounds to its decimals), it never
 * rewrites what was typed: 2.5 stays 2.5 and shows "Whole kits only", -5 shows "At least 1".
 * Only values above MAX_KIT_QTY are clamped (the field never holds an impossible total).
 */
export function KitQtyInput({ id, value, disabled, invalid, onChange, describedBy }: {
  readonly id: string; readonly value: number | null; readonly disabled?: boolean; readonly invalid?: boolean;
  readonly onChange: (v: number | null) => void; readonly describedBy?: string;
}) {
  const show = (v: number | null) => (v === null || v === undefined || Number.isNaN(v) ? "" : String(v));
  const [text, setText] = React.useState(() => show(value));
  const [focused, setFocused] = React.useState(false);
  React.useEffect(() => { if (!focused) setText(show(value)); }, [value, focused]);
  const set = (t: string) => {
    const n = parseNumberText(t);
    if (n !== null && !Number.isNaN(n) && n > MAX_KIT_QTY) { setText(String(MAX_KIT_QTY)); onChange(MAX_KIT_QTY); return; }
    setText(t);
    onChange(n);
  };
  return (
    <TextField id={id} inputMode="numeric" autoComplete="off" value={text} disabled={disabled} invalid={invalid} aria-describedby={describedBy}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        const base = value !== null && Number.isFinite(value) ? Math.trunc(value) : 0;
        set(String(Math.max(1, base + (e.key === "ArrowUp" ? 1 : -1))));
      }}
      onChange={(e) => set(e.target.value)} />
  );
}

/* --------------------------------------------------------------- general */

export function GeneralStep({ form, errors, onChange, lockOrg, lockCore, codeLoading = false, codeError = null, onRetryCode, suggestedCode = null, codeChecking = false }: {
  readonly form: WoForm; readonly errors: FormErrors; readonly onChange: Patch; readonly lockOrg: boolean; readonly lockCore: boolean;
  /** The next-code suggestion is loading (create). */
  readonly codeLoading?: boolean;
  readonly codeError?: string | null;
  readonly onRetryCode?: () => void;
  /** The sequence's next code (create); offered as "Use …" when the field holds something else. */
  readonly suggestedCode?: string | null;
  /** The on-blur uniqueness check is running. */
  readonly codeChecking?: boolean;
}) {
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
        <div className="flex flex-col gap-1">
          <TextField id="code" value={form.code} maxLength={WO_CODE_MAX} placeholder={codeLoading && !form.code ? "Loading next code…" : "Enter work order code"} invalid={Boolean(errors.code)}
            aria-busy={(codeLoading && !form.code) || codeChecking} trailing={codeLoading && !form.code ? <Spinner className="h-3.5 w-3.5" label="Loading next code" /> : codeChecking ? <Spinner className="h-3.5 w-3.5" label="Checking code" /> : undefined}
            onChange={(e) => onChange({ code: e.target.value })} />
          {codeError && !form.code ? (
            <p className="text-[11px] text-secondary">The next code could not be loaded. <button type="button" onClick={onRetryCode} className="font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">Retry</button> or type a code.</p>
          ) : null}
          {suggestedCode && form.code.trim() !== suggestedCode && !lockCore ? (
            <p className="text-[11px] text-secondary">
              Next in sequence: <button type="button" onClick={() => onChange({ code: suggestedCode })} className="font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">Use {suggestedCode}</button>
            </p>
          ) : null}
        </div>
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
          className="w-fit self-start [&>button]:min-w-[72px] [&>button]:justify-center"
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
  /** The kit fetch failed (message from the server); shown with Retry instead of a spinner. */
  readonly kitError?: string | null;
  readonly kitRetrying?: boolean;
  readonly onRetryKit?: () => void;
  readonly lockCore: boolean;
  readonly onEditSource: (productId: string) => void;
  /** Count plan code per component whose saved source is locked (edit). */
  readonly sourceLocks?: Readonly<Record<string, string>>;
  /** Auto-assign in flight (lifted so the wizard can hold Next). */
  readonly assigning: boolean;
  readonly onAssigning: (busy: boolean) => void;
}

export function KitStep({ form, errors, onChange, kit, kitLoading, kitError = null, kitRetrying = false, onRetryKit, lockCore, onEditSource, assigning: assigningExternal, onAssigning, sourceLocks }: KitStepProps) {
  const loadKits = React.useCallback(async (q: string, signal: AbortSignal) => {
    if (!form.clientId) return [];
    const rows = await apiFetch<readonly { id: string; label: string; description: string }[]>("/api/kits/search", { query: { clientId: form.clientId, q, limit: 50 }, signal });
    return rows.map((r) => ({ value: r.id, label: r.label, description: r.description }));
  }, [form.clientId]);
  // Keep invalid totals (e.g. 399999996) out of the component chips.
  const qty = kitQtyError(form.requestedQty) ? 0 : (form.requestedQty ?? 0);
  const totalUnits = (kit?.components ?? []).reduce((s, c) => s + c.bomQty * qty, 0);
  const assigning = assigningExternal;
  const [autoAssigned, setAutoAssigned] = React.useState(false);
  const autoAssign = async () => {
    if (!kit || !form.warehouseId) return;
    onAssigning(true);
    try {
      // One batched request for every component (lock-aware buckets).
      const all = await apiFetch<Record<string, StockBucket[]>>("/api/kits/sources", {
        query: { productIds: kit.components.map((c) => c.productId).join(","), warehouseId: form.warehouseId, clientId: form.clientId ?? "" },
      });
      const next = { ...form.sources };
      const missing: string[] = [];
      const lockedOnly: string[] = [];
      for (const c of kit.components) {
        const buckets = all[c.productId] ?? [];
        const pick = suggestSource(buckets, c.bomQty * qty);
        if (!pick) {
          if (buckets.some((b) => b.freeQty > 0 && b.lockedBy)) lockedOnly.push(c.sku); else missing.push(c.sku);
          continue;
        }
        next[c.productId] = { locationId: pick.locationId, locationCode: pick.locationCode, lpId: pick.lpId, lpNumber: pick.lpNumber, lotNumber: pick.lotNumber, expiryDate: pick.expiryDate, productionDate: pick.productionDate };
      }
      onChange({ sources: next });
      setAutoAssigned(true);
      const assigned = kit.components.length - missing.length - lockedOnly.length;
      if (missing.length || lockedOnly.length) {
        toast.warning(`${assigned} of ${kit.components.length} sources assigned`, [
          missing.length ? `No free stock for ${missing.join(", ")}.` : null,
          lockedOnly.length ? `Only count-locked stock for ${lockedOnly.join(", ")}.` : null,
        ].filter(Boolean).join(" "));
      } else toast.success("Sources assigned", `FEFO/FIFO sources set for ${kit.components.length} component${kit.components.length === 1 ? "" : "s"}. Count-locked locations were skipped.`);
    } catch (error) {
      toast.error("Error", error instanceof Error ? error.message : "Stock could not be loaded");
    } finally {
      onAssigning(false);
    }
  };
  const withoutPicking = form.type === "Work Order without Picking";
  const assignedCount = (kit?.components ?? []).filter((c) => form.sources[c.productId]?.locationId).length;
  const allAssigned = Boolean(kit && kit.components.length > 0 && assignedCount === kit.components.length);
  const assignedBy = autoAssigned && allAssigned ? "FEFO" : null;
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
        {kitError && !kit ? (
          <Callout variant="error" title={`Couldn't load kit ${form.kitSku ?? ""}`.trim()}
            action={onRetryKit ? (
              <Button type="button" size="sm" variant="secondary" onClick={onRetryKit} disabled={kitRetrying} aria-busy={kitRetrying}>
                {kitRetrying ? <Spinner className="h-3.5 w-3.5" label="Retrying" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}Retry
              </Button>
            ) : undefined}>
            <span className="block">{kitError}</span>
            <span className="block text-secondary">The components and quantities can&rsquo;t be shown until the kit loads. Retry, or choose another kit.</span>
          </Callout>
        ) : kitLoading ? (
          <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3"><Spinner className="h-4 w-4" label="Loading kit" /><span className="text-[12px] text-secondary">Loading kit and components…</span><Skeleton className="ml-auto h-10 w-40" /></div>
        ) : kit ? (
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
                  On hand <strong className="tabular-nums text-foreground">{kit.onHandQty}</strong> · can build <strong className={cn("tabular-nums", kit.netKittingCapacity >= qty ? "text-success" : "text-warning")}>{kit.netKittingCapacity}</strong> from usable component stock
                  {kit.components.some((c) => (c.lockedQty ?? 0) > 0) ? <span className="text-warning"> · count-locked stock excluded ({[...new Set(kit.components.flatMap((c) => c.lockedBy ?? []))].join(", ")})</span> : null}
                </p>
              ) : null}
            </div>
            {/* Typed values are kept as typed (decimals and negatives show an inline error); only > MAX_KIT_QTY is clamped. */}
            <Field id="requestedQty" label="Kit quantity" required error={errors.requestedQty ?? (lockCore ? undefined : kitQtyError(form.requestedQty) ?? undefined)} className="w-44" info={`1 to ${MAX_KIT_QTY.toLocaleString("en-US")} kits.`}>
              <KitQtyInput id="requestedQty" value={form.requestedQty} disabled={lockCore} invalid={Boolean(errors.requestedQty) || (!lockCore && Boolean(kitQtyError(form.requestedQty)))} onChange={(v) => onChange({ requestedQty: v })} />
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
          {withoutPicking ? (
            <Callout variant={allAssigned ? "success" : "attention"} title={allAssigned ? `All ${kit.components.length} source${kit.components.length === 1 ? "" : "s"} assigned${assignedBy ? ` (${assignedBy})` : ""}` : `${assignedCount} of ${kit.components.length} sources assigned`} action={!lockCore && form.warehouseId ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => void autoAssign()} disabled={assigning} aria-busy={assigning}>
                {assigning ? <Spinner className="h-3.5 w-3.5" label="Assigning" /> : <Wand2 className="h-3.5 w-3.5" aria-hidden />}Auto-assign all sources
              </Button>
            ) : undefined}>{allAssigned
              ? "Every component has a source. Use the pencil to change a location, LP or lot."
              : <>Without picking, every component needs a source. Use the pencil to choose the location, LP and lot, or auto-assign FEFO/FIFO sources. Locations locked by a count plan can&rsquo;t be used.</>}</Callout>
          ) : null}
          {assigning && kit ? (
            <p role="status" aria-live="polite" className="flex items-center gap-2 text-[12px] text-secondary">
              <Spinner className="h-3.5 w-3.5" label="Assigning" />Finding FEFO/FIFO sources for {kit.components.length} component{kit.components.length === 1 ? "" : "s"}…
            </p>
          ) : null}
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
                    <Tooltip content={!form.warehouseId ? "Select a warehouse to see stock" : (c.lockedQty ?? 0) > 0 ? `Usable free stock in the selected warehouse. ${c.lockedQty} more sit in locations locked by count plan ${(c.lockedBy ?? []).join(", ")} and can't be used until the count is finished or cancelled.` : "Usable free stock in the selected warehouse (count-locked locations excluded)"}>
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", c.freeQty >= need && need > 0 ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>
                        {c.freeQty} free{(c.lockedQty ?? 0) > 0 ? <><span aria-hidden>·</span><Lock className="h-2.5 w-2.5" aria-hidden />{c.lockedQty} locked</> : null}
                      </span>
                    </Tooltip>
                    <Tooltip content={lockCore ? "Sources are locked after picking started" : "Edit source inventory"}>
                      <button type="button" aria-label={`Edit source of ${c.sku}`} disabled={lockCore || assigning} onClick={() => onEditSource(c.productId)}
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
                  {!err && sourceLocks?.[c.productId] ? (
                    <p className="flex items-center gap-1.5 text-[12px] font-medium text-danger"><Lock className="h-3 w-3" aria-hidden />{src.locationCode ?? "The source"} is locked by count plan {sourceLocks[c.productId]}. Kits can&rsquo;t be built from it until the count is finished; choose another source.</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : !kitLoading && !kitError && form.clientId ? (
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

export function AdvancedStep({ form, errors, onChange, files, onFiles, isNew = false }: {
  readonly form: WoForm; readonly errors: FormErrors; readonly onChange: Patch; readonly files: readonly File[]; readonly onFiles: (files: readonly File[]) => void; readonly isNew?: boolean;
}) {
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
        {dates.map(([key, label]) => {
          // Actual dates are stamped by kitting (Logiwa: disabled on create); they can be corrected later.
          const locked = isNew && (key === "actualStartAt" || key === "actualFinishAt");
          return (
            <Field key={key} id={key} label={label} error={errors[key]} info={locked ? "Stamped when kitting starts and finishes. You can correct it after the work order is created." : undefined}>
              <DateTimePicker id={key} value={form[key]} disabled={locked} onChange={(d) => onChange({ [key]: d } as Partial<WoForm>)} invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `${key}-err` : undefined} />
            </Field>
          );
        })}
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
