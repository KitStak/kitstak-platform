"use client";

/**
 * Client contracts + helpers for the Shipment Orders module: row/detail types (type-only
 * imports of the server shapes), option lists, bulk calls and their toasts.
 */
import * as React from "react";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { apiFetch, isApiError } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { toast } from "@/components/ui/toast";
import type { OrderDetail, OrderGridRow } from "@/server/repositories/orders";
import type { OrderFormOptions } from "@/server/repositories/orders-options";
import type { LabelBulkResult } from "@/server/repositories/orders-labels";
import type { PrintRecordsResult } from "@/server/repositories/orders-print";
import type { OrderBulkAction } from "@/lib/grid-defs/orders/shipment-orders";

export type OrderRow = OrderGridRow & {
  readonly customerName?: string;
  readonly shipState?: string;
  readonly storeName?: string | null;
  readonly jobCode?: string | null;
  readonly mergedOrderCode?: string | null;
};
export type { OrderDetail, OrderFormOptions, LabelBulkResult, PrintRecordsResult };

export const ORDERS_QUERY_KEY = ["grid"] as const;
export const orderDetailKey = (id: string) => ["order", id] as const;
/**
 * Every order mutation (save, hold/release, cancel, job, ship, duplicate, tag, label) refreshes
 * the grid, the detail, the counts and the audit views: the change-log drawer / activity
 * timeline (`["change-log", …]`) and the timeline ledger, so "Show change log" never shows a
 * pre-edit list (critic r5: the warmed drawer cache hid "Note is modified…" until reload).
 */
export const ORDER_INVALIDATE: readonly (readonly unknown[])[] = [["grid"], ["order"], ["order-counts"], ["change-log"], ["timeline-ledger"]];

export interface BulkOutcome {
  readonly succeeded: readonly string[];
  readonly failed: readonly { readonly id: string; readonly code: string; readonly message: string }[];
  readonly childIds?: readonly string[];
}

export function useOrderOptions(warehouseId?: string | null, clientId?: string | null) {
  return useApiQuery<OrderFormOptions>(["order-options", warehouseId ?? "", clientId ?? ""], "/api/orders/options", {
    query: { warehouseId: warehouseId ?? undefined, clientId: clientId ?? undefined },
    staleTime: 60_000,
    // Keep the previous lists while a warehouse/client-scoped refetch runs (no "No results" flash).
    placeholderData: keepPreviousData,
  });
}

/** Optimistically patches cached grid rows (e.g. status → On Hold) until the refetch lands. */
export function usePatchOrderRows(): (ids: readonly string[], patch: Partial<OrderRow>) => void {
  const qc = useQueryClient();
  return React.useCallback((ids, patch) => {
    const set = new Set(ids);
    qc.setQueriesData<{ data?: unknown }>({ queryKey: ORDERS_QUERY_KEY }, (old) => {
      if (!old || !Array.isArray(old.data)) return old;
      return { ...old, data: (old.data as OrderRow[]).map((r) => (r && set.has(r.id) ? { ...r, ...patch } : r)) };
    });
  }, [qc]);
}

export function useInvalidateOrders(): () => Promise<void> {
  const qc = useQueryClient();
  return React.useCallback(async () => {
    await Promise.all(ORDER_INVALIDATE.map((queryKey) => qc.invalidateQueries({ queryKey })));
  }, [qc]);
}

/** "3 of 4 orders cancelled · 1 failed" + the first failure reasons. */
export function bulkToast(result: BulkOutcome, verb: string, codes: ReadonlyMap<string, string>): void {
  const ok = result.succeeded.length;
  const all = ok + result.failed.length;
  const noun = all === 1 ? "order" : "orders";
  const base = `${ok} of ${all} ${noun} ${verb}`;
  if (result.failed.length === 0) {
    toast.success("Success", base);
    return;
  }
  const reasons = result.failed.slice(0, 3).map((f) => `${codes.get(f.id) ?? "Order"}: ${f.message}`).join(" · ");
  const more = result.failed.length > 3 ? ` · +${result.failed.length - 3} more` : "";
  (ok > 0 ? toast.warning : toast.error)(ok > 0 ? `${base} · ${result.failed.length} failed` : "Nothing changed", `${reasons}${more}`);
}

export async function runBulk(action: OrderBulkAction, body: Record<string, unknown>): Promise<BulkOutcome> {
  return apiFetch<BulkOutcome>(`/api/orders/bulk/${action}`, { method: "POST", body });
}

export async function runLabels(action: "create" | "void" | "reprint" | "return" | "void-return", ids: readonly string[]): Promise<LabelBulkResult> {
  return apiFetch<LabelBulkResult>("/api/orders/bulk/labels", { method: "POST", body: { action, ids } });
}

export async function fetchPrintRecords(type: string, ids: readonly string[]): Promise<PrintRecordsResult> {
  return apiFetch<PrintRecordsResult>("/api/orders/print-records", { method: "POST", body: { type, ids } });
}

export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
  return isApiError(error) ? error.message : error instanceof Error ? error.message : fallback;
}

/** Opens stored label files: the first in a new tab (pop-up safe), the rest via toast. */
export function openFiles(fileIds: readonly string[]): void {
  if (fileIds.length === 0) return;
  const first = fileIds[0] as string;
  const url = fileUrl(first);
  // `noopener` in the features string makes window.open return null even when the tab opened,
  // which used to raise a false "Pop-up blocked". Open normally, then cut the opener link.
  const w = window.open(url, "_blank");
  if (w) {
    try {
      w.opener = null;
    } catch {
      /* cross-origin guard; nothing to detach */
    }
    return;
  }
  // Really blocked: offer an in-app link (a click is a user gesture, so it is never blocked).
  toast.show({
    id: `label-pdf-${first}`,
    variant: "warning",
    title: "Pop-up blocked",
    message: fileIds.length > 1 ? `${fileIds.length} label files are ready. Open the first one here, or allow pop-ups for KitStak.` : "The label PDF is ready. Open it here, or allow pop-ups for KitStak.",
    duration: 15000,
    action: { label: "Open label PDF", onClick: () => void window.open(url, "_blank", "noreferrer") },
  });
}

/** Inline URL of a stored file (label PDFs, printouts). */
export function fileUrl(fileId: string): string {
  return `/api/files/${encodeURIComponent(fileId)}?inline=1`;
}
