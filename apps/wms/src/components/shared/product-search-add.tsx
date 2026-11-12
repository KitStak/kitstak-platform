"use client";

/**
 * Product search & add (BUILD_PLAN F4.4): client-scoped search (≥ 3 characters) via
 * `GET /api/pickers/products?q&clientId&warehouseId` → `[{ id, sku, name, imageUrl, atp, uom }]`.
 * Each result shows a thumbnail, SKU, name, live ATP, a quantity stepper and +.
 */
import * as React from "react";
import { Image as ImageIcon, Package, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFormat } from "@/lib/format";
import { useApiQuery } from "@/lib/query-client";
import { minCharsMessage } from "@/components/ui/combobox-data";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { Spinner } from "@/components/ui/spinner";
import { TextField } from "@/components/ui/text-field";
import { DisabledReason } from "@/components/ui/tooltip";
import { parseList, productPickSchema, type ProductPick } from "./contracts";

export const PRODUCT_SEARCH_MIN_CHARS = 3;
const DEBOUNCE_MS = 300;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

function ResultRow({ product, alreadyAdded, onAdd, allowOverAtp }: { readonly product: ProductPick; readonly alreadyAdded: boolean; readonly onAdd: (qty: number) => void; readonly allowOverAtp: boolean }) {
  const fmt = useFormat();
  const [qty, setQty] = React.useState<number | null>(1);
  const atp = product.atp ?? null;
  const over = atp !== null && qty !== null && qty > atp;
  const reason = qty === null || qty < 1 ? "Enter a quantity" : over && !allowOverAtp ? `Only ${fmt.quantity(atp)} available` : null;
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
        <span className="truncate text-sm font-semibold text-foreground">{product.sku}</span>
        <span className="truncate text-xs text-secondary">{product.name}</span>
      </span>
      <span className="w-24 shrink-0 text-right text-xs">
        <span className="block text-2xs font-semibold text-faint">ATP</span>
        <span className={cn("font-semibold tabular-nums", atp === null ? "text-faint" : atp <= 0 ? "text-danger" : over ? "text-warning" : "text-success")}>{atp === null ? "—" : fmt.quantity(atp)}</span>
      </span>
      <NumberInput className="w-28" size="sm" min={1} value={qty} onChange={setQty} aria-label={`Quantity of ${product.sku}`} />
      <DisabledReason reason={reason}>
        <Button variant={alreadyAdded ? "secondary" : "primary"} size="icon-sm" aria-label={`Add ${product.sku}`} disabled={Boolean(reason)} onClick={() => qty && onAdd(qty)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </DisabledReason>
    </li>
  );
}

export interface ProductSearchAddProps {
  readonly clientId: string | null;
  readonly warehouseId?: string | null;
  readonly onAdd: (product: ProductPick, quantity: number) => void;
  /** Ids already on the document (shown with a secondary + to add more). */
  readonly addedIds?: readonly string[];
  /** Allow quantities above ATP (e.g. purchase orders). */
  readonly allowOverAtp?: boolean;
  readonly autoFocus?: boolean;
}

export function ProductSearchAdd({ clientId, warehouseId, onAdd, addedIds = [], allowOverAtp = false, autoFocus }: ProductSearchAddProps) {
  const [q, setQ] = React.useState("");
  const term = useDebounced(q.trim(), DEBOUNCE_MS);
  const enabled = Boolean(clientId) && term.length >= PRODUCT_SEARCH_MIN_CHARS;
  const query = useApiQuery<unknown>(["picker", "products", clientId ?? "", warehouseId ?? "", term], enabled ? "/api/pickers/products" : null, { query: { q: term, clientId: clientId ?? undefined, warehouseId: warehouseId ?? undefined, limit: 25 } });
  const products = parseList(productPickSchema, query.data?.data);

  return (
    <div className="flex flex-col gap-2">
      <TextField
        value={q}
        autoFocus={autoFocus}
        disabled={!clientId}
        onChange={(e) => setQ(e.target.value)}
        placeholder={clientId ? "Search by SKU, name or barcode" : "Choose a client first"}
        aria-label="Search products"
        leading={<Search className="h-3.5 w-3.5" aria-hidden />}
        trailing={query.isFetching ? <Spinner className="h-3.5 w-3.5" /> : undefined}
      />
      <div className="overflow-hidden rounded-lg border border-border">
        {!clientId ? (
          <p className="px-3 py-6 text-center text-xs text-faint">Products are listed per client. Choose a client to search.</p>
        ) : q.trim().length < PRODUCT_SEARCH_MIN_CHARS ? (
          <p className="px-3 py-6 text-center text-xs text-faint">{minCharsMessage(PRODUCT_SEARCH_MIN_CHARS)}</p>
        ) : query.error ? (
          <p className="px-3 py-6 text-center text-xs text-danger">{query.error.message}</p>
        ) : query.isPending ? (
          <p className="px-3 py-6 text-center text-xs text-faint">Searching…</p>
        ) : products.length === 0 ? (
          <p className="flex flex-col items-center gap-1 px-3 py-6 text-center text-xs text-faint">
            <Package className="h-5 w-5" aria-hidden />
            No products match &ldquo;{term}&rdquo;
          </p>
        ) : (
          <ul className="ks-scroll max-h-80 divide-y divide-border overflow-auto" aria-label="Product results">
            {products.map((p) => (
              <ResultRow key={p.id} product={p} alreadyAdded={addedIds.includes(p.id)} allowOverAtp={allowOverAtp} onAdd={(qty) => onAdd(p, qty)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
