/**
 * Export providers for the M09 grids (wired by `src/server/exports/providers/{products,
 * product-listings}.ts`). They read the same repository queries as the list endpoints,
 * so "Export As Excel" matches the filtered grid exactly.
 */
import type { ExportProvider, ExportRow } from "@/server/exports/types";
import { LISTING_EXPORT_COLUMNS, LISTING_LINK_STATES, type ListingLinkState } from "@/lib/grid-defs/products/listings-grid";
import { PRODUCT_EXPORT_COLUMNS } from "@/lib/grid-defs/products/products-grid";
import { listListings } from "./listings";
import { listProducts } from "./products";

export const productsExport: ExportProvider = {
  columns: [...PRODUCT_EXPORT_COLUMNS, { key: "barcodes", label: "All barcodes" }],
  fetchPage(ctx, page, pageSize) {
    const { rows, total } = listProducts(ctx.db, ctx.auth.viewScope, { ...ctx.query, page, pageSize });
    const out: readonly ExportRow[] = rows.map((r) => ({ ...r }));
    return { rows: out, total };
  },
};

/** `link=linked|unlinked` from the raw query, when the grid sent it. */
export function linkStateOf(rawQuery: string): ListingLinkState | undefined {
  const value = new URLSearchParams(rawQuery).get("link");
  return (LISTING_LINK_STATES as readonly string[]).includes(value ?? "") ? (value as ListingLinkState) : undefined;
}

export const listingsExport: ExportProvider = {
  columns: [...LISTING_EXPORT_COLUMNS, { key: "linked", label: "Linked", type: "boolean" }],
  fetchPage(ctx, page, pageSize) {
    const { rows, total } = listListings(ctx.db, ctx.auth.viewScope, { ...ctx.query, page, pageSize }, linkStateOf(ctx.rawQuery));
    const out: readonly ExportRow[] = rows.map((r) => ({ ...r, tags: undefined, linked: r.productId !== null }));
    return { rows: out, total };
  },
};
