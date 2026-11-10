"use client";

/** Client contracts for the Shipment Plan screens (type-only server imports + calls). */
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { ShipmentPlanStatus } from "@/lib/enums";
import type { PlanDetail, PlanOrderRow, PlanRow } from "@/server/repositories/shipment-plans-lists";
import type { PlanFormOptions, PlanShipOutcome, ShipPlansResult } from "@/server/repositories/shipment-plans";
import { toast } from "@/components/ui/toast";

export type { PlanDetail, PlanOrderRow, PlanRow, PlanFormOptions, PlanShipOutcome, ShipPlansResult };

export const PLAN_PERMS = {
  view: "fulfillment.shipment_plan.view",
  create: "fulfillment.shipment_plan.create",
  edit: "fulfillment.shipment_plan.edit",
  delete: "fulfillment.shipment_plan.delete",
  ship: "fulfillment.shipment_plan.ship_order",
  jobs: "fulfillment.shipment_plan.picking_operations",
  status: "fulfillment.shipment_plan.change_status",
  print: "fulfillment.shipment_plan.print_manifest_bol",
  customFields: "fulfillment.shipment_plan.custom_field_management",
} as const;

export const PLAN_INVALIDATE: readonly (readonly unknown[])[] = [["grid"], ["shipment-plan"]];

export function useInvalidatePlans(): () => void {
  const qc = useQueryClient();
  return React.useCallback(() => {
    for (const queryKey of PLAN_INVALIDATE) void qc.invalidateQueries({ queryKey });
  }, [qc]);
}

export const planDetailKey = (id: string) => ["shipment-plan", id] as const;

export function changeStatus(id: string, status: ShipmentPlanStatus, version: number): Promise<PlanRow> {
  return apiFetch<PlanRow>(`/api/shipment-plans/${encodeURIComponent(id)}/status`, { method: "POST", body: { status, version } });
}

export function shipPlans(ids: readonly string[]): Promise<ShipPlansResult> {
  return apiFetch<ShipPlansResult>("/api/shipment-plans/ship", { method: "POST", body: { ids } });
}

/** "SP000041: 2 shipped" / partial results with the first reasons. */
export function shipToast(result: ShipPlansResult): void {
  const shipped = result.outcomes.reduce((s, o) => s + o.shipped.length, 0);
  const failedOrders = result.outcomes.flatMap((o) => o.failed);
  const planFailures = result.failed.filter((f) => f.code !== "PARTIAL");
  const plans = result.succeeded.length + result.failed.length;
  const head = `${result.succeeded.length} of ${plans} ${plans === 1 ? "plan" : "plans"} shipped · ${shipped} ${shipped === 1 ? "order" : "orders"} shipped`;
  if (failedOrders.length === 0 && planFailures.length === 0) {
    toast.success("Success", head);
    return;
  }
  const reasons = [...planFailures.map((f) => f.message), ...failedOrders.map((f) => f.message)].slice(0, 3).join(" · ");
  (shipped > 0 ? toast.warning : toast.error)(shipped > 0 ? `${head} · ${failedOrders.length + planFailures.length} not shipped` : "Nothing shipped", reasons);
}

/** Next-status hint shown in the status popover. */
export const STATUS_HINT: Readonly<Record<ShipmentPlanStatus, string>> = {
  Open: "Planned, nothing started yet",
  "In Progress": "Orders are being picked and packed",
  "Loading Started": "Packages are going onto the truck",
  "Loading Completed": "The truck is fully loaded",
  Shipped: "Ship every Ready to Ship order in the plan",
  Cancelled: "Stop this plan; its orders are released",
};
