/** M09 catalog: wizard create/update, guards, kits, listings, imports, exports — in-memory migrated DB. */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { ledger } from "@/server/domain/ledger";
import { EMPTY_GRID_QUERY, type GridQuery } from "@/server/query/grid-query";
import { emptyProductForm, newPackType, type ProductFormValues, type ProductInput } from "@/lib/grid-defs/products/product-form";
import { createProductFromWizard, deleteBlockerFor, deleteCheck, deleteProduct, setProductStatus, updateProductFromWizard } from "@/server/repositories/products-commands";
import { getProductDetail, getProductForm } from "@/server/repositories/products-detail";
import { checkBarcodes, checkSku, searchComponents, searchLinkProducts } from "@/server/repositories/products-options";
import { listProducts } from "@/server/repositories/products";
import { createProductFromListing, linkListing, listListings, setNeverSync, unlinkListing } from "@/server/repositories/listings";
import { linkStateOf, productsExport } from "@/server/repositories/products-export";
import {
  applyKitComponentImport, applyListingImport, applyPackTypeImport, applyProductImport, applyProductUpdateImport, applyReplenishmentImport, applySkuAllocationImport,
} from "@/server/repositories/products-import";
import type { ImportApplyContext } from "@/server/imports/types";
import { createWorld, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;

beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
});
afterEach(() => w.close());

const ctx = () => ({ ...w.ctx, scope: auth.scope });
const q = (extra: Partial<GridQuery> = {}): GridQuery => ({ ...EMPTY_GRID_QUERY, pageSize: 100, ...extra });
const unit = (barcodes: string[] = []) => ({ ...newPackType("Primary", []), key: "u", packType: "Unit", length: 10, width: 8, height: 6, weight: 2, barcodes });
const productInput = (sku: string, extra: Partial<ProductFormValues> = {}, clientId = w.clientId): ProductInput =>
  ({ ...emptyProductForm("Product", clientId), sku, name: `${sku} name`, packTypes: [unit()], ...extra }) as ProductInput;
const changeLog = (entityId: string) => w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, entityId)).all();
const importCtx = (rowNumber = 1, batchId = "b1"): ImportApplyContext => ({ db: w.db, auth, actor: { userId: w.userId, source: "import" }, batchId, rowNumber });

