"use client";

/** "Link to product" modal: searches the listing client's products by SKU / name / barcode. */
import * as React from "react";
import { Link2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useApiQuery } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { ProductThumb, type ListingRow, type ProductListRow } from "./catalog-shared";

const DEBOUNCE_MS = 250;

export interface ListingLinkModalProps {
  readonly listing: ListingRow;
  readonly onOpenChange: (open: boolean) => void;
  readonly onLink: (productId: string) => Promise<void>;
}

export function ListingLinkModal({ listing, onOpenChange, onLink }: ListingLinkModalProps) {
  const [text, setText] = React.useState(listing.sellerSku);
  const [term, setTerm] = React.useState(listing.sellerSku);
  const [picked, setPicked] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);
  const query = { "f.clientId": `in:${listing.clientId}`, ps: 100, sort: "sku", ...(term ? { q: term, qm: "sw" } : {}) };
  const res = useApiQuery<ProductListRow[]>(["listing-link-search", listing.clientId, term], "/api/products", { query });
  const rows = res.data?.data ?? [];

  const submit = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      await onLink(picked);
      onOpenChange(false);
    } catch {
      // The caller already showed the error toast; keep the modal open to retry.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader title="Link to product" description={`Pick the ${listing.clientName} product that ${listing.storeName} sells as ${listing.sellerSku}. Inventory for the product is pushed to this listing.`} />
        <DialogBody className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" aria-hidden />
            <input
              type="search"
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Search by SKU, name or barcode (starts with)"
              aria-label="Search products"
              className="h-9 w-full rounded-md border border-border-strong/70 bg-surface pl-8 pr-3 text-[13px] placeholder:text-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
          </div>
          <div className="max-h-72 overflow-y-auto rounded-md border border-border ks-scroll" role="listbox" aria-label="Products">
            {res.isPending ? (
              <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-secondary"><Spinner className="h-3.5 w-3.5" label="Searching" />Searching…</div>
            ) : rows.length === 0 ? (
              <p className="px-3 py-4 text-center text-[12px] text-faint">No {listing.clientName} product matches “{term}”. Clear the search or create the product from the listing.</p>
            ) : (
              <ul className="divide-y divide-border">
                {rows.map((r) => (
                  <li key={r.id}>
                    <button type="button" role="option" aria-selected={picked === r.id} onClick={() => setPicked(r.id)} onDoubleClick={() => { setPicked(r.id); }}
                      className={cn("flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30", picked === r.id && "bg-primary-soft/60")}>
                      <ProductThumb url={r.imageUrl} size={30} label={r.name} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[13px] font-semibold text-foreground">{r.sku}</span>
                        <span className="block truncate text-[12px] text-secondary">{r.name}</span>
                      </span>
                      <span className="text-[11px] text-faint">{r.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!picked || busy} title={picked ? undefined : "Select a product"}>
            <Link2 className="h-3.5 w-3.5" aria-hidden />Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
