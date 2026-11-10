"use client";

/**
 * Per-bucket count entry table shared by the Count Sheet and Quick Count. One row per
 * expected bucket (SKU · lot · LP) with its system qty, a counted-qty input and a live
 * difference; plus "Add found stock" for product the system did not expect. Expected
 * stock left blank is rejected client-side (the server would count it as 0).
 */
import * as React from "react";
import { Copy, PackagePlus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { NumberInput } from "@/components/ui/number-input";
import { TextField } from "@/components/ui/text-field";
import { searchPicker, toOption } from "@/components/shared/entity-pickers";
import { percentDifference } from "@/lib/grid-defs/counts/count-math";
import { DeltaBadge, DifferenceBadge } from "./count-badges";

export interface SheetBucket {
  readonly inventoryId: string;
  readonly productId: string;
  readonly sku: string;
  readonly productName: string;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly lpNumber: string | null;
  readonly packType: string;
  readonly systemQty: number;
  readonly allocated: number;
}

export interface EntryDraft {
  readonly key: string;
  readonly inventoryId: string | null;
  readonly productId: string;
  readonly sku: string;
  readonly productName: string;
  readonly lotNumber: string | null;
  readonly lpNumber: string | null;
  readonly systemQty: number;
  readonly counted: number | null;
}

export interface EntryPayload {
  readonly inventoryId?: string | null;
  readonly productId?: string | null;
  readonly lotNumber?: string | null;
  readonly countedQty: number;
}

export function draftsFromBuckets(buckets: readonly SheetBucket[]): EntryDraft[] {
  return buckets.map((b) => ({
    key: b.inventoryId, inventoryId: b.inventoryId, productId: b.productId, sku: b.sku, productName: b.productName,
    lotNumber: b.lotNumber, lpNumber: b.lpNumber, systemQty: b.systemQty, counted: null,
  }));
}

/** First problem with the drafts, or null when every row has a count. */
export function draftsError(drafts: readonly EntryDraft[]): string | null {
  if (drafts.length === 0) return null;
  const blank = drafts.find((d) => d.counted === null);
  return blank ? `Enter a counted quantity for ${blank.sku}${blank.lotNumber ? ` (lot ${blank.lotNumber})` : ""}. Enter 0 if it is not there.` : null;
}

export function toPayload(drafts: readonly EntryDraft[]): EntryPayload[] {
  return drafts.map((d) => (d.inventoryId
    ? { inventoryId: d.inventoryId, countedQty: d.counted ?? 0 }
    : { productId: d.productId, lotNumber: d.lotNumber || null, countedQty: d.counted ?? 0 }));
}

export function draftTotals(drafts: readonly EntryDraft[]): { system: number; counted: number; delta: number; pct: number | null } {
  const system = drafts.reduce((s, d) => s + d.systemQty, 0);
  const counted = drafts.reduce((s, d) => s + (d.counted ?? 0), 0);
  const allCounted = drafts.every((d) => d.counted !== null);
  return { system, counted, delta: counted - system, pct: allCounted ? percentDifference(system, counted) : null };
}

export interface CountEntryTableProps {
  readonly drafts: readonly EntryDraft[];
  readonly onChange: (next: readonly EntryDraft[]) => void;
  readonly warehouseId: string;
  /** SKU-mode lines only count one product: hides "Add found stock" for others. */
  readonly productId?: string | null;
  readonly disabled?: boolean;
  readonly showErrors?: boolean;
  readonly idPrefix: string;
}

export function CountEntryTable({ drafts, onChange, warehouseId, productId, disabled, showErrors, idPrefix }: CountEntryTableProps) {
  const [foundProduct, setFoundProduct] = React.useState<{ id: string; label: string; name: string } | null>(null);
  const [foundLot, setFoundLot] = React.useState("");
  const setCount = (key: string, counted: number | null) => onChange(drafts.map((d) => (d.key === key ? { ...d, counted } : d)));
  const loadProducts = React.useCallback(async (q: string, signal: AbortSignal) => (await searchPicker("products", q, { warehouseId }, signal)).map(toOption), [warehouseId]);
  const totals = draftTotals(drafts);

  const addFound = () => {
    if (!foundProduct) return;
    const lot = foundLot.trim() || null;
    const key = `found:${foundProduct.id}:${lot ?? ""}`;
    if (drafts.some((d) => d.key === key || (d.productId === foundProduct.id && (d.lotNumber ?? null) === lot && !d.inventoryId))) return;
    onChange([...drafts, { key, inventoryId: null, productId: foundProduct.id, sku: foundProduct.label, productName: foundProduct.name, lotNumber: lot, lpNumber: null, systemQty: 0, counted: null }]);
    setFoundProduct(null);
    setFoundLot("");
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="ks-scroll overflow-auto rounded-lg border border-border">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead className="bg-surface-sunken text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
            <tr>
              <th scope="col" className="px-3 py-2">SKU</th>
              <th scope="col" className="px-3 py-2">Lot / LP</th>
              <th scope="col" className="px-3 py-2 text-right">System qty</th>
              <th scope="col" className="w-[150px] px-3 py-2">Counted qty</th>
              <th scope="col" className="px-3 py-2 text-right">Difference</th>
              <th scope="col" className="w-10 px-2 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {drafts.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center">
                <p className="text-[13px] font-semibold text-foreground">No stock expected here</p>
                <p className="mt-0.5 text-[12px] text-secondary">If you find product, add it below. Submitting an empty count confirms the location is empty.</p>
              </td></tr>
            ) : drafts.map((d) => {
              const invalid = showErrors && d.counted === null;
              const delta = d.counted === null ? null : d.counted - d.systemQty;
              return (
                <tr key={d.key} className={cn("border-t border-border", delta !== null && delta !== 0 && "bg-warning-soft/40")}>
                  <td className="px-3 py-1.5">
                    <span className="flex flex-col leading-tight">
                      <span className="font-semibold text-foreground">{d.sku}{d.inventoryId ? null : <span className="ml-1.5 rounded bg-primary-soft px-1.5 py-px text-[10px] font-semibold uppercase text-primary">Found</span>}</span>
                      <span className="truncate text-[11px] text-secondary">{d.productName}</span>
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-secondary">{[d.lotNumber, d.lpNumber].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{d.systemQty.toLocaleString()}</td>
                  <td className="px-3 py-1.5">
                    <NumberInput id={`${idPrefix}-${d.key}`} aria-label={`Counted qty for ${d.sku}`} min={0} max={10_000_000} size="sm" value={d.counted} onChange={(v) => setCount(d.key, v)} disabled={disabled} invalid={invalid} />
                  </td>
                  <td className="px-3 py-1.5 text-right">{delta === null ? <span className="text-faint">—</span> : <DeltaBadge value={delta} />}</td>
                  <td className="px-2 py-1.5">
                    {d.inventoryId ? (
                      <Button type="button" variant="ghost" size="icon" aria-label={`Use system qty for ${d.sku}`} title="Use system qty" disabled={disabled} onClick={() => setCount(d.key, d.systemQty)}><Copy className="h-3.5 w-3.5" aria-hidden /></Button>
                    ) : (
                      <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${d.sku}`} title="Remove found stock" disabled={disabled} onClick={() => onChange(drafts.filter((x) => x.key !== d.key))}><Trash2 className="h-3.5 w-3.5" aria-hidden /></Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {drafts.length > 0 ? (
            <tfoot className="border-t border-border-strong bg-surface-sunken text-[12px] font-semibold">
              <tr>
                <td className="px-3 py-2 text-secondary" colSpan={2}>Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{totals.system.toLocaleString()}</td>
                <td className="px-3 py-2 tabular-nums">{totals.counted.toLocaleString()}</td>
                <td className="px-3 py-2 text-right"><DifferenceBadge value={totals.pct} /></td>
                <td />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={disabled || drafts.every((d) => !d.inventoryId)} onClick={() => onChange(drafts.map((d) => (d.inventoryId && d.counted === null ? { ...d, counted: d.systemQty } : d)))}>
          <Copy className="h-3.5 w-3.5" aria-hidden />Fill blanks with system qty
        </Button>
        <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />
        <div className="min-w-[220px] flex-1">
          <Combobox id={`${idPrefix}-found`} aria-label="Found product" loadOptions={loadProducts} minChars={1} value={foundProduct?.id ?? null}
            selectedOptions={foundProduct ? [{ value: foundProduct.id, label: foundProduct.label }] : undefined}
            onChange={(v, o) => setFoundProduct(v && o ? { id: v, label: o.label, name: o.description ?? "" } : null)} placeholder={productId ? "Only this line's SKU can be added" : "Found stock: search SKU"} disabled={disabled || Boolean(productId)} clearable />
        </div>
        <div className="w-[140px]">
          <TextField aria-label="Found lot" placeholder="Lot (optional)" value={foundLot} maxLength={60} onChange={(e) => setFoundLot(e.target.value)} disabled={disabled || !foundProduct} />
        </div>
        <Button type="button" size="sm" variant="secondary" disabled={disabled || !foundProduct} onClick={addFound}><PackagePlus className="h-3.5 w-3.5" aria-hidden />Add found stock</Button>
      </div>
    </div>
  );
}