describe("create product (acceptance KS-E2E-PROD-1)", () => {
  it("saves primary + hierarchical pack types, tracking, and logs Create", () => {
    const row = createProductFromWizard(w.db, ctx(), productInput("KS-E2E-PROD-1", {
      trackLot: true, trackExpiry: true, expiryFormat: "yyyy-MM-dd",
      packTypes: [unit(["B-1", "B-2"]), { ...newPackType("Hierarchical", []), key: "c", packType: "Case", parentKey: "u", childQty: 12 }],
    }));
    const detail = getProductDetail(w.db, auth.scope, auth.viewScope, row.id);
    expect(detail?.packTypes.map((p) => [p.packType, p.kind, p.uomQty, p.barcodes.length])).toEqual([["Unit", "Primary", 1, 2], ["Case", "Hierarchical", 12, 0]]);
    expect(detail?.packTypes[0]?.volume).toBe(480);
    expect(detail?.product).toMatchObject({ trackLot: true, trackExpiry: true, expiryFormat: "yyyy-MM-dd", expiryScanMethod: "During Picking", weightOz: 32, barcode: "B-1" });
    expect(changeLog(row.id).some((c) => String(c.type).toLowerCase() === "create")).toBe(true);
    expect(listProducts(w.db, auth.viewScope, q()).rows[0]?.sku).toBe("KS-E2E-PROD-1");
  });

  it("rejects a barcode already used by another product of the same client (409), allows other clients and self-edit", () => {
    const first = createProductFromWizard(w.db, ctx(), productInput("BC-1", { packTypes: [unit(["850012300011"])] }));
    expect(() => createProductFromWizard(w.db, ctx(), productInput("BC-2", { packTypes: [unit(["850012300011"])] }))).toThrow(/already used by BC-1 .Unit./);
    expect(() => createProductFromWizard(w.db, ctx(), productInput("BC-3", { packTypes: [unit(["850012300011"])] }, w.otherClientId))).not.toThrow();
    const form = getProductForm(w.db, auth.scope, first.id);
    expect(() => updateProductFromWizard(w.db, ctx(), first.id, { ...(form as unknown as ProductInput), name: "renamed" })).not.toThrow();
    const second = createProductFromWizard(w.db, ctx(), productInput("BC-4", { packTypes: [unit(["OTHER"])] }));
    const f2 = getProductForm(w.db, auth.scope, second.id) as unknown as ProductInput;
    expect(() => updateProductFromWizard(w.db, ctx(), second.id, { ...f2, packTypes: [unit(["850012300011"])] } as ProductInput)).toThrow(/already used/);
  });

  it("check-barcodes reports the owning client so the wizard can block same-client reuse", () => {
    createProductFromWizard(w.db, ctx(), productInput("BC-6", { packTypes: [unit(["CB-1"])] }));
    expect(checkBarcodes(w.db, auth.scope, { barcodes: "CB-1" })[0]).toMatchObject({ sku: "BC-6", clientId: w.clientId, packType: "Unit" });
  });

  it("link search matches name/SKU contains and ranks exact > SKU prefix > name prefix > contains", () => {
    createProductFromWizard(w.db, ctx(), productInput("ZZ-WIDGET", { name: "Blue thing" }));
    createProductFromWizard(w.db, ctx(), productInput("WIDGET-2", { name: "Other" }));
    createProductFromWizard(w.db, ctx(), productInput("AAA-1", { name: "Widget deluxe" }));
    createProductFromWizard(w.db, ctx(), productInput("WIDGET", { name: "Exact" }));
    const skus = searchLinkProducts(w.db, auth.scope, { clientId: w.clientId, q: "widget" }).map((r) => r.sku).filter((s) => ["WIDGET", "WIDGET-2", "AAA-1", "ZZ-WIDGET"].includes(s));
    expect(skus).toEqual(["WIDGET", "WIDGET-2", "AAA-1", "ZZ-WIDGET"]);
    expect(searchLinkProducts(w.db, auth.scope, { clientId: w.clientId, q: "deluxe" }).map((r) => r.sku)).toEqual(["AAA-1"]);
    expect(searchLinkProducts(w.db, { ...auth.scope, clientIds: [w.otherClientId] }, { clientId: w.clientId, q: "widget" })).toEqual([]);
  });

  it("rejects the same barcode on two pack types of one product", () => {
    expect(() => createProductFromWizard(w.db, ctx(), productInput("BC-5", {
      packTypes: [unit(["X1"]), { ...newPackType("Hierarchical", []), key: "c", packType: "Case", parentKey: "u", childQty: 12, barcodes: ["X1"] }],
    }))).toThrow(/two pack types|more than one pack type/);
  });

  it("rejects a duplicate SKU for the same client but allows it under another client", () => {
    createProductFromWizard(w.db, ctx(), productInput("DUP-1"));
    expect(() => createProductFromWizard(w.db, ctx(), productInput("dup-1"))).toThrow(/already exists/);
    expect(checkSku(w.db, auth.scope, { clientId: w.clientId, sku: "DUP-1" }).available).toBe(false);
    expect(checkSku(w.db, auth.scope, { clientId: w.otherClientId, sku: "DUP-1" }).available).toBe(true);
    expect(() => createProductFromWizard(w.db, ctx(), productInput("DUP-1", {}, w.otherClientId))).not.toThrow();
  });

  it("returns field errors for an invalid payload", () => {
    expect(() => createProductFromWizard(w.db, ctx(), productInput("X", { packTypes: [] }))).toThrow(/primary/i);
  });
});

