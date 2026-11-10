/** M09 catalog: derived product listing exceptions (Missing product / SKU difference / Multi listing). */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { Scope } from "@/server/auth/scope";
import { EMPTY_GRID_QUERY, type GridQuery } from "@/server/query/grid-query";
import { linkListing, listListingExceptions, listListings } from "@/server/repositories/listings";
import { LISTING_GRID_FIELDS } from "@/lib/grid-defs/products/listings-grid";
import { createWorld, type World } from "../foundation/domain/fixtures";

let w: World;
let scope: Scope;

beforeEach(() => {
  w = createWorld();
  scope = { warehouseIds: [w.warehouseId], clientIds: "all" };
});
afterEach(() => w.close());

const ctx = () => ({ ...w.ctx, scope });
const q = (extra: Partial<GridQuery> = {}): GridQuery => ({ ...EMPTY_GRID_QUERY, pageSize: 100, ...extra });

function seed(sellerSku: string, channelProductId: string, channelId?: string) {
  const conn = channelId ?? w.db.insert(schema.channelConnections).values({ provider: "shopify", storeName: "Acme Shop", clientId: w.clientId, settings: {} as never }).returning().get().id;
  const id = w.db.insert(schema.productListings).values({ channelConnectionId: conn, clientId: w.clientId, sellerSku, channelProductId, name: sellerSku }).returning().get().id;
  return { id, conn };
}

describe("listing exceptions", () => {
  it("flags an unlinked listing and clears it once linked to the matching SKU", () => {
    const { id } = seed("MLT-WIDGET-01", "gid-1");
    const before = listListingExceptions(w.db, scope);
    expect(before.counts).toEqual({ unlinked: 1, sku_difference: 0, multi_listing: 0 });
    expect(before.rows[0]).toMatchObject({ id, exception: "unlinked", exceptionLabel: "Missing product" });

    linkListing(w.db, ctx(), id, w.productId);
    const after = listListingExceptions(w.db, scope);
    expect(after.rows).toEqual([]);
    expect(listListings(w.db, scope, q(), "linked").rows[0]).toMatchObject({ sellerSku: "MLT-WIDGET-01", exception: null, exceptionLabel: null });
  });

  it("reports a SKU difference when the seller SKU differs from the linked product", () => {
    const { id } = seed("SHOP-WIDGET", "gid-2");
    linkListing(w.db, ctx(), id, w.productId);
    const { rows, counts } = listListingExceptions(w.db, scope, "sku_difference");
    expect(counts.sku_difference).toBe(1);
    expect(rows.map((r) => [r.sellerSku, r.exception, r.productSku])).toEqual([["SHOP-WIDGET", "sku_difference", "MLT-WIDGET-01"]]);
  });

  it("reports multi listing when two listings of one store link the same product", () => {
    const a = seed("mlt-widget-01", "gid-a");
    const b = seed("MLT-WIDGET-01", "gid-b", a.conn);
    linkListing(w.db, ctx(), a.id, w.productId);
    linkListing(w.db, ctx(), b.id, w.productId);
    expect(listListingExceptions(w.db, scope).counts).toEqual({ unlinked: 0, sku_difference: 0, multi_listing: 2 });
  });

  it("filters the grid by exception through the Exception filter", () => {
    seed("MLT-WIDGET-01", "gid-1");
    const linked = seed("OTHER", "gid-2");
    linkListing(w.db, ctx(), linked.id, w.productId);
    const filtered = listListings(w.db, scope, q({ filters: [{ field: "exception", op: "in", values: ["sku_difference"] }] } as Partial<GridQuery>), undefined);
    expect(filtered.rows.map((r) => r.sellerSku)).toEqual(["OTHER"]);
    expect(LISTING_GRID_FIELDS.find((f) => f.field === "exception")?.options?.map((o) => o.value)).toEqual(["unlinked", "sku_difference", "multi_listing"]);
  });

  it("respects client scope", () => {
    seed("MLT-WIDGET-01", "gid-1");
    expect(listListingExceptions(w.db, { warehouseIds: [w.warehouseId], clientIds: [w.otherClientId] }).rows).toEqual([]);
  });
});
