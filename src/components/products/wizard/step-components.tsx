"use client";

/**
 * Kit Components step: client-scoped search (standard products and kit-to-stock kits),
 * quantity per kit, remove. At least one component is required (beyond Logiwa).
 */
import * as React from "react";
import { useFormContext, useFormState, useWatch } from "react-hook-form";
import { ImageIcon, PackageSearch, Plus, Search, Trash2 } from "lucide-react";
import { useApiQuery } from "@/lib/query-client";
import type { ComponentFormValue } from "@/lib/grid-defs/products/product-form";
import type { ComponentOption } from "@/server/repositories/products-options";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldError } from "@/components/ui/form";
import { NumberInput } from "@/components/ui/number-input";
import { Spinner } from "@/components/ui/spinner";
import { useProductWizard } from "./context";

const DEBOUNCE_MS = 250;

function useDebounced(value: string): string {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value]);
  return v;
}

function Thumb({ url }: { readonly url?: string | null }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-sunken">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary CDN images
        <img src={url} alt="" width={36} height={36} className="h-full w-full object-cover" />
      ) : <ImageIcon className="h-4 w-4 text-faint" aria-hidden />}
    </span>
  );
}

export function StepComponents() {
  const form = useFormContext();
  const { productId } = useProductWizard();
  const clientId = useWatch({ name: "clientId" }) as string;
  const components = (useWatch({ name: "components" }) as ComponentFormValue[] | undefined) ?? [];
  const { errors } = useFormState({ name: "components" });
  const [query, setQuery] = React.useState("");
  const term = useDebounced(query.trim());
  const search = useApiQuery<ComponentOption[]>(["kit-components", clientId, term], clientId ? "/api/products/components" : null, { query: { clientId, q: term, excludeId: productId ?? undefined } });
  const results = search.data?.data ?? [];
  const added = new Set(components.map((c) => c.productId));
  const err = errors.components as { message?: string; root?: { message?: string } } | undefined;
  const message = err?.message ?? err?.root?.message;

  const commit = (next: ComponentFormValue[]) => {
    form.setValue("components", next, { shouldDirty: true });
    if (next.length && form.getFieldState("components").error) form.clearErrors("components");
  };
  const add = (o: ComponentOption) => {
    if (added.has(o.id)) commit(components.map((c) => (c.productId === o.id ? { ...c, quantity: (c.quantity ?? 0) + 1 } : c)));
    else commit([...components, { productId: o.id, sku: o.sku, name: o.name, imageUrl: o.imageUrl, quantity: 1 }]);
  };

  return (
    <div className="flex flex-col gap-4" data-field="components">
      <div>
        <h3 className="text-[14px] font-semibold text-foreground">Search and add component</h3>
        <p className="text-[12px] text-secondary">Find the products that make up the kit. Only this client&apos;s active products and kit-to-stock kits are listed.</p>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const first = results[0];
              if (first) add(first);
            }
          }}
          disabled={!clientId}
          placeholder={clientId ? "Search by SKU, name or barcode" : "Select a client on the General step first"}
          aria-label="Search components"
          className="h-9 w-full rounded-md border border-border-strong/70 bg-surface pl-8 pr-3 text-[13px] placeholder:text-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:bg-surface-sunken"
        />
      </div>
      {clientId ? (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-border ks-scroll" aria-label="Search results">
          {search.isPending ? (
            <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-secondary"><Spinner className="h-3.5 w-3.5" label="Searching" />Searching…</div>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-[12px] text-faint">No data found{term ? ` for “${term}”` : ""}.</p>
          ) : (
            <ul className="divide-y divide-border">
              {results.map((o) => (
                <li key={o.id} className="flex items-center gap-3 px-3 py-2 hover:bg-surface-sunken">
                  <Thumb url={o.imageUrl} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate text-[13px] font-semibold text-foreground">
                      {o.sku}
                      {o.category === "Kit" ? <Badge tone="info" size="sm">Kit to stock</Badge> : null}
                    </span>
                    <span className="block truncate text-[12px] text-secondary">{o.name}</span>
                  </span>
                  <span className="w-20 text-right text-[12px]">
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.04em] text-faint">Available</span>
                    <span className={o.available > 0 ? "font-semibold tabular-nums text-success" : "font-semibold tabular-nums text-faint"}>{o.available}</span>
                  </span>
                  <Button size="sm" variant={added.has(o.id) ? "secondary" : "primary"} onClick={() => add(o)} aria-label={`Add ${o.sku}`}>
                    <Plus className="h-3.5 w-3.5" aria-hidden />{added.has(o.id) ? "Add 1 more" : "Add"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-[13px]">
          <thead className="bg-surface-sunken text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
            <tr><th className="w-12 px-3 py-2">Image</th><th className="px-3 py-2">Item</th><th className="w-36 px-3 py-2">Quantity</th><th className="w-12 px-3 py-2"><span className="sr-only">Remove</span></th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {components.map((c, i) => (
              <tr key={c.productId}>
                <td className="px-3 py-2"><Thumb url={c.imageUrl} /></td>
                <td className="px-3 py-2"><span className="block font-semibold text-foreground">{c.sku}</span><span className="block text-[12px] text-secondary">{c.name}</span></td>
                <td className="px-3 py-2">
                  <NumberInput size="sm" min={1} aria-label={`Quantity of ${c.sku}`} value={c.quantity} invalid={!c.quantity || c.quantity < 1}
                    onChange={(v) => commit(components.map((x, j) => (j === i ? { ...x, quantity: v } : x)))} />
                </td>
                <td className="px-3 py-2">
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${c.sku}`} onClick={() => commit(components.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5 text-danger" aria-hidden /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {components.length === 0 ? (
          <EmptyState compact icon={PackageSearch} title="No components yet" description="A kit needs at least one component. Search above and click Add." />
        ) : (
          <p className="border-t border-border bg-surface-sunken px-3 py-2 text-[12px] text-secondary">{components.length} component{components.length === 1 ? "" : "s"} · {components.reduce((s, c) => s + (c.quantity ?? 0), 0)} units per kit</p>
        )}
      </div>
      <FieldError id="components-error" message={message} />
    </div>
  );
}
