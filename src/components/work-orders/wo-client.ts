"use client";

/**
 * Client helpers for the M08 screens: row/detail types (mirrors of the server
 * repositories), filter fields with runtime options, cache invalidation, bulk toasts.
 */
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { FilterFieldDef } from "@/components/grid";
import { customFieldDefSchema, parseList } from "@/components/shared/contracts";
import { toast } from "@/components/ui/toast";
import { apiFetch, isApiError } from "@/lib/api-client";
import { useMe } from "@/lib/permissions-client";
import { useApiQuery } from "@/lib/query-client";
import type { WorkOrderStatus } from "@/lib/enums";
import type { WoGridField } from "@/lib/grid-defs/work-orders/work-orders";
import type { WorkOrderType } from "@/lib/grid-defs/work-orders/work-order-model";

export interface TagChip { readonly id: string; readonly name: string; readonly color: string }

export interface WorkOrderRow {
  readonly id: string;
  readonly code: string;
  readonly version: number;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly status: WorkOrderStatus;
  readonly age: number;
  readonly operationType: string;
  readonly type: WorkOrderType;
  readonly buildFor: "Stock" | "SO";
  readonly shipmentOrderId: string | null;
  readonly shipmentOrderCode: string | null;
  readonly tags: readonly TagChip[];
  readonly tagNames: string;
  readonly jobId: string | null;
  readonly jobCode: string | null;
  readonly kitProductId: string;
  readonly kitSku: string;
  readonly kitName: string;
  readonly requestedQty: number;
  readonly processedQty: number;
  readonly extraNote: string | null;
  readonly kittingInstructions: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly updatedAt: string;
  readonly plannedStartAt: string | null;
  readonly plannedFinishAt: string | null;
  readonly actualStartAt: string | null;
  readonly actualFinishAt: string | null;
  readonly cancelledAt: string | null;
  readonly outputLocationId: string | null;
  readonly outputLot: string | null;
  readonly outputExpiry: string | null;
  readonly customFields: Readonly<Record<string, string | boolean | null>>;
}

export interface ComponentRow {
  readonly id: string;
  readonly componentProductId: string;
  readonly sku: string;
  readonly name: string;
  readonly packType: string;
  readonly componentQty: number;
  readonly totalQty: number;
  readonly allocatedQty: number;
  readonly pickedQty: number;
  readonly consumedQty: number;
  readonly freeQty: number;
  readonly shortQty: number;
  readonly locationId: string | null;
  readonly locationCode: string | null;
  readonly lpId: string | null;
  readonly lpNumber: string | null;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly productionDate: string | null;
  readonly trackLot: boolean;
  readonly trackExpiry: boolean;
  readonly trackProductionDate: boolean;
}

export interface WorkOrderDetail {
  readonly workOrder: WorkOrderRow;
  readonly kit: { readonly id: string; readonly sku: string; readonly name: string; readonly packType: string; readonly kitType: string | null; readonly trackLot: boolean; readonly trackExpiry: boolean; readonly trackProductionDate: boolean };
  readonly outputLocationCode: string | null;
  readonly components: readonly ComponentRow[];
  readonly job: { readonly id: string; readonly code: string; readonly status: string; readonly jobType: string; readonly taskCount: number; readonly completedTaskCount: number; readonly assigneeName: string | null } | null;
  readonly tasks: readonly { readonly id: string; readonly taskNo: number; readonly taskType: string; readonly status: string; readonly sku: string | null; readonly plannedQty: number; readonly actualQty: number; readonly sourceLocationCode: string | null; readonly targetLocationCode: string | null }[];
  readonly receipts: readonly { readonly id: string; readonly masterId: number; readonly type: string; readonly sku: string; readonly quantity: number; readonly locationCode: string; readonly lotNumber: string | null; readonly receivedAt: string; readonly receivedBy: string; readonly cancelledAt: string | null }[];
  readonly transactions: readonly { readonly id: string; readonly seq: number; readonly type: string; readonly sku: string; readonly qty: number; readonly fromLocationCode: string | null; readonly toLocationCode: string | null; readonly createdAt: string; readonly source: string }[];
  readonly timeline: readonly { readonly id: string; readonly type: string; readonly message: string; readonly source: string; readonly at: string }[];
  readonly exceptions: readonly { readonly id: string; readonly sku: string | null; readonly explanation: string; readonly inventoryQty: number | null; readonly requiredQty: number | null; readonly runAt: string; readonly runBy: string }[];
  readonly disassembledQty: number;
  readonly canReopenInProcess: boolean;
}

export interface KitComponentDetail {
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly packType: string;
  readonly bomQty: number;
  readonly freeQty: number;
  readonly onHandQty: number;
  readonly trackLot: boolean;
  readonly trackExpiry: boolean;
  readonly trackProductionDate: boolean;
}

export interface KitDetail {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly clientId: string;
  readonly kitType: string | null;
  readonly packType: string;
  readonly imageUrl: string | null;
  readonly trackLot: boolean;
  readonly trackExpiry: boolean;
  readonly trackProductionDate: boolean;
  readonly onHandQty: number;
  readonly netKittingCapacity: number;
  readonly components: readonly KitComponentDetail[];
}

