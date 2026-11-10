"use client";

/**
 * Shipment Plan detail (`/shipment-plans/[id]`, KitStaks addition): header with the status
 * popover and every plan action, lifecycle stepper + loading progress, the plan facts, the
 * orders with live statuses (add / remove in place), the plan's LPs and the timeline.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Edit3, FileText, History, ListPlus, PackagePlus, Trash2, Truck, X } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ShipmentPlanStatus } from "@/lib/enums";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { ActivityTimeline, ChangeLogDrawer, DetailHeader, KvList } from "@/components/shared";
import { PlanOrderPicker } from "./plan-order-picker";
import { errorMessage } from "@/components/shipping/shipping-client";
import { PlanDrawer } from "./plan-drawer";
import { usePlanActions } from "./plan-actions";
import { PlanStatusPopover } from "./plan-status-popover";
import { planDetailKey, useInvalidatePlans, type PlanDetail, type PlanOrderRow } from "./plans-client";

const LIFECYCLE: readonly ShipmentPlanStatus[] = ["Open", "In Progress", "Loading Started", "Loading Completed", "Shipped"];
const dt = (v: unknown) => (typeof v === "string" && v ? formatDateTime(v) : null);

function Lifecycle({ status }: { readonly status: ShipmentPlanStatus }) {
  if (status === "Cancelled") {
    return <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] font-medium text-danger"><X className="h-4 w-4" aria-hidden />This plan was cancelled. Its orders were released.</div>;
  }
  const at = LIFECYCLE.indexOf(status);
  return (
    <ol className="flex items-center gap-1" aria-label="Plan lifecycle">
      {LIFECYCLE.map((s, i) => (
        <li key={s} className="flex min-w-0 flex-1 items-center gap-1" aria-current={i === at ? "step" : undefined}>
          <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold", i < at || status === "Shipped" ? "border-success bg-success text-white" : i === at ? "border-primary bg-primary-soft text-primary" : "border-border text-faint")}>
            {i < at || status === "Shipped" ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
          </span>
          <span className={cn("truncate text-[12px]", i === at ? "font-semibold text-foreground" : "text-secondary")}>{s}</span>
          {i < LIFECYCLE.length - 1 ? <span className={cn("mx-1 h-px flex-1", i < at ? "bg-success" : "bg-border")} aria-hidden /> : null}
        </li>
      ))}
    </ol>
  );
}

function OrdersSection({ plan, onChanged }: { readonly plan: PlanDetail; readonly onChanged: () => void }) {
  const [picking, setPicking] = React.useState(false);
  const [removing, setRemoving] = React.useState<PlanOrderRow | null>(null);
  const editReason = plan.editBlockedReason;
  const call = async (method: "POST" | "DELETE", orderIds: readonly string[], verb: string) => {
    try {
      const row = await apiFetch<{ orderCount: number }>(`/api/shipment-plans/${encodeURIComponent(plan.id)}/orders`, { method, body: { orderIds } });
      toast.success("Success", `${orderIds.length} ${orderIds.length === 1 ? "order" : "orders"} ${verb}. The plan now has ${row.orderCount}.`);
      onChanged();
    } catch (error) {
      toast.error(method === "POST" ? "Couldn't add the orders" : "Couldn't remove the order", errorMessage(error));
    }
  };
  return (
    <section className="rounded-lg border border-border bg-surface shadow-xs">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-[14px] font-semibold">Orders <span className="ml-1 text-secondary">{plan.orders.length}</span></h2>
        <DisabledReason reason={editReason}>
          <Button size="sm" variant="secondary" disabled={Boolean(editReason)} onClick={() => setPicking(true)}><PackagePlus className="h-3.5 w-3.5" aria-hidden />Add order(s)</Button>
        </DisabledReason>
      </header>
      {plan.orders.length === 0 ? (
        <p className="px-4 py-8 text-center text-[12px] text-secondary">No order added yet. Add orders to start loading this truck.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
              <tr><th className="px-4 py-2">Order</th><th className="px-2">Order status</th><th className="px-2">Plan status</th><th className="px-2">Customer</th><th className="px-2">Carrier / service</th><th className="px-2 text-right">Qty</th><th className="w-10" /></tr>
            </thead>
            <tbody>
              {plan.orders.map((o) => (
                <tr key={String(o.id)} className="border-t border-border">
                  <td className="px-4 py-2"><Link className="font-semibold text-primary hover:underline" href={`/orders/${encodeURIComponent(String(o.orderCode))}`}>{String(o.orderCode)}</Link></td>
                  <td className="px-2"><StatusPill status={String(o.orderStatus)} domain="shipmentOrder" /></td>
                  <td className="px-2"><StatusPill status={String(o.planStatus)} domain="shipmentPlan" size="sm" /></td>
                  <td className="truncate px-2">{String(o.customerName ?? "—")}</td>
                  <td className="truncate px-2">{[o.orderCarrier, o.shippingService].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-2 text-right tabular-nums">{String(o.totalQuantity ?? 0)}</td>
                  <td className="px-2">
                    <DisabledReason reason={editReason ?? (o.planStatus === "Shipped" ? "Shipped orders stay on the plan" : null)}>
                      <Button size="icon" variant="ghost" aria-label={`Remove ${String(o.orderCode)}`} disabled={Boolean(editReason) || o.planStatus === "Shipped"} onClick={() => setRemoving(o)}><Trash2 className="h-3.5 w-3.5" aria-hidden /></Button>
                    </DisabledReason>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {picking ? (
        <PlanOrderPicker open onOpenChange={(o) => (o ? undefined : setPicking(false))} title={`Add order(s) to ${plan.code}`} warehouseId={plan.warehouseId} clientId={plan.clientId} planId={plan.id}
          excludeIds={plan.orders.map((o) => o.orderId)} onConfirm={async (ids) => { await call("POST", ids, "added"); setPicking(false); }} />
      ) : null}
      <ConfirmDialog open={removing !== null} onOpenChange={(o) => (o ? undefined : setRemoving(null))} variant="danger" title={`Remove ${String(removing?.orderCode ?? "")} from ${plan.code}?`}
        description="The order leaves this plan and can join another one. The order itself is not changed." cancelLabel="No" confirmLabel="Yes, remove"
        onConfirm={() => (removing ? call("DELETE", [removing.orderId], "removed") : undefined)} />
    </section>
  );
}

function LpsSection({ plan }: { readonly plan: PlanDetail }) {
  return (
    <section className="rounded-lg border border-border bg-surface shadow-xs">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-[14px] font-semibold">License plates <span className="ml-1 text-secondary">{plan.lps.length}</span></h2>
        <Link href={`/shipment-plans/lps?f.planCode=eq:${encodeURIComponent(plan.code)}`} className="text-[12px] text-primary hover:underline">Open in Plan LPs</Link>
      </header>
      {plan.lps.length === 0 ? <p className="px-4 py-6 text-center text-[12px] text-secondary">No license plates are allocated to these orders yet.</p> : (
        <ul className="divide-y divide-border text-[12px]">
          {plan.lps.map((l) => (
            <li key={String(l.id)} className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="font-semibold">{String(l.lpNumber)}{l.parentLpNumber ? <span className="ml-2 font-normal text-secondary">in {String(l.parentLpNumber)}</span> : null}</span>
              <span className="text-secondary">{String(l.orderCode)}</span>
              <span className="tabular-nums text-secondary">{typeof l.weight === "number" ? `${l.weight} lb` : "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PlanDetailPage({ id }: { readonly id: string }) {
  const router = useRouter();
  const invalidate = useInvalidatePlans();
  const q = useApiQuery<PlanDetail>(planDetailKey(id), `/api/shipment-plans/${encodeURIComponent(id)}`, { staleTime: 0 });
  const [editing, setEditing] = React.useState(false);
  const [log, setLog] = React.useState(false);
  const refetch = () => { invalidate(); void q.refetch(); };
  const a = usePlanActions({ onChanged: refetch, onDeleted: () => router.push("/shipment-plans") });

  if (q.isError) {
    const missing = q.error.status === 404;
    return (
      <div className="px-6 py-10">
        <EmptyState title={missing ? "Shipment plan not found" : "Couldn't load this shipment plan"} description={missing ? "It may have been deleted, or it belongs to a warehouse you can't access." : q.error.message}
          action={missing ? <Link href="/shipment-plans" className="text-primary hover:underline">Back to shipment plans</Link> : <Button onClick={() => void q.refetch()}>Retry</Button>} />
      </div>
    );
  }
  const p = q.data?.data;
  if (!p) return <div className="flex flex-col gap-4 px-6 py-6"><Skeleton className="h-10 w-1/3" /><Skeleton className="h-20 w-full" /><Skeleton className="h-64 w-full" /></div>;

  const units = p.orders.reduce((s, o) => s + Number(o.totalQuantity ?? 0), 0);
  return (
    <div className="flex flex-col gap-5 px-6 pb-10 pt-4">
      <DetailHeader
        title={p.code}
        backHref="/shipment-plans"
        backLabel="Shipment plans"
        badges={<PlanStatusPopover status={p.status} nextStatuses={p.nextStatuses} disabledReason={a.statusReason(p)} onPick={(s) => a.requestStatus(p, s)} />}
        meta={<span>{p.warehouseCode as string}{p.clientName ? ` · ${String(p.clientName)}` : ""} · created {dt(p.createdAt)}</span>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => setLog(true)}><History className="h-3.5 w-3.5" aria-hidden />Change log</Button>
            <DisabledReason reason={a.printReason([p])}><Button variant="secondary" disabled={Boolean(a.printReason([p]))} onClick={() => a.print([p])}><FileText className="h-3.5 w-3.5" aria-hidden />Manifest / BOL</Button></DisabledReason>
            <DisabledReason reason={a.jobsReason([p])}><Button variant="secondary" disabled={Boolean(a.jobsReason([p]))} onClick={() => a.openJobs([p])}><ListPlus className="h-3.5 w-3.5" aria-hidden />Picking/job operations</Button></DisabledReason>
            <DisabledReason reason={!a.can.edit ? "You don't have permission to edit shipment plans" : p.editBlockedReason}><Button variant="secondary" disabled={!a.can.edit || Boolean(p.editBlockedReason)} onClick={() => setEditing(true)}><Edit3 className="h-3.5 w-3.5" aria-hidden />Edit</Button></DisabledReason>
            <DisabledReason reason={a.deleteReason([p])}><Button variant="ghost" disabled={Boolean(a.deleteReason([p]))} onClick={() => a.requestDelete([p])} aria-label="Delete plan"><Trash2 className="h-3.5 w-3.5" aria-hidden /></Button></DisabledReason>
            <DisabledReason reason={a.shipReason([p])}><Button disabled={Boolean(a.shipReason([p]))} onClick={() => a.requestShip([p])}><Truck className="h-3.5 w-3.5" aria-hidden />Ship</Button></DisabledReason>
          </div>
        }
      />
      <div className="rounded-lg border border-border bg-surface p-4 shadow-xs"><Lifecycle status={p.status} /></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Orders" value={p.orderCount} sublabel={`${units} units`} />
        <StatTile label="Loaded" value={`${p.loadedPercent}%`} sublabel={<ProgressBar value={p.loadedPercent} size="sm" tone={p.loadedPercent === 100 ? "success" : "primary"} label="Loading progress" />} tone={p.loadedPercent === 100 ? "success" : "default"} />
        <StatTile label="Shipped" value={`${p.shippedCount} of ${p.orderCount}`} sublabel={p.actualShipmentAt ? `on ${dt(p.actualShipmentAt)}` : "Not shipped yet"} />
        <StatTile label="Expected load" value={`${Number(p.expectedTotalWeight ?? 0).toFixed(2)} lb`} sublabel={`${Number(p.expectedTotalVolume ?? 0).toFixed(2)} ft³`} />
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-5">
          <OrdersSection plan={p} onChanged={refetch} />
          <LpsSection plan={p} />
        </div>
        <div className="flex flex-col gap-5">
          <section className="rounded-lg border border-border bg-surface p-4 shadow-xs">
            <h2 className="mb-3 text-[14px] font-semibold">Plan details</h2>
            <KvList columns={1} layout="inline" items={[
              { key: "carrier", label: "Carrier", value: p.carrierName },
              { key: "truck", label: "Truck plate", value: p.truckPlateNumber },
              { key: "gate", label: "Loading gate", value: p.loadingGate as string | null },
              { key: "planned", label: "Planned shipment", value: dt(p.plannedShipmentAt) },
              { key: "ls", label: "Loading started", value: dt(p.loadingStartedAt) },
              { key: "lc", label: "Loading completed", value: dt(p.loadingCompletedAt) },
              { key: "td", label: "Truck departed", value: dt(p.truckDepartedAt) },
              { key: "actual", label: "Actual shipment", value: dt(p.actualShipmentAt) },
              { key: "customer", label: "Customer", value: p.customerName as string | null },
              { key: "address", label: "Customer address", value: p.customerAddress },
              { key: "retailer", label: "Retailer", value: p.retailerName as string | null },
              { key: "lpn", label: "Prevent LPN edit", value: p.preventLpnEditDuringLoading ? "Yes" : "No" },
              { key: "note", label: "Note", value: p.note },
            ]} />
          </section>
          <section className="rounded-lg border border-border bg-surface p-4 shadow-xs">
            <h2 className="mb-3 text-[14px] font-semibold">Timeline</h2>
            <ActivityTimeline entityType="shipment_plan" entityId={p.id} limit={20} />
          </section>
        </div>
      </div>
      {editing ? <PlanDrawer open onOpenChange={(o) => (o ? undefined : setEditing(false))} editId={p.id} onSaved={refetch} /> : null}
      {log ? <ChangeLogDrawer open onOpenChange={(o) => (o ? undefined : setLog(false))} entityType="shipment_plan" entityId={p.id} entityCode={p.code} /> : null}
      {a.dialogs}
    </div>
  );
}
