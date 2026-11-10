"use client";

/**
 * Local adapter for the shared ProductSearchAdd (REQ-10). `/api/pickers/products`
 * returns picker options `{ id, label: sku, sublabel: name, meta }`, but the shared
 * component parses `{ id, sku, name }` and silently drops every result. Purchase orders
 * don't check ATP, so this renders the same row (thumb, SKU, name, qty stepper, +) from
 * the picker shape. Delete once REQ-10 lands and switch back to ProductSearchAdd.
 */
import * as React from "react";
import { Image as ImageIcon, Package, Plus, Search } from "lucide-react";
import { z } from "zod";
import { minCharsMessage } from "@/components/ui/combobox-data";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { Spinner } from "@/components/ui/spinner";
import { TextField } from "@/components/ui/text-field";
import { DisabledReason } from "@/components/ui/tooltip";
import { useApiQuery } from "@/lib/query-client";

export const PO_SEARCH_MIN_CHARS = 3;
const DEBOUNCE_MS = 300;
const RESULT_LIMIT = 25;

const pickerOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  sublabel: z.string().nullish(),
  meta: z.object({ name: z.string().nullish(), imageUrl: z.string().nullish() }).partial().nullish(),
});

export interface PoProductPick {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly imageUrl: string | null;
}

/** Maps picker options to products; malformed rows are skipped, not the whole list. */
export function toProductPicks(data: unknown): readonly PoProductPick[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const parsed = pickerOptionSchema.safeParse(row);
    if (!parsed.success) return [];
    const o = parsed.data;
    return [{ id: o.id, sku: o.label, name: o.meta?.name ?? o.sublabel ?? "", imageUrl: o.meta?.imageUrl ?? null }];
  });
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

function ResultRow({ product, alreadyAdded, onAdd }: { readonly product: PoProductPick; readonly alreadyAdded: boolean; readonly onAdd: (qty: number) => void }) {
  const [qty, setQty] = React.useState<number | null>(1);
  const reason = qty === null || qty < 1 ? "Enter a quantity" : null;
  return (
    <li className="flex items-center gap-3 px-3 py-2 hover:bg-surface-sunken">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-sunken">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- product images come from arbitrary channel CDNs
          <img src={product.imageUrl} alt="" width={40} height={40} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <ImageIcon className="h-4 w-4 text-faint" aria-hidden />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-semibold text-foreground">{product.sku}</span>
        <span className="truncate text-[12px] text-secondary">{product.name}</span>
      </span>
      {alreadyAdded ? <span className="shrink-0 text-[11px] font-medium text-secondary">On this order</span> : null}
      <NumberInput className="w-28" size="sm" min={1} value={qty} onChange={setQty} aria-label={`Quantity of ${product.sku}`} />
      <DisabledReason reason={reason}>
        <Button variant={alreadyAdded ? "secondary" : "primary"} size="icon-sm" aria-label={`Add ${product.sku}`} disabled={Boolean(reason)} onClick={() => qty && onAdd(qty)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </DisabledReason>
    </li>
  );
}

export interface PoProductSearchProps {
  readonly clientId: string;
  readonly warehouseId: string | null;
  readonly addedIds: readonly string[];
  readonly onAdd: (product: PoProductPick, quantity: number) => void;
}

export function PoProductSearch({ clientId, warehouseId, addedIds, onAdd }: PoProductSearchProps) {
  const [q, setQ] = React.useState("");
  const term = useDebounced(q.trim(), DEBOUNCE_MS);
  const enabled = term.length >= PO_SEARCH_MIN_CHARS;
  const query = useApiQuery<unknown>(["picker", "po-products", clientId, warehouseId ?? "", term], enabled ? "/api/pickers/products" : null, {
    query: { q: term, clientId, warehouseId: warehouseId ?? undefined, limit: RESULT_LIMIT },
  });
  const products = toProductPicks(query.data?.data);
  const short = q.trim().length < PO_SEARCH_MIN_CHARS;

  return (
    <div className="flex flex-col gap-2">
      <TextField
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onClear={() => setQ("")}
        placeholder="Search by SKU, name or barcode"
        aria-label="Search products"
        leading={<Search className="h-3.5 w-3.5" aria-hidden />}
        trailing={query.isFetching ? <Spinner className="h-3.5 w-3.5" /> : undefined}
      />
      <div className="overflow-hidden rounded-lg border border-border">
        {short ? (
          <p className="px-3 py-6 text-center text-[12px] text-faint">{minCharsMessage(PO_SEARCH_MIN_CHARS)}</p>
        ) : query.error ? (
          <p className="px-3 py-6 text-center text-[12px] text-danger">{query.error.message}</p>
        ) : query.isPending || term !== q.trim() ? (
          <p className="px-3 py-6 text-center text-[12px] text-faint">Searching…</p>
        ) : products.length === 0 ? (
          <p className="flex flex-col items-center gap-1 px-3 py-6 text-center text-[12px] text-faint">
            <Package className="h-5 w-5" aria-hidden />
            No products match &ldquo;{term}&rdquo;
          </p>
        ) : (
          <ul className="ks-scroll max-h-80 divide-y divide-border overflow-auto" aria-label="Product results">
            {products.map((p) => (
              <ResultRow key={p.id} product={p} alreadyAdded={addedIds.includes(p.id)} onAdd={(qty) => onAdd(p, qty)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
