/**
 * M09 catalog: Link Product drawer parity (live Logiwa capture §6): "Create New" quick product
 * (created through the wizard path, linked + Never Sync in one transaction) and
 * "Don't match these products" (audited suggestion dismissal).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import type { Scope } from "@/server/auth/scope";
import { EMPTY_GRID_QUERY, type GridQuery } from "@/server/query/grid-query";
import { createQuickProductForListing, dismissSuggestion, linkListing, listListings, unlinkListing } from "@/server/repositories/listings";
import { listingQuickProductSchema, quickProductDefaults, quickProductToInput } from "@/lib/grid-defs/products/listing-quick-product";
import { productInputSchema } from "@/lib/grid-defs/products/product-form";
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

function seed(sellerSku: string, channelProductId: string, extra: Partial<typeof schema.productListings.$inferInsert> = {}) {
  const conn = w.db.insert(schema.channelConnections).values({ provider: "shopify", storeName: "Acme Shop", clientId: w.clientId, settings: {} as never }).returning().get().id;
  return w.db.insert(schema.productListings).values({ channelConnectionId: conn, clientId: w.clientId, sellerSku, channelProductId, name: `${sellerSku} listing`, ...extra }).returning().get();
}

const row = (id: string) => listListings(w.db, scope, q(), undefined).rows.find((r) => r.id === id);

describe("quick product model", () => {
  it("prefills from the listing and maps to a valid wizard payload with one primary pack", () => {
    const d = quickProductDefaults({ sellerSku: "AB 12", name: "Shirt", description: null, imageUrl: "https://x.test/a.png", storePrice: 19.5, neverSync: true });
    expect(d).toMatchObject({ sku: "AB12", name: "Shirt", salesPrice: 19.5, neverSync: true, uom: "Unit" });
    const parsed = listingQuickProductSchema.parse({ ...d, weight: 2, barcode: "0123" });
    const input = quickProductToInput("client-1", parsed);
    const full = productInputSchema.parse(input);
    expect(full.packTypes).toHaveLength(1);
    expect(full.packTypes[0]).toMatchObject({ kind: "Primary", packType: "Unit", weight: 2, barcodes: ["0123"] });
    expect(full).toMatchObject({ productCategory: "Product", clientId: "client-1", sku: "AB12", salesPrice: 19.5, imageUrl: "https://x.test/a.png" });
  });

  it("rejects blank SKU / name and SKUs with spaces", () => {
    const r = listingQuickProductSchema.safeParse({ sku: "A B", name: " " });
    expect(r.success).toBe(false);
    const paths = r.success ? [] : r.error.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["sku", "name"]));
  });
});

describe("create new from listing", () => {
  it("creates the product, links the listing and applies Never Sync atomically with change log", () => {
    const l = seed("NEW-SKU-1", "gid-1", { storePrice: 12 });
    const res = createQuickProductForListing(w.db, ctx(), l.id, { sku: "NEW-SKU-1", name: "New one", weight: 1.5, isFragile: true, neverSync: true, barcode: "999000" });
    const product = w.db.select().from(schema.products).where(eq(schema.products.id, res.productId)).get();
    expect(product).toMatchObject({ sku: "NEW-SKU-1", clientId: w.clientId, isFragile: true, status: "Active", barcode: "999000" });
    expect(w.db.select().from(schema.productPackTypes).where(eq(schema.productPackTypes.productId, res.productId)).all()).toHaveLength(1);
    expect(row(l.id)).toMatchObject({ productId: res.productId, neverSync: true, productSku: "NEW-SKU-1", exception: null });
    const logs = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, l.id)).all().map((c) => c.field);
    expect(logs).toEqual(expect.arrayContaining(["linkedProduct", "neverSync"]));
    expect(w.db.select().from(schema.changeLog).where(and(eq(schema.changeLog.entityId, res.productId), eq(schema.changeLog.type, "Create"))).all()).toHaveLength(1);
  });

  it("flags a duplicate SKU on the sku field and leaves the listing unlinked", () => {
    const l = seed("MLT-WIDGET-01", "gid-dup");
    expect(() => createQuickProductForListing(w.db, ctx(), l.id, { sku: "mlt-widget-01", name: "Dup" })).toThrow(/already exists/);
    expect(row(l.id)?.productId).toBeNull();
  });

  it("refuses an already-linked listing and a stale version", () => {
    const l = seed("X-1", "gid-x");
    expect(() => createQuickProductForListing(w.db, ctx(), l.id, { sku: "X-1", name: "X" }, l.version + 5)).toThrow();
    linkListing(w.db, ctx(), l.id, w.productId);
    expect(() => createQuickProductForListing(w.db, ctx(), l.id, { sku: "X-2", name: "X" })).toThrow(/already linked/);
  });

  it("hides listings of other clients (scope)", () => {
    const l = seed("Y-1", "gid-y");
    const outside = { ...w.ctx, scope: { warehouseIds: [w.warehouseId], clientIds: [w.otherClientId] } as Scope };
    expect(() => createQuickProductForListing(w.db, outside, l.id, { sku: "Y-1", name: "Y" })).toThrow();
  });
});

describe("don't match these products", () => {
  it("hides the suggestion (No match), is audited, and linking that product withdraws it", () => {
    const l = seed("mlt-widget-01", "gid-s");
    expect(row(l.id)).toMatchObject({ suggestedProductSku: "MLT-WIDGET-01" });
    const res = dismissSuggestion(w.db, ctx(), l.id);
    expect(res.dismissedSku).toBe("MLT-WIDGET-01");
    expect(row(l.id)).toMatchObject({ suggestedProductId: null, suggestedProductSku: null });
    const log = w.db.select().from(schema.changeLog).where(and(eq(schema.changeLog.entityId, l.id), eq(schema.changeLog.field, "dismissedSuggestion"))).all();
    expect(log.map((c) => c.toValue)).toEqual(["MLT-WIDGET-01"]);
    expect(() => dismissSuggestion(w.db, ctx(), l.id)).toThrow(/no suggested product/);

    linkListing(w.db, ctx(), l.id, w.productId);
    unlinkListing(w.db, ctx(), l.id);
    expect(row(l.id)).toMatchObject({ suggestedProductSku: "MLT-WIDGET-01" });
  });

  it("refuses a listing without a suggestion", () => {
    const l = seed("NOPE", "gid-n");
    expect(() => dismissSuggestion(w.db, ctx(), l.id)).toThrow(/no suggested product/);
  });
});
