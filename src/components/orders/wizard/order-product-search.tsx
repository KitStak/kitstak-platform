"use client";

/**
 * Wizard Step 3 product search: client-scoped search (≥ 3 characters) through the shared
 * products picker, enriched in one batch with `/api/orders/product-facts` so every result
 * shows live warehouse ATP (green / amber / red) and carries the facts the line needs.
 * Adding is therefore instant (no second round trip); the clicked row shows a busy state
 * and ignores repeat clicks while the add is applied.
 */
import * as React from "react";
import { Check, Image as ImageIcon, Package, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFormat } from "@/lib/format";
import { useApiQuery } from "@/lib/query-client";
import { minCharsMessage } from "@/components/ui/combobox-data";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { Spinner } from "@/components/ui/spinner";
import { TextField } from "@/components/ui/text-field";
import { DisabledReason } from "@/components/ui/tooltip";
import { parseList, productPickSchema, type ProductPick } from "@/components/shared/contracts";
import type { OrderProductFacts } from "@/server/repositories/orders-wizard";

export const ORDER_SEARCH_MIN_CHARS = 3;
const DEBOUNCE_MS = 300;

/** ATP colour: red when none, amber when the entered quantity exceeds it, green otherwise. */
export function atpTone(atp: number | null, qty: number | null): "none" | "out" | "over" | "ok" {
  if (atp === null) return "none";
  if (atp <= 0) return "out";
  if (qty !== null && qty > atp) return "over";
  return "ok";
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

interface RowProps {
  readonly product: ProductPick;
  readonly facts: OrderProductFacts | undefined;
  readonly factsLoading: boolean;
  readonly alreadyAdded: boolean;
  readonly onAdd: (facts: OrderProductFacts, qty: number) => Promise<void> | void;
}

function ResultRow({ product, facts, factsLoading, alreadyAdded, onAdd }: RowProps) {
  const fmt = useFormat();
  const [qty, setQty] = React.useState<number | null>(1);
  const [busy, setBusy] = React.useState(false);
  const [flash, setFlash] = React.useState(false);
  const atp = facts ? facts.atp : null;
  const tone = atpTone(atp, qty);
  const reason = busy ? "Adding…" : qty === null || qty < 1 ? "Enter a quantity" : !facts ? (factsLoading ? "Loading product details…" : "Product details unavailable") : null;

  const add = async () => {
    if (busy || !facts || !qty) return;
    setBusy(true);
    try {
      await onAdd(facts, qty);
      setFlash(true);
      window.setTimeout(() => setFlash(false), 1200);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={cn("flex items-center gap-3 px-3 py-2 transition-colors hover:bg-surface-sunken", flash && "bg-success-soft/60")} aria-busy={busy || undefined}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-sunken">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- product images come from arbitrary channel CDNs
          <img src={product.imageUrl} alt="" width={40} height={40} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <ImageIcon className="h-4 w-4 text-faint" aria-hidden />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold text-foreground" title={product.sku}>{product.sku}</span>
        <span className="truncate text-xs text-secondary" title={product.name}>{product.name}</span>
      </span>
      <span className="w-28 shrink-0 text-right text-xs">
        <span className="block text-2xs font-semibold text-faint">ATP</span>
        {factsLoading && !facts ? (
          <span className="inline-block h-3 w-8 animate-pulse rounded bg-neutral-soft align-middle" aria-label="Loading ATP" />
        ) : (
          <span className={cn("font-semibold tabular-nums", tone === "none" ? "text-faint" : tone === "out" ? "text-danger" : tone === "over" ? "text-warning" : "text-success")}>
            {atp === null ? "—" : fmt.quantity(atp)}
          </span>
        )}
        {tone === "over" && atp !== null ? <span className="block text-2xs leading-3 text-warning">Only {fmt.quantity(atp)} available</span> : null}
        {tone === "out" ? <span className="block text-2xs leading-3 text-danger">Out of stock</span> : null}
        {atp !== null && atp > 0 && facts?.allocatable != null && facts.allocatable < atp ? (
          <span className="block text-2xs leading-3 text-warning" title="Some stock sits in locked, inactive or no-allocation locations, so allocation can't take it now.">
            {fmt.quantity(facts.allocatable)} allocatable now
          </span>
        ) : null}
      </span>
      <NumberInput className="w-28" size="sm" min={1} value={qty} onChange={setQty} aria-label={`Quantity of ${product.sku}`} disabled={busy} />
      <DisabledReason reason={reason === "Adding…" ? null : reason}>
        <Button
          variant={alreadyAdded ? "secondary" : "primary"}
          size="icon-sm"
          aria-label={alreadyAdded ? `Add more ${product.sku}` : `Add ${product.sku}`}
          disabled={Boolean(reason)}
          onClick={() => void add()}
        >
          {busy ? <Spinner className="h-3.5 w-3.5" label={`Adding ${product.sku}`} /> : flash ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
        </Button>
      </DisabledReason>
    </li>
  );
}

export interface OrderProductSearchProps {
  readonly clientId: string | null;
  readonly warehouseId: string | null;
  readonly addedIds: readonly string[];
  readonly onAdd: (facts: OrderProductFacts, qty: number) => Promise<void> | void;
}

export function OrderProductSearch({ clientId, warehouseId, addedIds, onAdd }: OrderProductSearchProps) {
  const [q, setQ] = React.useState("");
  const term = useDebounced(q.trim(), DEBOUNCE_MS);
  const enabled = Boolean(clientId) && term.length >= ORDER_SEARCH_MIN_CHARS;
  const query = useApiQuery<unknown>(["picker", "products", clientId ?? "", warehouseId ?? "", term], enabled ? "/api/pickers/products" : null, {
    query: { q: term, clientId: clientId ?? undefined, warehouseId: warehouseId ?? undefined, limit: 25 },
  });
  const products = parseList(productPickSchema, query.data?.data);
  const ids = products.map((p) => p.id).join(",");
  const facts = useApiQuery<readonly OrderProductFacts[]>(["order-product-facts", warehouseId ?? "", ids], ids ? "/api/orders/product-facts" : null, {
    query: { ids, warehouseId: warehouseId ?? undefined },
    staleTime: 10_000,
  });
  const byId = React.useMemo(() => new Map((facts.data?.data ?? []).map((f) => [f.id, f])), [facts.data]);

  return (
    <div className="flex flex-col gap-2">
      <TextField
        value={q}
        disabled={!clientId}
        onChange={(e) => setQ(e.target.value)}
        placeholder={clientId ? "Search by SKU, name or barcode" : "Choose a client first"}
        aria-label="Search products"
        leading={<Search className="h-3.5 w-3.5" aria-hidden />}
        trailing={query.isFetching ? <Spinner className="h-3.5 w-3.5" label="Searching" /> : undefined}
        onClear={q ? () => setQ("") : undefined}
      />
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {!clientId ? (
          <p className="px-3 py-6 text-center text-xs text-faint">Products are listed per client. Choose a client to search.</p>
        ) : q.trim().length < ORDER_SEARCH_MIN_CHARS ? (
          <p className="px-3 py-6 text-center text-xs text-faint">{minCharsMessage(ORDER_SEARCH_MIN_CHARS)}</p>
        ) : query.error ? (
          <p className="px-3 py-6 text-center text-xs text-danger">{query.error.message}</p>
        ) : query.isPending || term !== q.trim() && products.length === 0 ? (
          <p className="flex items-center justify-center gap-2 px-3 py-6 text-center text-xs text-faint"><Spinner className="h-3.5 w-3.5" /> Searching…</p>
        ) : products.length === 0 ? (
          <p className="flex flex-col items-center gap-1 px-3 py-6 text-center text-xs text-faint">
            <Package className="h-5 w-5" aria-hidden />
            No products match &ldquo;{term}&rdquo;
          </p>
        ) : (
          <ul className="ks-scroll max-h-80 divide-y divide-border overflow-auto" aria-label="Product results">
            {products.map((p) => (
              <ResultRow key={p.id} product={p} facts={byId.get(p.id)} factsLoading={facts.isPending || facts.isFetching} alreadyAdded={addedIds.includes(p.id)} onAdd={onAdd} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
