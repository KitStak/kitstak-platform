"use client";

/**
 * "KitStaks product" cell of Product Listings (live Logiwa capture §6, LOGIWA PRODUCT cell):
 * thumbnail, link-state pill (No match / Suggested / Linked), product SKU + name and the
 * in-cell icon actions with tooltips:
 *   - No match:  Create a product · Search a product
 *   - Suggested: Info · Don't match these products · Match these products (+ Search)
 *   - Linked:    Info · Change product · Unlink
 * The row kebab keeps every action too, so keyboard users get the same set from one place.
 */
import * as React from "react";
import Link from "next/link";
import { Check, ExternalLink, Info, Link2, PackagePlus, Search, Unlink, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ProductThumb, type ListingRow } from "./catalog-shared";

export type ListingCellState = "linked" | "suggested" | "none";

export function listingCellState(row: Pick<ListingRow, "productId" | "suggestedProductId">): ListingCellState {
  if (row.productId) return "linked";
  return row.suggestedProductId ? "suggested" : "none";
}

const PILL: Readonly<Record<ListingCellState, { label: string; className: string }>> = {
  linked: { label: "Linked", className: "bg-success text-white" },
  suggested: { label: "Suggested", className: "bg-warning text-white" },
  none: { label: "No match", className: "bg-neutral text-white" },
};

export interface ListingCellActions {
  readonly onSearch?: (row: ListingRow) => void;
  readonly onCreate?: (row: ListingRow) => void;
  readonly onMatch?: (row: ListingRow) => void;
  readonly onReject?: (row: ListingRow) => void;
  readonly onUnlink?: (row: ListingRow) => void;
}

/**
 * `label` is the tooltip (Logiwa wording); `name` overrides the accessible name where two
 * tooltips nest ("Match these products" sits inside "Don't match these products").
 */
