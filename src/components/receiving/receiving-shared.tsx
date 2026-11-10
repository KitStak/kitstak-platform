"use client";

/**
 * Client helpers shared by the M05 screens: filter fields with runtime options
 * (clients, warehouses, tags, custom-field names), row types mirrored from the
 * repositories, bulk-result toasts and small presentational bits.
 */
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { FilterFieldDef } from "@/components/grid";
import { customFieldDefSchema, parseList, tagSchema } from "@/components/shared/contracts";
import { toast } from "@/components/ui/toast";
import { apiRequest, isApiError } from "@/lib/api-client";
import { useCan as useCanRaw, useMe, type PermissionInput, type PermissionMode } from "@/lib/permissions-client";
import { useApiQuery } from "@/lib/query-client";
import type { ReceivingGridField } from "@/lib/grid-defs/receiving/purchase-orders";

/* ---------------- row types (mirrors of the server repositories) ---------------- */

export interface TagChip {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

export interface PoRow {
  readonly id: string;
  readonly code: string;
  readonly vendorId: string | null;
  readonly vendorName: string;
  readonly referenceNumber: string | null;
  readonly purchasePrice: number;
  readonly totalQuantity: number;
  readonly receivedQuantity: number;
  readonly status: string;
  readonly rawStatus: string;
  readonly poType: string;
  readonly tags: readonly TagChip[];
  readonly poDate: string | null;
  readonly clientId: string;
  readonly clientName: string;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly createdAt: string;
  readonly plannedReceivingDate: string | null;
  readonly receivedAt: string | null;
  readonly plannedArrivalDate: string | null;
  readonly actualArrivalDate: string | null;
  readonly activeReceipts: number;
  readonly version: number;
  readonly receivingLocationCode: string | null;
}

export interface Tracking {
  readonly lot: boolean;
  readonly expiry: boolean;
  readonly production: boolean;
  readonly serial: boolean;
}

export interface PoLineRow {
  readonly id: string;
  readonly productId: string;
  readonly sku: string;
  readonly productName: string;
  readonly barcode: string;
  readonly imageUrl: string | null;
  readonly uom: string;
  readonly packType: string;
  readonly uomQuantity: number;
  readonly orderedQuantity: number;
  readonly receivedQuantity: number;
  readonly damagedQuantity: number;
  readonly unitCost: number;
  readonly totalPrice: number;
  readonly receivingLocationId: string | null;
  readonly receivingLocationCode: string | null;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly productionDate: string | null;
  readonly lpTypeId: string | null;
  readonly lpTypeCode: string | null;
  readonly lpNumber: string | null;
  readonly note: string | null;
  readonly tracking: Tracking;
  readonly version: number;
}

export interface VendorAddress {
  readonly name: string;
  readonly line1: string;
  readonly line2: string;
  readonly postalCode: string;
  readonly city: string;
  readonly phone: string;
  readonly country: string;
  readonly state: string;
}

export interface VendorRow {
  readonly id: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly displayName: string;
  readonly vendorName: string;
  readonly isActive: boolean;
  readonly useShipAsBilling: boolean;
  readonly openPoCount: number;
  readonly city: string | null;
  readonly state: string | null;
  readonly version: number;
  readonly createdAt: string;
}

export interface VendorDetail extends VendorRow {
  readonly shipping: VendorAddress | null;
  readonly billing: VendorAddress | null;
}

export interface PoDetail extends PoRow {
  readonly note: string | null;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
  readonly customFields: Readonly<Record<string, string | boolean | null>>;
  readonly lines: readonly PoLineRow[];
  readonly vendor: VendorDetail | null;
  readonly warehouseCode: string;
  readonly clientCode: string;
  readonly defaultReceivingLocation: { readonly id: string; readonly code: string } | null;
  readonly attachmentCount: number;
  readonly allowedStatuses: readonly string[];
}

export interface ProductInfo {
  readonly id: string;
  readonly clientId: string;
  readonly sku: string;
  readonly name: string;
  readonly barcode: string;
  readonly imageUrl: string | null;
  readonly uom: string;
  readonly purchasePrice: number;
  readonly packTypes: readonly { readonly packType: string; readonly uomQty: number }[];
  readonly tracking: Tracking;
}

export interface BulkResult {
  readonly succeeded: readonly string[];
  readonly failed: readonly { readonly id: string; readonly code: string; readonly message: string }[];
}

/* ---------------- query keys ---------------- */

export const PO_KEYS = {
  grid: ["grid", "purchase-orders"] as const,
  detail: (id: string) => ["purchase-order", id] as const,
  receipts: (id: string) => ["purchase-order-receipts", id] as const,
  receiptsGrid: ["grid", "receiving-history"] as const,
  vendorsGrid: ["grid", "vendors"] as const,
};

/** Invalidates every M05 list + detail after a mutation. */
const noopSubscribe = () => () => {};
/** False on the server render and during hydration, true afterwards. */
export function useHydrated(): boolean {
  return React.useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/**
 * `useCan` that stays "loading" until hydration finishes. The app shell has usually fetched
 * /api/me before these Suspense boundaries hydrate, so a plain `useCan` renders permission-gated
 * controls on the first client pass that the server never rendered (hydration mismatch).
 */
export function useCan(required: PermissionInput, mode: PermissionMode = "all"): { readonly allowed: boolean; readonly isLoading: boolean } {
  const hydrated = useHydrated();
  const can = useCanRaw(required, mode);
  return hydrated ? can : { allowed: false, isLoading: true };
}

export function useInvalidateReceiving(): () => Promise<void> {
  const qc = useQueryClient();
  return React.useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["grid"] }),
      qc.invalidateQueries({ queryKey: ["purchase-order"] }),
      qc.invalidateQueries({ queryKey: ["purchase-order-receipts"] }),
      qc.invalidateQueries({ queryKey: ["vendor-list"] }),
      qc.invalidateQueries({ queryKey: ["change-log"] }),
    ]);
  }, [qc]);
}

