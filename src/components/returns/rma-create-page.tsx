"use client";

/**
 * Create RMA (`/orders/returns/new?orderIds=`, M04 §7, KitStaks-designed). Linear wizard:
 * 1 Order (shipped orders only) → 2 Items (qty capped at shipped − already returned,
 * customer reason) → 3 Return shipping (expected date, optional return label through
 * shipping ops `return-label`, note) → success screen with the label.
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Box, ClipboardList, FileText, PackageSearch, Plus, Printer, ScanLine, Truck } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { RailRow, Wizard, WizardSuccess, type WizardStep } from "@/components/ui/wizard";
import { apiRequest } from "@/lib/api-client";
import { useFormat } from "@/lib/format";
import { useApiQuery } from "@/lib/query-client";
import { EMPTY_LABEL, ReturnLabelFields, type LabelErrors } from "./return-label-fields";
import type { ShippableOrder } from "./return-types";
import { ShippedOrderPicker } from "./shipped-order-picker";
import { errorText, openFileId, useInvalidateReturns, useLookupOptions } from "./returns-client";
import { buildCreatePayload, initialLines, linesStepSchema, orderStepSchema, selectedUnits, shippingStepSchema, type RmaFormValues } from "./rma-form";

interface CreatedRma {
  readonly id: string;
  readonly rmaCode: string;
  readonly status: string;
  readonly trackingNumber: string | null;
  readonly labelFileId: string | null;
  readonly labelError: string | null;
}

type ShippableResponse = readonly (ShippableOrder | { readonly id: string; readonly missing: true })[];

function useShippable(orderId: string) {
  const q = useApiQuery<ShippableResponse>(["returns", "shippable", orderId], orderId ? "/api/returns/shippable" : null, { query: { orderIds: orderId }, staleTime: 0 });
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
      <div><p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-secondary">Order</p><p className="mt-0.5 flex items-center gap-2 font-semibold">{order.code}<StatusPill status={order.status} domain="shipmentOrder" size="sm" /></p></div>
      <div><p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-secondary">Customer</p><p className="mt-0.5">{order.customerName}</p><p className="text-[11px] text-secondary">{order.shipTo}</p></div>
      <div><p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-secondary">Client</p><p className="mt-0.5">{order.clientName}</p><p className="text-[11px] text-secondary">{order.storeOrderNumber ? `Store order ${order.storeOrderNumber}` : "No store order #"}</p></div>
      <div><p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-secondary">Shipped</p><p className="mt-0.5">{order.shippedAt ? fmt.dateTime(order.shippedAt) : "—"}</p><p className="text-[11px] text-secondary">{order.deliveredAt ? `Delivered ${fmt.date(order.deliveredAt)}` : "Not delivered yet"}</p></div>
    </div>
  );
}

function OrderStep({ form, order, loading, missing, onPick }: { readonly form: UseFormReturn<RmaFormValues>; readonly order: ShippableOrder | null; readonly loading: boolean; readonly missing: boolean; readonly onPick: () => void }) {
  const error = err(form, "orderId");
  return (
    <div className="space-y-4" data-invalid={error ? "true" : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-secondary">Returns start from a shipped or delivered order. Each RMA covers one order.</p>
        <Button variant={order ? "secondary" : "primary"} onClick={onPick} aria-invalid={error ? true : undefined}><PackageSearch className="h-3.5 w-3.5" aria-hidden />{order ? "Choose another order" : "Choose a shipped order"}</Button>
      </div>
      {loading ? <Skeleton className="h-24" /> : order ? <OrderCard order={order} /> : missing ? <Callout variant="error" title="Order not found">The order doesn&apos;t exist or is outside your warehouses and clients.</Callout> : (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-[13px] text-secondary">No order chosen yet.</div>
      )}
      {order && !order.eligible ? <Callout variant="attention" title="This order can't be returned">{order.reason}</Callout> : null}
      {error && !(order && !order.eligible) ? <p role="alert" className="text-[12px] text-danger">{error}</p> : null}
    </div>
  );
}

function ItemsStep({ form, order, reasons }: { readonly form: UseFormReturn<RmaFormValues>; readonly order: ShippableOrder | null; readonly reasons: readonly { value: string; label: string }[] }) {
  const lines = form.watch("lines");
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
        <table className="w-full min-w-[760px] text-[13px]">
          <thead className="border-b border-border bg-surface-sunken/60 text-[11px] font-semibold uppercase tracking-[0.04em] text-secondary">
            <tr>
              <th className="w-10 px-3 py-2"><Checkbox aria-label="Select all returnable items" checked={allOn} onCheckedChange={(c) => form.setValue("lines", lines.map((l) => {
                const src = order.lines.find((x) => x.orderLineId === l.orderLineId);
                const ok = Boolean(src && src.returnable > 0 && !src.isNonReturnable);
                return { ...l, selected: ok && c === true, quantity: ok && c === true ? (l.quantity ?? src?.returnable ?? 1) : l.quantity };
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
                  <td className="px-3 py-2 align-top"><Checkbox aria-label={`Return ${src.sku}`} disabled={Boolean(blocked)} checked={v.selected} onCheckedChange={(c) => setLine(i, { selected: c === true, quantity: v.quantity ?? 1 })} /></td>
                  <td className="px-3 py-2 align-top"><p className="font-medium text-foreground">{src.sku}</p><p className="max-w-[260px] truncate text-[11px] text-secondary">{src.name} · {src.packType}</p>{blocked ? <p className="text-[11px] text-warning">{blocked}</p> : null}</td>
                  <td className="px-3 py-2 text-right align-top tabular-nums">{src.shippedQty}</td>
                  <td className="px-3 py-2 text-right align-top tabular-nums">{src.alreadyReturned}</td>
                  <td className="px-3 py-2 align-top">
                    <NumberInput aria-label={`Return quantity for ${src.sku}`} value={v.quantity} min={1} max={src.returnable} disabled={!v.selected || Boolean(blocked)} invalid={Boolean(qErr)}
                      onChange={(n) => setLine(i, { quantity: n })} suffix={<span className="text-[11px] text-secondary">/ {src.returnable}</span>} />
                    {qErr ? <p className="mt-1 text-[11px] text-danger">{qErr}</p> : null}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Select aria-label={`Return reason for ${src.sku}`} value={v.reasonId} disabled={!v.selected} invalid={Boolean(rErr)} clearable options={reasons} onChange={(id) => setLine(i, { reasonId: id })} placeholder={reasons.length ? "Choose a reason" : "No reasons set up"} />
                    {rErr ? <p className="mt-1 text-[11px] text-danger">{rErr}</p> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {allError ? <p role="alert" className="text-[12px] text-danger">{allError}</p> : null}
      <p className="text-[12px] text-secondary">{selectedUnits({ lines })} unit{selectedUnits({ lines }) === 1 ? "" : "s"} selected. Quantities are capped at shipped minus what is already on other returns.</p>
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
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="rma-expected" className="text-[12px] font-medium text-body">Expected return date</label>
          <DatePicker id="rma-expected" value={values.expectedReturnDate ? new Date(values.expectedReturnDate) : null} minDate={new Date()} invalid={Boolean(dateErr)} clearable
            onChange={(d) => form.setValue("expectedReturnDate", d ? d.toISOString().slice(0, 10) : null, { shouldDirty: true })} />
          {dateErr ? <p className="text-[11px] text-danger">{dateErr}</p> : <p className="text-[11px] text-secondary">Optional. Shown on the return order and used for overdue follow-up.</p>}
        </div>
      </div>
      <Card className="space-y-3 p-4">
        <Switch checked={values.createLabel} onCheckedChange={(c) => form.setValue("createLabel", c, { shouldDirty: true })}
          label="Create return label" description="Buys a prepaid label now so the customer can ship the items back." />
        {values.createLabel && order ? (
          <ReturnLabelFields warehouseId={order.warehouseId} clientId={order.clientId} value={values.label} errors={labelErrors}
            onChange={(v) => form.setValue("label", v, { shouldDirty: true, shouldValidate: form.formState.submitCount > 0 })} />
        ) : null}
      </Card>
      <div className="flex flex-col gap-1">
        <label htmlFor="rma-note" className="text-[12px] font-medium text-body">Note</label>
        <Textarea id="rma-note" rows={3} maxLength={1000} value={values.note} onChange={(e) => form.setValue("note", e.target.value, { shouldDirty: true })} placeholder="Anything the return station should know" />
      </div>
    </div>
  );
}

export function RmaCreatePage() {
  const router = useRouter();
  const params = useSearchParams();
  const invalidate = useInvalidateReturns();
  const presetIds = React.useMemo(() => (params.get("orderIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean), [params]);
  const [orderId, setOrderId] = React.useState(presetIds[0] ?? "");
  const [picking, setPicking] = React.useState(false);
  const [created, setCreated] = React.useState<CreatedRma | null>(null);
  const formRef = React.useRef<UseFormReturn<RmaFormValues> | null>(null);
  const { q, order, missing } = useShippable(orderId);
  const reasons = useLookupOptions("return_reason", order?.clientId);

  // Reset line values whenever a different order loads.
  const loadedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    const form = formRef.current;
    if (!form || !order || loadedFor.current === order.id) return;
    loadedFor.current = order.id;
    form.setValue("orderId", order.id, { shouldDirty: true });
    form.setValue("lines", initialLines(order), { shouldDirty: true });
    form.clearErrors();
  });

  const steps = React.useMemo((): readonly WizardStep<RmaFormValues>[] => [
    {
      key: "order", label: "Order", icon: ClipboardList, description: "Choose the shipped order being returned",
      schema: orderStepSchema(order),
      render: ({ form }) => { formRef.current = form; return <OrderStep form={form} order={order} loading={q.isFetching && !order} missing={missing} onPick={() => setPicking(true)} />; },
    },
    {
      key: "items", label: "Items", icon: Box, description: "Pick the lines, quantities and reasons",
      schema: linesStepSchema(order, false),
      render: ({ form }) => <ItemsStep form={form} order={order} reasons={reasons} />,
    },
    {
      key: "shipping", label: "Return shipping", icon: Truck, description: "Expected date and return label",
      schema: shippingStepSchema,
      render: ({ form }) => <ShippingStep form={form} order={order} />,
    },
  ], [order, q.isFetching, missing, reasons]);

  const complete = async (values: RmaFormValues) => {
    const { data } = await apiRequest<CreatedRma>("/api/returns", { method: "POST", body: buildCreatePayload(values) });
    setCreated(data);
    await invalidate();
    if (data.labelError) toast.warning("RMA created without a label", data.labelError);
    else toast.success("RMA created", `${data.rmaCode} is Pending${data.trackingNumber ? ` · tracking ${data.trackingNumber}` : ""}.`);
    if (data.labelFileId) openFileId(data.labelFileId);
  };

  const nextPreset = presetIds.find((id) => id !== orderId);

  return (
    <div className="pb-8">
      <PageHeader title="Create RMA" crumbLabel="Create RMA" helper="Create a return merchandise authorization for a shipped order, with an optional prepaid return label." />
      <div className="px-6 pt-3">
        <Wizard<RmaFormValues>
          key={presetIds.join(",")}
          steps={steps}
          defaultValues={{ orderId, lines: [], expectedReturnDate: null, note: "", createLabel: false, label: EMPTY_LABEL }}
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
          railTitle="Return summary"
          railSummary={(v) => (
            <div className="space-y-2 text-[12px]">
              <RailRow label="Order">{order?.code ?? "—"}</RailRow>
              <RailRow label="Customer">{order?.customerName ?? "—"}</RailRow>
              <RailRow label="Lines">{v.lines.filter((l) => l.selected).length}</RailRow>
              <RailRow label="Units">{selectedUnits(v)}</RailRow>
              <RailRow label="Expected">{v.expectedReturnDate ?? "—"}</RailRow>
              <RailRow label="Return label">{v.createLabel ? "Create now" : "No label"}</RailRow>
            </div>
          )}
          success={created ? (
            <WizardSuccess
              entity={`RMA ${created.rmaCode}`}
              description={created.labelError ? `The return label failed: ${created.labelError} You can create it from the RMA.` : created.trackingNumber ? `Return label tracking ${created.trackingNumber}. Status: Pending.` : "Status: Pending. No return label was created."}
              options={[
                { title: "View RMA", description: "Lines, label and timeline", icon: FileText, href: `/orders/returns/${created.id}` },
                ...(created.labelFileId ? [{ title: "Print return label", description: "Opens the label PDF", icon: Printer, onClick: () => openFileId(created.labelFileId) }] : []),
                ...(nextPreset ? [{ title: "Next selected order", description: "Create the RMA for the next order", icon: Plus, onClick: () => { setCreated(null); loadedFor.current = null; setOrderId(nextPreset); } }] : [{ title: "Create another RMA", icon: Plus, onClick: () => { setCreated(null); loadedFor.current = null; setOrderId(""); } }]),
                { title: "Open return station", description: "Receive returned items", icon: ScanLine, href: "/return-station" },
              ]}
            />
          ) : undefined}
        />
      </div>
      <ShippedOrderPicker open={picking} onOpenChange={setPicking}
        onPick={(id) => { loadedFor.current = null; setOrderId(id); setPicking(false); }} />
    </div>
  );
}
