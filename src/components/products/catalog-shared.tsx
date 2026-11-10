"use client";

/**
 * Client helpers shared by the M09 screens: filter fields with live options (clients,
 * lookups, pack types, stores, tags, custom-field names), bulk-result toasts, the
 * query invalidation used after every mutation, and small presentational bits.
 */
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ImageIcon } from "lucide-react";
import type { FilterFieldDef } from "@/components/grid";
import { customFieldDefSchema, parseList } from "@/components/shared/contracts";
import { toast } from "@/components/ui/toast";
import { apiRequest, isApiError } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { useCan } from "@/lib/permissions-client";
import { CUSTOM_FIELD_FILTERS, PRODUCT_GRID_FIELDS } from "@/lib/grid-defs/products/products-grid";
import { LISTING_GRID_FIELDS } from "@/lib/grid-defs/products/listings-grid";
import type { ProductGridOptions } from "@/server/repositories/products-options";
import type { ListingOptions } from "@/server/repositories/listings";


const noopSubscribe = () => () => {};
/** False on the server render and during hydration, true afterwards. */
export function useHydrated(): boolean {
  return React.useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/**
 * `useCan` that stays "loading" until hydration finishes. Streamed Suspense boundaries hydrate
 * after the app shell has already fetched /api/me, so a plain `useCan` would render mutation
 * controls on the first client pass that the server never rendered (hydration mismatch).
 */
export function useCatalogCan(permission: string): { readonly allowed: boolean; readonly isLoading: boolean } {
  const hydrated = useHydrated();
  const can = useCan(permission);
  return hydrated ? can : { allowed: false, isLoading: true };
}

export type { ProductListRow } from "@/server/repositories/products";
export type { ListingRow } from "@/server/repositories/listings";
export type { ProductDetailData, PackTypeView, InventoryBucketView } from "@/server/repositories/products-detail";

export interface BulkResult {
  readonly succeeded: readonly string[];
  readonly failed: readonly { readonly id: string; readonly code: string; readonly message: string }[];
}

export interface DeleteCheckRow {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly status: string;
  readonly reason: string | null;
}

/** Invalidates every catalog list and detail after a mutation. */
export function useInvalidateCatalog(): () => Promise<void> {
  const qc = useQueryClient();
  return React.useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["grid"] }),
      qc.invalidateQueries({ queryKey: ["product-detail"] }),
      qc.invalidateQueries({ queryKey: ["product-form"] }),
      qc.invalidateQueries({ queryKey: ["change-log"] }),
      qc.invalidateQueries({ queryKey: ["product-grid-options"] }),
    ]);
  }, [qc]);
}

/** Products grid filter fields with live options + custom-field names. */
export function useProductFilterFields(): readonly FilterFieldDef[] {
  const opts = useApiQuery<ProductGridOptions>(["product-grid-options"], "/api/products/options", { query: { for: "grid" }, staleTime: 60_000 });
  const defs = useApiQuery<unknown>(["custom-fields", "product"], "/api/custom-fields", { query: { entityType: "product" }, staleTime: 60_000 });
  const data = opts.data?.data;
  const defData = defs.data?.data;
  return React.useMemo(() => {
    const defBySlot = new Map(parseList(customFieldDefSchema, defData).map((d) => [d.slot, d]));
    return PRODUCT_GRID_FIELDS.map((f): FilterFieldDef => {
      const slot = CUSTOM_FIELD_FILTERS[f.field];
      const def = slot ? defBySlot.get(slot) : undefined;
      let options = f.options?.map((v) => ({ value: v, label: v }));
      if (f.optionsFrom && data) options = data[f.optionsFrom].map((o) => ({ value: o.value, label: o.description ? `${o.label} (${o.description})` : o.label }));
      if (def?.options?.length && f.type === "text") {
        return { field: f.field, label: def.name, type: "enum", group: f.group, options: def.options.map((v) => ({ value: v, label: v })) };
      }
      return {
        field: f.field, label: def ? def.name : f.label, type: f.type,
        ...(f.group ? { group: f.group } : {}), ...(f.decimals !== undefined ? { decimals: f.decimals } : {}), ...(options ? { options } : {}),
      };
    });
  }, [data, defData]);
}

/** Listings grid filter fields with live client / store / tag options. */
export function useListingFilterFields(): { fields: readonly FilterFieldDef[]; options: ListingOptions | undefined } {
  const opts = useApiQuery<ListingOptions>(["listing-options"], "/api/listings/options", { staleTime: 60_000 });
  const data = opts.data?.data;
  const fields = React.useMemo(() => LISTING_GRID_FIELDS.map((f): FilterFieldDef => {
    const options = f.options ?? (f.optionsFrom && data ? data[f.optionsFrom].map((o) => ({ value: o.value, label: o.label })) : undefined);
    return { field: f.field, label: f.label, type: f.type, ...(f.decimals !== undefined ? { decimals: f.decimals } : {}), ...(options ? { options } : {}) };
  }), [data]);
  return { fields, options: data };
}

export function errorMessage(error: unknown): string {
  if (isApiError(error)) return error.code === "CONFLICT" ? "This record changed since you opened it — Reload" : error.message;
  return error instanceof Error ? error.message : "Something went wrong";
}

export async function postBulk(path: string, body: Record<string, unknown>): Promise<BulkResult> {
  const { data } = await apiRequest<BulkResult>(path, { method: "POST", body });
  return data;
}

/** "3 of 4 products deleted · 1 failed (SKU: reason)". */
export function bulkToast(result: BulkResult, labelFor: (id: string) => string, verbs: { readonly done: string; readonly noun: string }): void {
  const ok = result.succeeded.length;
  const all = ok + result.failed.length;
  if (result.failed.length === 0) {
    toast.success("Success", `${ok} ${verbs.noun}${ok === 1 ? "" : "s"} ${verbs.done}.`);
    return;
  }
  const detail = result.failed.slice(0, 3).map((f) => `${labelFor(f.id)}: ${f.message}`).join(" · ");
  const more = result.failed.length > 3 ? ` · +${result.failed.length - 3} more` : "";
  toast.show({ variant: ok === 0 ? "error" : "warning", title: ok === 0 ? "Error" : "Partly done", message: `${ok} of ${all} ${verbs.noun}s ${verbs.done} · ${result.failed.length} failed. ${detail}${more}`, duration: 9000 });
}

export function ProductThumb({ url, size = 32, label }: { readonly url: string | null | undefined; readonly size?: number; readonly label: string }) {
  const [failed, setFailed] = React.useState(false);
  return (
    <span className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-sunken" style={{ width: size, height: size }} title={label}>
      {url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- product images come from arbitrary CDNs
        <img src={url} alt="" width={size} height={size} loading="lazy" className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <ImageIcon className="h-3.5 w-3.5 text-faint" aria-hidden />
      )}
    </span>
  );
}

/** Product-label print records (one per product, primary barcode). */
export function productLabelRecords(rows: readonly { sku: string; barcode: string; name: string; clientCode?: string; uom?: string }[]): unknown[] {
  return rows.map((r) => ({ sku: r.sku, barcode: r.barcode || r.sku, name: r.name, clientCode: r.clientCode || undefined, packType: r.uom || undefined }));
}