function CellIcon({ label, name, icon: Icon, onClick, tone = "default" }: { readonly label: string; readonly name?: string; readonly icon: React.ComponentType<{ className?: string }>; readonly onClick: () => void; readonly tone?: "default" | "success" | "danger" }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={name ?? label}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        onKeyDown={(e) => e.stopPropagation()}
        className={cn(
          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
          tone === "success" && "text-success hover:bg-success-soft",
          tone === "danger" && "text-danger hover:bg-danger-soft",
          tone === "default" && "text-secondary hover:bg-neutral-soft hover:text-body",
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </button>
    </Tooltip>
  );
}

function InfoPopover({ row, state }: { readonly row: ListingRow; readonly state: ListingCellState }) {
  const linked = state === "linked";
  const id = linked ? row.productId : row.suggestedProductId;
  const sku = linked ? row.productSku : row.suggestedProductSku;
  const name = linked ? row.productName : row.suggestedProductName;
  const description = linked ? row.productDescription : row.suggestedProductDescription;
  const image = linked ? row.productImageUrl : row.suggestedProductImageUrl;
  if (!id) return null;
  return (
    <Popover>
      <Tooltip content="Info">
        <PopoverTrigger asChild>
          <button type="button" aria-label={`Product info for ${sku ?? ""}`} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-secondary transition-colors hover:bg-neutral-soft hover:text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35">
            <Info className="h-3.5 w-3.5" aria-hidden />
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="w-80 p-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-3 p-3">
          <ProductThumb url={image} size={48} label={name ?? sku ?? ""} />
          <div className="min-w-0 flex-1">
            <p className="text-2xs font-semibold text-faint">{linked ? "Linked product" : "Suggested product"}</p>
            <p className="truncate font-mono text-sm font-semibold text-foreground">{sku}</p>
            <p className="truncate text-xs text-secondary" title={name ?? undefined}>{name}</p>
          </div>
        </div>
        <dl className="grid grid-cols-[96px_1fr] gap-x-2 gap-y-1 border-t border-border px-3 py-2.5 text-xs">
          <dt className="text-faint">Client</dt><dd className="truncate text-body">{row.clientName}</dd>
          <dt className="text-faint">Seller SKU</dt><dd className="truncate font-mono text-body">{row.sellerSku}</dd>
          {linked ? (<><dt className="text-faint">Status</dt><dd className="text-body">{row.productStatus ?? "—"}</dd></>) : null}
          {linked && row.linkedAt ? (<><dt className="text-faint">Linked</dt><dd className="text-body">{new Date(row.linkedAt).toLocaleString()}</dd></>) : null}
          <dt className="text-faint">Description</dt><dd className="line-clamp-3 text-body">{description || "—"}</dd>
        </dl>
        {!linked ? (
          <p className="border-t border-border px-3 py-2 text-xs text-secondary">Suggested because the seller SKU matches this product&apos;s SKU.</p>
        ) : null}
        <div className="border-t border-border px-3 py-2">
          <Link href={`/products/${id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            Open product<ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const ActionsCtx = React.createContext<ListingCellActions>({});

/** Supplies the page's handlers to every cell (columns stay static; handlers change per render). */
export function ListingCellActionsProvider({ value, children }: { readonly value: ListingCellActions; readonly children: React.ReactNode }) {
  return <ActionsCtx.Provider value={value}>{children}</ActionsCtx.Provider>;
}

export function ListingProductCell({ row, actions: explicit }: { readonly row: ListingRow; readonly actions?: ListingCellActions }) {
  const fromCtx = React.useContext(ActionsCtx);
  const actions = explicit ?? fromCtx;
  const state = listingCellState(row);
  const pill = PILL[state];
  const sku = state === "linked" ? row.productSku : row.suggestedProductSku;
  const name = state === "linked" ? row.productName : row.suggestedProductName;
  const image = state === "linked" ? row.productImageUrl : row.suggestedProductImageUrl;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2" data-link-state={state}>
      {state === "none" ? (
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-dashed border-border-strong/70 text-faint" aria-hidden>
          <Link2 className="h-3 w-3" />
        </span>
      ) : <ProductThumb url={image} size={24} label={name ?? sku ?? ""} />}
      <span className={cn("shrink-0 rounded-full px-2 py-px text-2xs font-semibold leading-4", pill.className)}>{pill.label}</span>
      <span className="min-w-0 flex-1 truncate text-xs">
        {state === "none" ? (
          <span className="text-secondary" title="No match. Search or create a product to link">Search or create a product to link</span>
        ) : state === "linked" && row.productId ? (
          <Link href={`/products/${row.productId}`} onClick={(e) => e.stopPropagation()} className="font-mono font-semibold text-primary hover:underline" title={`${sku} — ${name ?? ""}`}>{sku}</Link>
        ) : (
          <span className="font-mono font-semibold text-body" title={`${sku} — ${name ?? ""}`}>{sku}</span>
        )}
        {state !== "none" && name ? <span className="ml-1.5 text-secondary">{name}</span> : null}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-0.5">
        {state === "none" ? (
          <>
            {actions.onCreate ? <CellIcon label="Create a product" icon={PackagePlus} onClick={() => actions.onCreate?.(row)} /> : null}
            {actions.onSearch ? <CellIcon label="Search a product" icon={Search} onClick={() => actions.onSearch?.(row)} /> : null}
          </>
        ) : state === "suggested" ? (
          <>
            <InfoPopover row={row} state={state} />
            {actions.onReject ? <CellIcon label="Don't match these products" name={`Reject suggestion ${sku ?? ""}`.trim()} icon={X} tone="danger" onClick={() => actions.onReject?.(row)} /> : null}
            {actions.onMatch ? <CellIcon label="Match these products" name={`Accept suggestion ${sku ?? ""}`.trim()} icon={Check} tone="success" onClick={() => actions.onMatch?.(row)} /> : null}
          </>
        ) : (
          <>
            <InfoPopover row={row} state={state} />
            {actions.onUnlink ? <CellIcon label="Unlink" name={`Unlink ${row.sellerSku}`} icon={Unlink} onClick={() => actions.onUnlink?.(row)} /> : null}
          </>
        )}
      </span>
    </span>
  );
}
