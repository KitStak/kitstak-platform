"use client";

/**
 * Create RMA (`/orders/returns/new?orderIds=`, M04 §7, KitStaks-designed). Linear wizard:
 * 1 Order (shipped orders only) → 2 Items (qty capped at shipped − already returned,
 * customer reason) → 3 Return shipping (expected date, optional return label through
 * shipping ops `return-label`, note) → success screen with the label.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { Box, ClipboardList, FileText, PackageSearch, Plus, Printer, ScanLine, Truck } from "lucide-react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { RailRow, Wizard, WizardRail, WizardSuccess, type WizardStep } from "@/components/ui/wizard";
import { apiRequest } from "@/lib/api-client";
import { useFormat } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import type { ApiQueryData } from "@/lib/query-client";
import { EMPTY_LABEL, ReturnLabelFields, type LabelErrors } from "./return-label-fields";
import type { ShippableOrder } from "./return-types";
import { ShippedOrderPicker } from "./shipped-order-picker";
import { isoFromLocalDate, localDateFromIso } from "./date-only";
import { ManualReturnInfoFields, ReturnAddressField } from "./return-info-fields";
import { errorText, openFileId, useHydrated, useInvalidateReturns, useLookupState } from "./returns-client";
import { buildCreatePayload, EMPTY_RETURN_INFO, initialLines, lineEdit, linesStepSchema, orderStepSchema, rmaProgress, selectedUnits, shippingStepSchema, type RmaFormValues } from "./rma-form";

interface CreatedRma {
  readonly id: string;
  readonly rmaCode: string;
  readonly status: string;
  readonly trackingNumber: string | null;
  readonly labelFileId: string | null;
  readonly labelError: string | null;
}

type ShippableResponse = readonly (ShippableOrder | { readonly id: string; readonly missing: true })[];

/** Abort a shippable-order load after this long and offer Retry instead of an endless spinner. */
export const SHIPPABLE_TIMEOUT_MS = 15_000;

function useShippable(orderId: string) {
  // One fetch per chosen order: cached for a minute (no refetch on remount / focus), timed out
  // after SHIPPABLE_TIMEOUT_MS so the step shows a Retry callout.
  const q = useQuery<ApiQueryData<ShippableResponse>, Error>({
    queryKey: ["returns", "shippable", orderId, { orderIds: orderId }], enabled: Boolean(orderId),
    staleTime: 60_000, retry: 0, refetchOnWindowFocus: false, refetchOnMount: false,
    // No abort on unmount: a remount (dev strict mode, wizard re-render) reuses the in-flight
    // request instead of cancelling it and fetching the same order again.
    queryFn: () => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(new DOMException("timeout", "TimeoutError")), SHIPPABLE_TIMEOUT_MS);
      return apiRequest<ShippableResponse>("/api/returns/shippable", { query: { orderIds: orderId }, signal: ctl.signal })
        .catch((e: unknown) => {
          if (ctl.signal.aborted) throw new Error("The order took too long to load. Check your connection and retry.");
          throw e;
        })
        .finally(() => clearTimeout(timer));
    },
  });
  const first = q.data?.data[0];
  const order = first && !("missing" in first) ? first : null;
  return { q, order, missing: Boolean(first && "missing" in first) };
}

function err(form: UseFormReturn<RmaFormValues>, path: string): string | undefined {
  const state = form.getFieldState(path as never, form.formState) as { readonly error?: { readonly message?: string } };
  return state.error?.message;
}