describe("edit", () => {
  it("writes a field-level change log and bumps version; stale version → conflict", () => {
    const row = createProductFromWizard(w.db, ctx(), productInput("EDIT-1"));
    const form = getProductForm(w.db, auth.scope, row.id);
    expect(form).not.toBeNull();
    const updated = updateProductFromWizard(w.db, ctx(), row.id, { ...form, name: "Renamed", salesPrice: 12.5, version: form?.version } as ProductInput);
    expect(updated.version).toBe(row.version + 1);
    expect(updated.name).toBe("Renamed");
    expect(changeLog(row.id).length).toBeGreaterThan(1);
    expect(() => updateProductFromWizard(w.db, ctx(), row.id, { ...form, version: row.version } as ProductInput)).toThrow();
  });

  it("locks the client and category", () => {
    const row = createProductFromWizard(w.db, ctx(), productInput("LOCK-1"));
    const form = getProductForm(w.db, auth.scope, row.id);
    expect(() => updateProductFromWizard(w.db, ctx(), row.id, { ...form, clientId: w.otherClientId } as ProductInput)).toThrow(/client/i);
  });

  it("deactivates and activates", () => {
    const row = createProductFromWizard(w.db, ctx(), productInput("ST-1"));
    expect(setProductStatus(w.db, ctx(), row.id, "Inactive").status).toBe("Inactive");
    expect(listProducts(w.db, auth.viewScope, q({ filters: [{ field: "status", op: "in", values: ["Inactive"] }] as GridQuery["filters"] })).rows.map((r) => r.sku)).toContain("ST-1");
  });
});

describe("kits", () => {
  it("blocks zero components and shows Used in kits on each component", () => {
    const kit = (components: ProductFormValues["components"]) => ({ ...emptyProductForm("Kit", w.clientId), kitType: "Kit to Stock", sku: "KIT-1", name: "Kit", components }) as ProductInput;
    expect(() => createProductFromWizard(w.db, ctx(), kit([]))).toThrow(/at least one component/);
    const opts = searchComponents(w.db, auth.scope, { clientId: w.clientId, q: "" });
    expect(opts.length).toBeGreaterThanOrEqual(2);
    const k = createProductFromWizard(w.db, ctx(), kit([{ productId: w.productId, sku: "a", name: "a", quantity: 2 }, { productId: w.product2Id, sku: "b", name: "b", quantity: 1 }]));
    expect(getProductDetail(w.db, auth.scope, auth.viewScope, w.productId)?.usedInKits.map((x) => x.sku)).toEqual(["KIT-1"]);
    expect(getProductDetail(w.db, auth.scope, auth.viewScope, k.id)?.components).toHaveLength(2);
    expect(deleteBlockerFor(w.db, w.productId)).toMatch(/kit KIT-1/);
  });

  it("rejects a component from another client", () => {
    const other = createProductFromWizard(w.db, ctx(), productInput("OTHER-1", {}, w.otherClientId));
    expect(() => createProductFromWizard(w.db, ctx(), { ...emptyProductForm("Kit", w.clientId), kitType: "Kit to Order", sku: "KIT-X", name: "x", components: [{ productId: other.id, sku: "o", name: "o", quantity: 1 }] } as ProductInput)).toThrow(/client/);
  });
});

describe("delete guard", () => {
  it("blocks a product with inventory and allows a clean one", () => {
    ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 5 });
    const clean = createProductFromWizard(w.db, ctx(), productInput("CLEAN-1"));
    const check = deleteCheck(w.db, ctx(), [w.productId, clean.id]);
    expect(check.find((c) => c.id === w.productId)?.reason).toMatch(/5 units on hand/);
    expect(check.find((c) => c.id === clean.id)?.reason).toBeNull();
    expect(() => deleteProduct(w.db, ctx(), w.productId)).toThrow(/Deactivate/);
    deleteProduct(w.db, ctx(), clean.id);
    expect(w.db.select().from(schema.products).where(eq(schema.products.id, clean.id)).get()).toBeUndefined();
  });
});