export interface StockBucket {
  readonly id: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly lpId: string | null;
  readonly lpNumber: string | null;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly productionDate: string | null;
  readonly onHand: number;
  readonly freeQty: number;
  readonly status: string;
}

export interface BulkResult {
  readonly succeeded: readonly string[];
  readonly failed: readonly { readonly id: string; readonly code?: string; readonly message: string }[];
}

export const WO_P = {
  view: "inventory.work_orders.view",
  create: "inventory.work_orders.create",
  edit: "inventory.work_orders.edit",
  del: "inventory.work_orders.delete",
  createKit: "inventory.work_orders.create_kit",
  disassemble: "inventory.work_orders.disassemble_kit",
  tag: "inventory.work_orders.tag",
  picking: "inventory.work_orders.picking_job_operations",
  cancelPicking: "inventory.work_orders.cancel_picking",
  customFields: "inventory.work_orders.custom_field_management",
  importFile: "inventory.work_orders.import_file",
} as const;

export const WO_ENTITY = "work_order";

/** Invalidates every M08 list and detail after a mutation. */
export function useInvalidateWorkOrders(): () => Promise<void> {
  const qc = useQueryClient();
  return React.useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["grid"] }),
      qc.invalidateQueries({ queryKey: ["work-order"] }),
      qc.invalidateQueries({ queryKey: ["wo-status-counts"] }),
      qc.invalidateQueries({ queryKey: ["kit"] }),
      qc.invalidateQueries({ queryKey: ["kit-stock"] }),
      qc.invalidateQueries({ queryKey: ["change-log"] }),
    ]);
  }, [qc]);
}

const CF_SLOT = (field: string): string | null => (field.startsWith("cf_") ? field.slice(3) : null);

/** Grid filter fields with runtime options (warehouse codes, client names, custom field names). */
export function useWoFilterFields(fields: readonly WoGridField[], customFieldEntity?: string): readonly FilterFieldDef[] {
  const me = useMe();
  const defs = useApiQuery<unknown>(["custom-fields", customFieldEntity ?? ""], customFieldEntity ? "/api/custom-fields" : null, { query: { entityType: customFieldEntity } });
  const warehouses = me.data?.data.contextOptions.warehouses;
  const clients = me.data?.data.contextOptions.clients;
  const defData = defs.data?.data;
  return React.useMemo(() => {
    const defBySlot = new Map(parseList(customFieldDefSchema, defData).map((d) => [d.slot, d]));
    return fields.map((f): FilterFieldDef => {
      const slot = CF_SLOT(f.field);
      const def = slot ? defBySlot.get(slot) : undefined;
      let options: { value: string; label: string }[] | undefined = f.options?.map((v) => ({ value: v, label: v }));
      if (f.field === "warehouseCode") options = (warehouses ?? []).filter((w) => w.code).map((w) => ({ value: w.code ?? "", label: `${w.code} · ${w.name}` }));
      if (f.field === "clientName") options = (clients ?? []).map((c) => ({ value: c.name, label: c.name }));
      if (slot && f.type === "enum") options = (def?.options ?? []).map((v) => ({ value: v, label: v }));
      return {
        field: f.field, label: def?.name ?? f.label, type: f.type,
        ...(f.group ? { group: f.group } : {}), ...(f.allowEmpty ? { allowEmpty: true } : {}),
        ...(f.description ? { description: f.description } : {}), ...(options ? { options } : {}),
      };
    });
  }, [fields, warehouses, clients, defData]);
}

export function errorMessage(error: unknown): string {
  if (isApiError(error)) return error.code === "CONFLICT" ? "This record changed since you opened it — Reload" : error.message;
  return error instanceof Error ? error.message : "Something went wrong";
}

export async function postBulk(path: string, ids: readonly string[]): Promise<BulkResult> {
  return apiFetch<BulkResult>(path, { method: "POST", body: { ids } });
}

export function bulkToast(result: BulkResult, labelFor: (id: string) => string, verbs: { readonly done: string; readonly noun?: string }): void {
  const noun = verbs.noun ?? "work order";
  const ok = result.succeeded.length;
  const all = ok + result.failed.length;
  if (result.failed.length === 0) {
    toast.success("Success", `${ok} ${noun}${ok === 1 ? "" : "s"} ${verbs.done}.`);
    return;
  }
  const detail = result.failed.slice(0, 3).map((f) => `${labelFor(f.id)}: ${f.message}`).join(" · ");
  const more = result.failed.length > 3 ? ` · +${result.failed.length - 3} more` : "";
  toast.show({ variant: ok === 0 ? "error" : "warning", title: ok === 0 ? "Error" : "Partly done", message: `${ok} of ${all} ${noun}s ${verbs.done} · ${result.failed.length} failed. ${detail}${more}`, duration: 9000 });
}

export function openFile(href: string): void {
  window.open(href, "_blank", "noopener,noreferrer");
}