function OrderCard({ order }: { readonly order: ShippableOrder }) {
  const fmt = useFormat();
  return (
    <div className="grid gap-3 rounded-lg border border-border bg-surface-sunken/50 p-4 sm:grid-cols-4">
      <div><p className="text-2xs font-semibold text-secondary">Order</p><p className="mt-0.5 flex items-center gap-2 font-semibold">{order.code}<StatusPill status={order.status} domain="shipmentOrder" size="sm" /></p></div>
      <div><p className="text-2xs font-semibold text-secondary">Customer</p><p className="mt-0.5">{order.customerName}</p><p className="text-2xs text-secondary">{order.shipTo}</p></div>
      <div><p className="text-2xs font-semibold text-secondary">Client</p><p className="mt-0.5">{order.clientName}</p><p className="text-2xs text-secondary">{order.storeOrderNumber ? `Store order ${order.storeOrderNumber}` : "No store order #"}</p></div>
      <div><p className="text-2xs font-semibold text-secondary">Shipped</p><p className="mt-0.5">{order.shippedAt ? fmt.gridDateTime(order.shippedAt) : "—"}</p><p className="text-2xs text-secondary">{order.deliveredAt ? `Delivered ${fmt.date(order.deliveredAt)}` : "Not delivered yet"}</p></div>
    </div>
  );
}