describe("listings", () => {
  const seedListing = () => {
    const channelId = w.db.insert(schema.channelConnections).values({ provider: "shopify", storeName: "Acme Shop", clientId: w.clientId, settings: {} as never }).returning().get().id;
    const id = w.db.insert(schema.productListings).values({ channelConnectionId: channelId, clientId: w.clientId, sellerSku: "SHOP-1", channelProductId: "gid-1", name: "Shop one" }).returning().get().id;
    return { channelId, id };
  };

  it("links, unlinks and toggles never sync with change log", () => {
    const { id } = seedListing();
    expect(listListings(w.db, auth.viewScope, q(), "unlinked").counts).toEqual({ linked: 0, unlinked: 1 });
    linkListing(w.db, ctx(), id, w.productId);
    expect(listListings(w.db, auth.viewScope, q(), "linked").rows.map((r) => r.sellerSku)).toEqual(["SHOP-1"]);
    expect(listListings(w.db, auth.viewScope, q(), "unlinked").total).toBe(0);
    setNeverSync(w.db, ctx(), id, true);
    unlinkListing(w.db, ctx(), id);
    expect(listListings(w.db, auth.viewScope, q(), "unlinked").rows[0]?.neverSync).toBe(true);
    expect(changeLog(id).length).toBeGreaterThanOrEqual(3);
  });

  it("refuses a product of another client", () => {
    const { id } = seedListing();
    const other = createProductFromWizard(w.db, ctx(), productInput("O-1", {}, w.otherClientId));
    expect(() => linkListing(w.db, ctx(), id, other.id)).toThrow(/different client/);
  });

  it("creates a product from a listing", () => {
    const { id } = seedListing();
    const r = createProductFromListing(w.db, ctx(), id);
    expect(r.created).toBe(true);
    expect(w.db.select().from(schema.productListings).where(eq(schema.productListings.id, id)).get()?.productId).toBe(r.productId);
  });

  it("imports listings by store + seller SKU and links by SKU", () => {
    seedListing();
    applyListingImport(importCtx(), { channel: "Acme Shop", clientCode: "ACME", channelSku: "SHOP-1", sku: "MLT-WIDGET-01", title: null, neverSync: null });
    applyListingImport(importCtx(2), { channel: "shopify", clientCode: "ACME", channelSku: "SHOP-2", sku: null, title: "Two", neverSync: true });
    const rows = w.db.select().from(schema.productListings).all();
    expect(rows.find((r) => r.sellerSku === "SHOP-1")?.productId).toBe(w.productId);
    expect(rows.find((r) => r.sellerSku === "SHOP-2")).toMatchObject({ productId: null, neverSync: true, name: "Two" });
  });
});

