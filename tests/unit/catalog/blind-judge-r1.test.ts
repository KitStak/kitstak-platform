/**
 * M09 catalog, blind-judge repair round 1: pack hierarchy model for the in-place pack type
 * editor, pack add / remove helpers, the listing image fallback and the Suggested-listing demo
 * fixture (idempotent, reset, change-logged).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import type { Scope } from "@/server/auth/scope";
import { EMPTY_GRID_QUERY } from "@/server/query/grid-query";
import { dismissSuggestion, linkListing, listListings } from "@/server/repositories/listings";
import { DEMO_LISTING_STORE, DEMO_SUGGESTED_LISTINGS, ensureDemoSuggestedListings } from "@/server/repositories/listings-demo";
import { newPackType, type PackTypeFormValue } from "@/lib/grid-defs/products/product-form";
import { hierarchyFromView, packHierarchy, type HierarchyNode } from "@/components/products/product-pack-types-editor";
import { packsAfterRemove, packsAfterSave } from "@/components/products/wizard/step-pack-types";
import { listingImage } from "@/components/products/listings-page";
import { createWorld, type World } from "../foundation/domain/fixtures";

const node = (key: string, packType: string, kind: HierarchyNode["kind"], parentKey: string | null, childQty: number | null, uomQty: number): HierarchyNode => ({ key, packType, kind, parentKey, childQty, uomQty });

describe("pack hierarchy", () => {
  it("orders primary, then each hierarchical pack under the pack it contains, and lists irregulars apart", () => {
    const { tree, irregular } = packHierarchy([
      node("p", "Pallet", "Hierarchical", "c", 40, 480),
      node("e", "Each", "Primary", null, null, 1),
      node("i", "3-Pack", "Irregular", null, null, 3),
      node("c", "Case", "Hierarchical", "e", 12, 12),
    ]);
    expect(tree.map((l) => [l.node.packType, l.depth, l.made])).toEqual([["Each", 0, null], ["Case", 1, "12 × Each"], ["Pallet", 2, "40 × Case"]]);
    expect(irregular.map((n) => n.packType)).toEqual(["3-Pack"]);
  });

  it("hangs a hierarchical pack without a known parent under the primary", () => {
    const { tree } = packHierarchy([node("e", "Each", "Primary", null, null, 1), node("c", "Case", "Hierarchical", "gone", 6, 6)]);
    expect(tree.map((l) => l.made)).toEqual([null, "6 × Each"]);
  });

  it("maps the detail payload (parent by name) to nodes", () => {
    const view = [
      { id: "1", packType: "Each", kind: "Primary", parentPackType: null, childQty: null, uomQty: 1 },
      { id: "2", packType: "Case", kind: "Hierarchical", parentPackType: "Each", childQty: 12, uomQty: 12 },
    ] as unknown as Parameters<typeof hierarchyFromView>[0];
    expect(hierarchyFromView(view).map((n) => [n.key, n.parentKey])).toEqual([["1", null], ["2", "1"]]);
  });
});

describe("pack add / remove", () => {
  const primary = { ...newPackType("Primary", []), key: "e", packType: "Each", weight: 1 } as PackTypeFormValue;
  it("derives UOM qty when a hierarchical pack is added and re-parents children when one is removed", () => {
    const caseP = { ...newPackType("Hierarchical", [primary]), key: "c", packType: "Case", childQty: 12 } as PackTypeFormValue;
    const withCase = packsAfterSave([primary], caseP);
    const pallet = { ...newPackType("Hierarchical", withCase), key: "p", packType: "Pallet", childQty: 40 } as PackTypeFormValue;
    const all = packsAfterSave(withCase, pallet);
    expect(all.map((p) => [p.packType, p.uomQty, p.parentKey ?? null])).toEqual([["Each", 1, null], ["Case", 12, "e"], ["Pallet", 480, "c"]]);
    const removed = packsAfterRemove(all, all[1] as PackTypeFormValue);
    expect(removed.map((p) => [p.packType, p.uomQty, p.parentKey ?? null])).toEqual([["Each", 1, null], ["Pallet", 40, "e"]]);
  });
});

describe("listing image fallback", () => {
  const base = { imageUrl: null, productImageUrl: null, suggestedProductImageUrl: null, productSku: "SKU-1", suggestedProductSku: "SKU-2" };
  it("prefers the channel image, then the linked product, then the suggested product", () => {
    expect(listingImage({ ...base, imageUrl: "a", productImageUrl: "b" })).toEqual({ url: "a", source: "Channel image" });
    expect(listingImage({ ...base, productImageUrl: "b", suggestedProductImageUrl: "c" })).toEqual({ url: "b", source: "Image of linked product SKU-1" });
    expect(listingImage({ ...base, suggestedProductImageUrl: "c" })).toEqual({ url: "c", source: "Image of suggested product SKU-2" });
    expect(listingImage(base).url).toBeNull();
  });
});

describe("Suggested listing demo fixture", () => {
  let w: World;
  let scope: Scope;
  beforeEach(async () => {
    w = await createWorld();
    scope = { warehouseIds: [w.warehouseId], clientIds: "all" };
    await w.db.insert(schema.channelConnections).values({ provider: "shopify", storeName: DEMO_LISTING_STORE, clientId: w.clientId, settings: {} as never });
    for (const sku of ["BLB-HOOD-BLK-M", "BLB-HOOD-GRY-L", "BLB-CAP-OS-BLK", "BLB-CAP-OS-KHK"]) {
      await w.db.insert(schema.products).values({ clientId: w.clientId, sku, barcode: sku, name: sku, category: "Apparel", weightOz: 8, lengthIn: 4, widthIn: 4, heightIn: 2, price: 10, status: "Active" });
    }
  });
  afterEach(() => w.close());

  const unlinked = async () => (await listListings(w.db, scope, { ...EMPTY_GRID_QUERY, pageSize: 100 }, "unlinked")).rows;

  it("inserts four Suggested listings and one No match, once, with change log", async () => {
    const first = await ensureDemoSuggestedListings(w.db, w.ctx);
    expect(first.created).toHaveLength(DEMO_SUGGESTED_LISTINGS.length);
    const rows = await unlinked();
    expect(rows.filter((r) => r.suggestedProductId).map((r) => r.suggestedProductSku).sort()).toEqual(["BLB-CAP-OS-BLK", "BLB-CAP-OS-KHK", "BLB-HOOD-BLK-M", "BLB-HOOD-GRY-L"]);
    expect(rows.filter((r) => !r.suggestedProductId).map((r) => r.sellerSku)).toEqual(["BLB-TOTE-NAT"]);
    const again = await ensureDemoSuggestedListings(w.db, w.ctx);
    expect(again.created).toHaveLength(0);
    expect(again.skipped).toHaveLength(DEMO_SUGGESTED_LISTINGS.length);
    const logged = (await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityType, "listing"))).filter((c) => c.type === "Create");
    expect(logged).toHaveLength(DEMO_SUGGESTED_LISTINGS.length);
  });

  it("reset returns matched and dismissed demo listings to Suggested", async () => {
    await ensureDemoSuggestedListings(w.db, w.ctx);
    const rows = await unlinked();
    const a = rows.find((r) => r.sellerSku === "BLB-HOOD-BLK-M");
    const b = rows.find((r) => r.sellerSku === "BLB-HOOD-GRY-L");
    if (!a?.suggestedProductId || !b) throw new Error("demo rows missing");
    await linkListing(w.db, { ...w.ctx, scope }, a.id, a.suggestedProductId, a.version);
    await dismissSuggestion(w.db, { ...w.ctx, scope }, b.id);
    expect((await unlinked()).filter((r) => r.suggestedProductId)).toHaveLength(2);
    const res = await ensureDemoSuggestedListings(w.db, w.ctx, { reset: true });
    expect([...res.reset].sort()).toEqual(["BLB-HOOD-BLK-M", "BLB-HOOD-GRY-L"]);
    expect((await unlinked()).filter((r) => r.suggestedProductId)).toHaveLength(4);
  });

  it("does nothing when the demo store does not exist", async () => {
    await w.db.update(schema.channelConnections).set({ storeName: "Other" });
    expect((await ensureDemoSuggestedListings(w.db, w.ctx)).created).toHaveLength(0);
  });
});