function OrderStep({ form, order, loading, missing, onPick, loadError, onRetry }: { readonly form: UseFormReturn<RmaFormValues>; readonly order: ShippableOrder | null; readonly loading: boolean; readonly missing: boolean; readonly onPick: () => void; readonly loadError: string | null; readonly onRetry: () => void }) {
  const error = err(form, "orderId");
  // A click before hydration would be dropped; the button stays disabled (with a spinner) until then.
  const hydrated = useHydrated();
  return (
    <div className="space-y-4" data-invalid={error ? "true" : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-secondary">Returns start from a shipped or delivered order. Each RMA covers one order.</p>
        <Button variant={order ? "secondary" : "primary"} onClick={onPick} disabled={!hydrated} title={hydrated ? undefined : "Loading…"} aria-invalid={error ? true : undefined}>{hydrated ? <PackageSearch className="h-3.5 w-3.5" aria-hidden /> : <Spinner className="h-3.5 w-3.5" label="Loading" />}{order ? "Choose another order" : "Choose a shipped order"}</Button>
      </div>
      {loadError && !order ? <Callout variant="error" title="Could not load the order" action={<Button size="sm" onClick={onRetry}>Retry</Button>}>{loadError}</Callout> : loading ? (
        <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-lg border border-border bg-surface-sunken/50 p-4 text-sm text-secondary"><Spinner className="h-4 w-4" label="Loading" />Loading the order and its returnable lines…</div>
      ) : order ? <OrderCard order={order} /> : missing ? <Callout variant="error" title="Order not found">The order doesn&apos;t exist or is outside your warehouses and clients.</Callout> : (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-secondary">No order chosen yet.</div>
      )}
      {order && !order.eligible ? <Callout variant="attention" title="This order can't be returned">{order.reason}</Callout> : null}
      {error && !loading && !(order && !order.eligible) ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
      {!order && !error ? <p id="rma-next-reason" className="text-xs text-secondary">{loading ? "Next unlocks when the order has loaded." : loadError ? "Retry loading the order, or choose another one, to continue." : "Choose a shipped order to continue. Next stays unavailable until then."}</p> : null}
    </div>
  );
}

function ItemsStep({ form, order, reasons, reasonsLoading }: { readonly form: UseFormReturn<RmaFormValues>; readonly order: ShippableOrder | null; readonly reasons: readonly { value: string; label: string }[]; readonly reasonsLoading: boolean }) {
  const lines = form.watch("lines");
  /** Lines where the typed quantity went over what is returnable (shown as "Max N" instead of a silent clamp). */
  const [over, setOver] = React.useState<Readonly<Record<string, boolean>>>({});
  if (!order) return <Callout variant="attention" title="Choose an order first">Go back to the Order step.</Callout>;
  const setLine = (i: number, patch: Partial<RmaFormValues["lines"][number]>) => {
    const next = lines.map((l, j) => (j === i ? { ...l, ...patch } : l));
    form.setValue("lines", next, { shouldDirty: true, shouldValidate: false });
  };
  const allError = err(form, "lines");
  const selectable = order.lines.filter((l) => l.returnable > 0 && !l.isNonReturnable);
  const allOn = selectable.length > 0 && selectable.every((l) => lines.find((x) => x.orderLineId === l.orderLineId)?.selected);
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-border bg-surface-sunken/60 text-2xs font-semibold text-secondary">
            <tr>
              <th className="w-10 px-3 py-2"><Checkbox aria-label="Select all returnable items" checked={allOn} onCheckedChange={(c) => form.setValue("lines", lines.map((l) => {
                const src = order.lines.find((x) => x.orderLineId === l.orderLineId);
                const ok = Boolean(src && src.returnable > 0 && !src.isNonReturnable);
                return ok && src ? lineEdit(l, src.returnable, { selected: c === true }) : l;
              }), { shouldDirty: true })} /></th>
              <th className="px-3 py-2 text-left">Product</th>
              <th className="px-3 py-2 text-right">Shipped</th>
              <th className="px-3 py-2 text-right">Already returned</th>
              <th className="w-[130px] px-3 py-2 text-left">Return qty *</th>
              <th className="w-[240px] px-3 py-2 text-left">Customer return reason</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((src, i) => {
              const v = lines[i];
              if (!v) return null;
              const blocked = src.isNonReturnable ? "Marked non-returnable" : src.returnable === 0 ? "Fully returned" : null;
              const qErr = err(form, `lines.${i}.quantity`);
              const rErr = err(form, `lines.${i}.reasonId`);
              return (
                <tr key={src.orderLineId} className={`border-b border-border last:border-0 ${blocked ? "bg-surface-sunken/40 text-secondary" : v.selected ? "bg-primary-soft/40" : ""}`}>
                  <td className="px-3 py-2 align-top"><Checkbox aria-label={`Return ${src.sku}`} disabled={Boolean(blocked)} checked={v.selected} onCheckedChange={(c) => setLine(i, lineEdit(v, src.returnable, { selected: c === true }))} /></td>
                  <td className="px-3 py-2 align-top"><p className="font-medium text-foreground">{src.sku}</p><p className="max-w-[260px] truncate text-2xs text-secondary">{src.name} · {src.packType}</p>{blocked ? <p className="text-2xs text-warning">{blocked}</p> : null}</td>
                  <td className="px-3 py-2 text-right align-top tabular-nums">{src.shippedQty}</td>
                  <td className="px-3 py-2 text-right align-top tabular-nums">{src.alreadyReturned}</td>
                  <td className="px-3 py-2 align-top">
                    <NumberInput aria-label={`Return quantity for ${src.sku}`} value={v.quantity} min={0} max={src.returnable} placeholder="0" disabled={Boolean(blocked)} invalid={Boolean(qErr)}
                      onChange={(n) => setLine(i, lineEdit(v, src.returnable, { quantity: n === null ? null : Math.min(n, src.returnable) }))} suffix={<span className="text-2xs text-secondary">/ {src.returnable}</span>}
                      onInput={(e) => { const typed = Number((e.target as HTMLInputElement).value.replace(/,/g, "")); setOver((o) => ({ ...o, [src.orderLineId]: Number.isFinite(typed) && typed > src.returnable })); }} />
                    {qErr ? <p className="mt-1 text-2xs text-danger">{qErr}</p> : over[src.orderLineId] ? <p role="status" className="mt-1 text-2xs font-medium text-warning">Max {src.returnable} returnable. Set to {src.returnable}.</p> : null}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Select aria-label={`Return reason for ${src.sku}`} value={v.reasonId} disabled={!v.selected} invalid={Boolean(rErr)} clearable options={reasons} onChange={(id) => setLine(i, { reasonId: id })} placeholder={reasonsLoading ? "Loading reasons…" : reasons.length ? "Choose a reason" : "No reasons set up"} />
                    {rErr ? <p className="mt-1 text-2xs text-danger">{rErr}</p> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {allError ? <p role="alert" className="text-xs text-danger">{allError}</p> : null}
      <p className="text-xs text-secondary">{selectedUnits({ lines })} unit{selectedUnits({ lines }) === 1 ? "" : "s"} selected. Quantities are capped at shipped minus what is already on other returns.</p>
    </div>
  );
}

function ShippingStep({ form, order }: { readonly form: UseFormReturn<RmaFormValues>; readonly order: ShippableOrder | null }) {
  const values = form.watch();
  const labelErrors: LabelErrors = {
    carrierKey: err(form, "label.carrierKey"), carrierServiceId: err(form, "label.carrierServiceId"), weightLb: err(form, "label.weightLb"),
    length: err(form, "label.length"), width: err(form, "label.width"), height: err(form, "label.height"),
  };
  const dateErr = err(form, "expectedReturnDate");
  const today = React.useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  // Enter in a field of this step (date, cost, tracking) never submits the wizard: Create RMA is an explicit click.
  const noImplicitSubmit = (e: React.KeyboardEvent<HTMLDivElement>) => { if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.preventDefault(); };
  return (
    <div className="space-y-5" onKeyDown={noImplicitSubmit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="rma-expected" className="text-xs font-medium text-body">Expected return date</label>
          {/* Date-only: read and written as a LOCAL calendar date, so 2026/11/20 stays the 20th in every timezone. */}
          <DatePicker id="rma-expected" value={localDateFromIso(values.expectedReturnDate)} minDate={today} invalid={Boolean(dateErr)} clearable
            onChange={(d) => form.setValue("expectedReturnDate", isoFromLocalDate(d), { shouldDirty: true })} />
          {dateErr ? <p className="text-2xs text-danger">{dateErr}</p> : <p className="text-2xs text-secondary">Optional. Shown on the return order and used for overdue follow-up.</p>}
        </div>
        {order ? <ReturnAddressField options={order.returnAddresses ?? []} value={values.returnAddressId ?? null} onChange={(id) => form.setValue("returnAddressId", id, { shouldDirty: true })} /> : null}
      </div>
      <Card className="space-y-3 p-4">
        <Switch checked={values.createLabel} onCheckedChange={(c) => form.setValue("createLabel", c, { shouldDirty: true })}
          label="Create return label" description="Buys a prepaid label now so the customer can ship the items back." />
        {values.createLabel && order ? (
          <ReturnLabelFields warehouseId={order.warehouseId} clientId={order.clientId} value={values.label} errors={labelErrors}
            onChange={(v) => form.setValue("label", v, { shouldDirty: true, shouldValidate: form.formState.submitCount > 0 })} />
        ) : order ? (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs text-secondary">No label is bought. Record the return shipping the customer or marketplace provides (all optional).</p>
            <ManualReturnInfoFields warehouseId={order.warehouseId} clientId={order.clientId} value={values.returnInfo ?? EMPTY_RETURN_INFO}
              errors={{ shippingCost: err(form, "returnInfo.shippingCost"), trackingNumbers: err(form, "returnInfo.trackingNumbers") }}
              onChange={(v) => form.setValue("returnInfo", v, { shouldDirty: true })} />
          </div>
        ) : null}
      </Card>
      <div className="flex flex-col gap-1">
        <label htmlFor="rma-note" className="text-xs font-medium text-body">Note</label>
        <Textarea id="rma-note" rows={3} maxLength={1000} value={values.note} onChange={(e) => form.setValue("note", e.target.value, { shouldDirty: true })} placeholder="Anything the return station should know" />
      </div>
    </div>
  );
}

/**
 * Renders the summary rail from inside the current step (so it sees live form values) into
 * the page's own rail slot, and records which step was reached for the progress ring.
 */
function SummaryPortal({ target, form, stepIndex, onVisit, children }: { readonly target: HTMLElement | null; readonly form: UseFormReturn<RmaFormValues>; readonly stepIndex: number; readonly onVisit: (i: number) => void; readonly children: (v: RmaFormValues) => React.ReactNode }) {
  const values = useWatch({ control: form.control }) as RmaFormValues;
  React.useEffect(() => { onVisit(stepIndex); }, [stepIndex, onVisit]);
  return target ? createPortal(children(values), target) : null;
}

export function RmaCreatePage() {
  const router = useRouter();
  const params = useSearchParams();
  const invalidate = useInvalidateReturns();
  const fmt = useFormat();
  const presetIds = React.useMemo(() => (params.get("orderIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean), [params]);
  const [orderId, setOrderId] = React.useState(presetIds[0] ?? "");
  const [picking, setPicking] = React.useState(false);
  const [created, setCreated] = React.useState<CreatedRma | null>(null);
  /** Bumped by "Create another" / "Next selected order" so the wizard remounts on step 1 with fresh values. */
  const [run, setRun] = React.useState(0);
  const formRef = React.useRef<UseFormReturn<RmaFormValues> | null>(null);
  const { q, order, missing } = useShippable(orderId);
  const reasonState = useLookupState("return_reason", order?.clientId);
  const reasons = reasonState.options;
  const reasonsLoading = reasonState.loading;
  const [railEl, setRailEl] = React.useState<HTMLElement | null>(null);
  /** Furthest step reached (the ring moves forward with the steps and never shows 100% early). */
  const [reached, setReached] = React.useState(0);
  const onVisit = React.useCallback((i: number) => setReached((r) => Math.max(r, i)), []);

  // Reset line values whenever a different order loads.
  const loadedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    const form = formRef.current;
    if (!form || !order || loadedFor.current === order.id) return;
    loadedFor.current = order.id;
    form.setValue("orderId", order.id, { shouldDirty: true });
    form.setValue("lines", initialLines(order), { shouldDirty: true });
    form.setValue("returnAddressId", order.defaultReturnAddressId ?? null, { shouldDirty: false });
    form.clearErrors();
  });

  const rail = (form: UseFormReturn<RmaFormValues>, stepIndex: number) => (
    <SummaryPortal target={railEl} form={form} stepIndex={stepIndex} onVisit={onVisit}>
      {(v) => {
        const orderState = q.isFetching && !order ? "loading" : q.error && !order ? "error" : missing ? "missing" : order && !order.eligible ? "ineligible" : null;
        const p = rmaProgress(v, { orderEligible: Boolean(order?.eligible), reachedStep: reached, orderState });
        return (
          <WizardRail title="Return summary" percent={p.percent} statusLabel={p.label}>
            <RailRow label="Order">{order?.code ?? (q.isFetching && v.orderId ? "Loading…" : "—")}</RailRow>
            <RailRow label="Customer">{order?.customerName ?? "—"}</RailRow>
            <RailRow label="Lines">{(v.lines ?? []).filter((l) => l.selected).length}</RailRow>
            <RailRow label="Units">{selectedUnits({ lines: v.lines ?? [] })}</RailRow>
            <RailRow label="Expected">{v.expectedReturnDate ? fmt.date(localDateFromIso(v.expectedReturnDate)) : "—"}</RailRow>
            <RailRow label="Return address">{order?.returnAddresses?.find((a) => a.id === v.returnAddressId)?.label ?? "Warehouse"}</RailRow>
            <RailRow label="Return label">{v.createLabel ? "Create now" : v.returnInfo?.trackingNumbers?.length ? `Customer label · ${v.returnInfo.trackingNumbers.length} tracking` : "No label"}</RailRow>
          </WizardRail>
        );
      }}
    </SummaryPortal>
  );

  const steps = React.useMemo((): readonly WizardStep<RmaFormValues>[] => [
    {
      key: "order", label: "Order", icon: ClipboardList, description: "Choose the shipped order being returned",
      schema: orderStepSchema(order),
      canProceed: () => (!orderId ? "Choose a shipped order" : !order && q.isFetching ? "Loading the order…" : !order ? "The order could not be loaded" : order.eligible ? true : order.reason ?? "This order can't be returned"),
      render: ({ form }) => { formRef.current = form; return <><OrderStep form={form} order={order} loading={q.isFetching && !order} missing={missing} onPick={() => setPicking(true)} loadError={q.error ? errorText(q.error) : null} onRetry={() => void q.refetch()} />{rail(form, 0)}</>; },
    },
    {
      key: "items", label: "Items", icon: Box, description: "Pick the lines, quantities and reasons",
      // A customer reason is required per returned line whenever the client has reasons set up (Logiwa captures it per line).
      schema: linesStepSchema(order, reasons.length > 0),
      canProceed: () => (reasonsLoading ? "Loading return reasons…" : true),
      render: ({ form }) => <><ItemsStep form={form} order={order} reasons={reasons} reasonsLoading={reasonsLoading} />{rail(form, 1)}</>,
    },
    {
      key: "shipping", label: "Return shipping", icon: Truck, description: "Expected date and return label",
      schema: shippingStepSchema,
      render: ({ form }) => <><ShippingStep form={form} order={order} />{rail(form, 2)}</>,
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rail() reads railEl / reached / order, all listed
  ], [order, orderId, q, missing, reasons, reasonsLoading, railEl, reached]);

  const complete = async (values: RmaFormValues) => {
    const { data } = await apiRequest<CreatedRma>("/api/returns", { method: "POST", body: buildCreatePayload(values) });
    setCreated(data);
    await invalidate();
    if (data.labelError) toast.warning("RMA created without a label", data.labelError);
    else toast.success("RMA created", `${data.rmaCode} is Pending${data.trackingNumber ? ` · tracking ${data.trackingNumber}` : ""}.`);
    if (data.labelFileId) openFileId(data.labelFileId);
  };

  const presetIndex = presetIds.indexOf(orderId);
  const nextPreset = presetIndex >= 0 ? presetIds[presetIndex + 1] : undefined;
  const restart = (id: string) => { setCreated(null); setReached(0); loadedFor.current = null; formRef.current = null; setOrderId(id); setRun((n) => n + 1); };

  return (
    <div className="pb-8">
      <PageHeader title="Create RMA" breadcrumbs={[{ label: "Fulfillment" }, { label: "Outbound" }, { label: "Return Orders", href: "/orders/returns" }, { label: "Create RMA" }]} helper="Create a return merchandise authorization for a shipped order, with an optional prepaid return label." />
      <div className={created ? "px-6 pt-3" : "grid items-start gap-5 px-6 pt-3 lg:grid-cols-[minmax(0,1fr)_300px]"}>
        <div className={created ? undefined : "min-w-0 rounded-lg border border-border bg-surface p-5 shadow-xs"}>
        <Wizard<RmaFormValues>
          key={`${presetIds.join(",")}:${run}`}
          steps={steps}
          defaultValues={{ orderId, lines: [], expectedReturnDate: null, note: "", createLabel: false, label: EMPTY_LABEL, returnAddressId: null, returnInfo: EMPTY_RETURN_INFO }}
          onComplete={async (values) => {
            try {
              await complete(values);
            } catch (e) {
              toast.error("RMA not created", errorText(e));
              throw e;
            }
          }}
          onCancel={() => router.push("/orders/returns")}
          submitLabel="Create RMA"
          draftScope={false}
          success={created ? (
            <WizardSuccess
              entity={`Return Order ${created.rmaCode}`}
              description={created.labelError ? `The return label failed: ${created.labelError} You can create it from the RMA.` : created.trackingNumber ? `Return label tracking ${created.trackingNumber}. Status: Pending.` : "Status: Pending. No return label was created."}
              options={[
                { title: "View RMA", description: "Lines, label and timeline", icon: FileText, href: `/orders/returns/${created.id}` },
                ...(created.labelFileId ? [{ title: "Print return label", description: "Opens the label PDF", icon: Printer, onClick: () => openFileId(created.labelFileId) }] : []),
                ...(nextPreset ? [{ title: "Next selected order", description: `Create the RMA for order ${presetIndex + 2} of ${presetIds.length}`, icon: Plus, onClick: () => restart(nextPreset) }] : [{ title: "Create another RMA", icon: Plus, onClick: () => restart("") }]),
                { title: "Open return station", description: "Receive returned items", icon: ScanLine, href: "/return-station" },
              ]}
            />
          ) : undefined}
        />
        </div>
        {/* The rail lives outside the shared wizard so its footer keeps the primary "Create RMA" on the last step. */}
        {created ? null : <div ref={setRailEl} className="min-w-0 lg:sticky lg:top-4" />}
      </div>
      <ShippedOrderPicker open={picking} onOpenChange={setPicking}
        onPick={(id) => { loadedFor.current = null; setOrderId(id); setPicking(false); formRef.current?.setValue("orderId", id, { shouldDirty: true }); formRef.current?.clearErrors(); }} />
    </div>
  );
}
