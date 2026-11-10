/** M09 round 3: pre-existing duplicate barcodes are flagged; link-search works without clientId. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import type { Scope } from "@/server/auth/scope";
import { EMPTY_GRID_QUERY } from "@/server/query/grid-query";
import { listProducts } from "@/server/repositories/products";
import { getProductDetail } from "@/server/repositories/products-detail";
import { searchLinkProducts } from "@/server/repositories/products-options";
import { productInitials } from "@/components/products/catalog-shared";
import { createWorld, type World } from "../foundation/domain/fixtures";

let w: World;
let scope: Scope;
beforeEach(() => {
  w = createWorld();
  scope = { warehouseIds: [w.warehouseId], clientIds: "all" };
});
afterEach(() => w.close());

const setBarcode = (id: string, barcode: string) => w.db.update(schema.products).set({ barcode }).where(eq(schema.products.id, id)).run();

describe("barcode conflicts", () => {
  it("flags both products of the same client sharing a primary barcode", () => {
    setBarcode(w.productId, "850012300011");
    setBarcode(w.product2Id, "850012300011");
    const rows = listProducts(w.db, scope, { ...EMPTY_GRID_QUERY, pageSize: 100 }).rows;
    expect(rows.find((r) => r.id === w.productId)?.barcodeConflictCount).toBe(1);
    expect(rows.find((r) => r.id === w.product2Id)?.barcodeConflictCount).toBe(1);
    const detail = getProductDetail(w.db, scope, scope, w.productId);
    expect(detail?.barcodeConflicts.map((c) => c.id)).toEqual([w.product2Id]);
  });

  it("does not flag unique barcodes", () => {
    setBarcode(w.productId, "111");
    setBarcode(w.product2Id, "222");
    const rows = listProducts(w.db, scope, { ...EMPTY_GRID_QUERY, pageSize: 100 }).rows;
    expect(rows.every((r) => r.barcodeConflictCount === 0)).toBe(true);
    expect(getProductDetail(w.db, scope, scope, w.productId)?.barcodeConflicts).toEqual([]);
  });
});

describe("link-search without clientId", () => {
  it("searches every client in scope", () => {
    const res = searchLinkProducts(w.db, scope, { q: "MLT-WIDGET" });
    expect(res.some((r) => r.id === w.productId)).toBe(true);
  });
  it("respects a restricted client scope", () => {
    const res = searchLinkProducts(w.db, { warehouseIds: [w.warehouseId], clientIds: [w.otherClientId] }, { q: "MLT-WIDGET" });
    expect(res.some((r) => r.id === w.productId)).toBe(false);
  });
});

describe("productInitials", () => {
  it("takes two leading word initials", () => {
    expect(productInitials("Blue Widget Large")).toBe("BW");
    expect(productInitials("mlt-widget")).toBe("MW");
    expect(productInitials("  ")).toBe("");
  });
});