/* ---------------- filter fields with runtime options ---------------- */

const CF_SLOT = (field: string): string | null => (field.startsWith("cf_") ? field.slice(3) : null);

export function useFilterFields(fields: readonly ReceivingGridField[], options: { readonly customFieldEntity?: string; readonly tagScope?: string } = {}): readonly FilterFieldDef[] {
  const me = useMe();
  const tags = useApiQuery<unknown>(["tags", options.tagScope ?? ""], options.tagScope ? "/api/tags" : null, { query: { scope: options.tagScope } });
  const defs = useApiQuery<unknown>(["custom-fields", options.customFieldEntity ?? ""], options.customFieldEntity ? "/api/custom-fields" : null, { query: { entityType: options.customFieldEntity } });
  const warehouses = me.data?.data.contextOptions.warehouses;
  const clients = me.data?.data.contextOptions.clients;
  const tagData = tags.data?.data;
  const defData = defs.data?.data;
  return React.useMemo(() => {
    const tagRows = parseList(tagSchema, tagData);
    const defRows = parseList(customFieldDefSchema, defData);
    const defBySlot = new Map(defRows.map((d) => [d.slot, d]));
    return fields.map((f): FilterFieldDef => {
      const slot = CF_SLOT(f.field);
      const def = slot ? defBySlot.get(slot) : undefined;
      const label = def ? def.name : f.label;
      let opts: { value: string; label: string }[] | undefined = f.options?.map((v) => ({ value: v, label: v }));
      if (f.dynamicOptions === "clients") opts = (clients ?? []).map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.name}` : c.name }));
      if (f.dynamicOptions === "warehouses") opts = (warehouses ?? []).map((w) => ({ value: w.id, label: w.code ? `${w.code} · ${w.name}` : w.name }));
      if (f.dynamicOptions === "tags") opts = tagRows.map((t) => ({ value: t.id, label: t.name }));
      if (f.dynamicOptions === "customFieldOptions") opts = (def?.options ?? []).map((v) => ({ value: v, label: v }));
      return {
        field: f.field, label, type: f.type, ...(f.group ? { group: f.group } : {}), ...(f.allowEmpty ? { allowEmpty: true } : {}),
        ...(f.decimals !== undefined ? { decimals: f.decimals } : {}), ...(opts ? { options: opts } : {}),
      };
    });
  }, [fields, clients, warehouses, tagData, defData]);
}

/* ---------------- bulk toasts ---------------- */

export function bulkToast(result: BulkResult, labelFor: (id: string) => string, verbs: { readonly done: string; readonly noun: string; readonly successMessage?: string }): void {
  const ok = result.succeeded.length;
  const all = ok + result.failed.length;
  if (result.failed.length === 0) {
    toast.success("Success", verbs.successMessage ?? `${ok} ${verbs.noun}${ok === 1 ? "" : "s"} ${verbs.done}.`);
    return;
  }
  const detail = result.failed.slice(0, 3).map((f) => `${labelFor(f.id)}: ${f.message}`).join(" · ");
  const more = result.failed.length > 3 ? ` · +${result.failed.length - 3} more` : "";
  const variant = ok === 0 ? "error" : "warning";
  toast.show({ variant, title: ok === 0 ? "Error" : "Partly done", message: `${ok} of ${all} ${verbs.noun}s ${verbs.done} · ${result.failed.length} failed. ${detail}${more}`, duration: 9000 });
}

export function errorMessage(error: unknown): string {
  if (isApiError(error)) return error.code === "CONFLICT" ? "This record changed since you opened it — Reload" : error.message;
  return error instanceof Error ? error.message : "Something went wrong";
}

export async function postBulk(path: string, ids: readonly string[]): Promise<BulkResult> {
  const { data } = await apiRequest<BulkResult>(path, { method: "POST", body: { ids } });
  return data;
}

/* ---------------- presentational ---------------- */

export function ProductThumb({ url, size = 32, label }: { readonly url: string | null; readonly size?: number; readonly label: string }) {
  const initials = label.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "—";
  return (
    <span className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-sunken text-[10px] font-semibold text-faint" style={{ width: size, height: size }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- product images come from arbitrary CDNs
        <img src={url} alt="" width={size} height={size} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden>{initials}</span>
      )}
    </span>
  );
}

export function openFile(href: string): void {
  window.open(href, "_blank", "noopener,noreferrer");
}