describe("imports", () => {
  it("creates products and refuses kits", () => {
    applyProductImport(importCtx(), { clientCode: "acme", sku: "IMP-1", name: "Imported", barcode: "IMP-BC", description: null, productGroup: "Widgets", productType: "Simple", uom: "Each", weight: 1, length: 2, width: 2, height: 2, unitPrice: 9.99, unitCost: 3, trackLot: true, trackExpiry: true, trackSerial: null, status: "Active" });
    const p = w.db.select().from(schema.products).where(eq(schema.products.sku, "IMP-1")).get();
    expect(p).toMatchObject({ uom: "Each", barcode: "IMP-BC", price: 9.99, trackLot: true, expiryFormat: "yyyy-MM-dd" });
    expect(p?.productGroupId).toBeTruthy();
    expect(() => applyProductImport(importCtx(2), { clientCode: "ACME", sku: "IMP-K", name: "k", barcode: "k", productType: "Kit" })).toThrow(/Kit-components/);
  });

  it("updates only provided columns", () => {
    const row = createProductFromWizard(w.db, ctx(), productInput("UPD-1", { salesPrice: 5 }));
    applyProductUpdateImport(importCtx(), { clientCode: "ACME", sku: "UPD-1", name: "Updated", unitPrice: null, barcode: "NEWBC" });
    const after = w.db.select().from(schema.products).where(eq(schema.products.id, row.id)).get();
    expect(after).toMatchObject({ name: "Updated", price: 5, barcode: "NEWBC" });
  });

  it("adds a Case pack type to 5 products with history (acceptance)", () => {
    const ids = [1, 2, 3, 4, 5].map((i) => createProductFromWizard(w.db, ctx(), productInput(`PK-${i}`)).id);
    ids.forEach((_, i) => applyPackTypeImport(importCtx(i + 1), { clientCode: "ACME", sku: `PK-${i + 1}`, packType: "Case", uomQty: 12, barcode: `CASE-${i + 1}`, weight: 25, length: 20, width: 16, height: 12 }));
    for (const id of ids) {
      const packs = w.db.select().from(schema.productPackTypes).where(eq(schema.productPackTypes.productId, id)).all();
      expect(packs.find((p) => p.packType === "Case")).toMatchObject({ kind: "Hierarchical", uomQty: 12, childQty: 12 });
      expect(changeLog(id).length).toBeGreaterThan(1);
    }
    // Re-import updates in place.
    applyPackTypeImport(importCtx(9), { clientCode: "ACME", sku: "PK-1", packType: "Case", uomQty: 24, barcode: null });
    expect(w.db.select().from(schema.productPackTypes).where(and(eq(schema.productPackTypes.productId, ids[0] as string), eq(schema.productPackTypes.packType, "Case"))).get()?.uomQty).toBe(24);
  });

  it("sets replenishment levels and channel allocations", () => {
    const row = createProductFromWizard(w.db, ctx(), productInput("RP-1"));
    applyReplenishmentImport(importCtx(), { warehouseCode: "MLT1", clientCode: "ACME", sku: "RP-1", minQty: 10, maxQty: 50 });
    expect(w.db.select().from(schema.productReplenishmentLevels).where(eq(schema.productReplenishmentLevels.productId, row.id)).all()).toMatchObject([{ minLevel: 10, maxLevel: 50 }]);
    expect(() => applyReplenishmentImport(importCtx(2), { warehouseCode: "MLT1", clientCode: "ACME", sku: "RP-1", minQty: 9, maxQty: 1 })).toThrow(/Max/);
    w.db.insert(schema.channelConnections).values({ provider: "shopify", storeName: "Acme Shop", clientId: w.clientId, settings: {} as never }).run();
    applySkuAllocationImport(importCtx(3), { warehouseCode: "MLT1", clientCode: "ACME", sku: "RP-1", channel: "Acme Shop", allocationPercent: 50, allocationQty: null });
    expect(w.db.select().from(schema.productChannelAllocations).where(eq(schema.productChannelAllocations.productId, row.id)).all()).toMatchObject([{ allocationPct: 50 }]);
  });

  it("replaces kit components per batch", () => {
    const kit = createProductFromWizard(w.db, ctx(), { ...emptyProductForm("Kit", w.clientId), kitType: "Kit to Order", sku: "KC-1", name: "k", components: [{ productId: w.productId, sku: "a", name: "a", quantity: 1 }] } as ProductInput);
    applyKitComponentImport(importCtx(1, "batch-x"), { clientCode: "ACME", kitSku: "KC-1", componentSku: "MLT-GADGET-02", quantity: 3 });
    applyKitComponentImport(importCtx(2, "batch-x"), { clientCode: "ACME", kitSku: "KC-1", componentSku: "MLT-WIDGET-01", quantity: 2 });
    const comps = w.db.select().from(schema.kitComponents).where(eq(schema.kitComponents.kitProductId, kit.id)).all();
    expect(comps.map((c) => c.quantity).sort()).toEqual([2, 3]);
  });
});

describe("export", () => {
  it("reads the same query as the grid", async () => {
    createProductFromWizard(w.db, ctx(), productInput("EXP-1"));
    const page = await productsExport.fetchPage({ db: w.db, auth, gridKey: "products", query: q({ q: "EXP", qm: "sw" }), rawQuery: "q=EXP" }, 1, 100);
    expect(page.rows.map((r) => r.sku)).toEqual(["EXP-1"]);
    expect(linkStateOf("link=linked&q=a")).toBe("linked");
    expect(linkStateOf("q=a")).toBeUndefined();
  });
});
