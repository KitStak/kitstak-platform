/** M09 catalog, critic round 3 (parity loop): search-mode persistence, concurrency, volume format, pack-type checks. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "@/server/auth/context";
import { expectedVersion, parseIfMatch } from "@/lib/grid-defs/products/concurrency";
import { formatVolume, hasIncompleteDimensions } from "@/lib/grid-defs/products/catalog-options";
import { IMAGE_URL_MESSAGE, emptyProductForm, imageUrlError, newPackType, type ProductInput } from "@/lib/grid-defs/products/product-form";
import { initialSearchMode, isSearchMode, withRawSearchMode } from "@/components/products/grid-state";
import { shipmentPackageOptions } from "@/server/repositories/products-options";
import { createProductFromWizard } from "@/server/repositories/products-commands";
import { getProductDetail } from "@/server/repositories/products-detail";
import { createWorld, type World } from "../foundation/domain/fixtures";

describe("quick-search mode persistence", () => {
  it("prefers a raw URL qm, then the stored mode, then Starts With", () => {
    expect(initialSearchMode("eq", null)).toBe("eq");
    expect(initialSearchMode(null, "eq")).toBe("eq");
    expect(initialSearchMode("bogus", "sw")).toBe("sw");
    expect(initialSearchMode(null, null)).toBe("sw");
    expect(isSearchMode("eq")).toBe(true);
    expect(isSearchMode("ct")).toBe(false);
  });
  it("writes Equal raw into the URL (search box empty) and drops the default", () => {
    expect(withRawSearchMode("?f.status=in:Active", "eq")).toBe("f.status=in%3AActive&qm=eq");
    expect(withRawSearchMode("qm=eq&page=2", "sw")).toBe("page=2");
  });
});

describe("optimistic concurrency (PATCH / status)", () => {
  it("takes the body version first, then If-Match", () => {
    expect(expectedVersion(3, null)).toBe(3);
    expect(expectedVersion(undefined, "\"4\"")).toBe(4);
    expect(expectedVersion(undefined, "W/\"5\"")).toBe(5);
    expect(expectedVersion(2, "9")).toBe(2);
  });
  it("returns null when the caller sent no usable version", () => {
    expect(expectedVersion(undefined, null)).toBeNull();
    expect(expectedVersion("3", undefined)).toBeNull();
    expect(expectedVersion(0, "")).toBeNull();
    expect(parseIfMatch("*")).toBeNull();
    expect(parseIfMatch("abc")).toBeNull();
  });
});

describe("pack-type presentation", () => {
  it("formats volume the same everywhere (3 decimals, tiny values kept)", () => {
    expect(formatVolume(480)).toBe("480.000");
    expect(formatVolume(480.00001)).toBe("480.000");
    expect(formatVolume(0)).toBe("0.000");
    expect(formatVolume(null)).toBe("0.000");
    expect(formatVolume(0.00042)).toBe("0.00042");
  });
  it("flags a pack with any zero / missing dimension as incomplete", () => {
    expect(hasIncompleteDimensions({ length: 12, width: 0, height: 0 })).toBe(true);
    expect(hasIncompleteDimensions({ length: 12, width: 8, height: null })).toBe(true);
    expect(hasIncompleteDimensions({ length: 12, width: 8, height: 6 })).toBe(false);
  });
  it("labels repeated shipping-box codes with their warehouse", () => {
    const opts = shipmentPackageOptions([
      { id: "1", code: "BOX-L-1612", description: "Large", l: 16, w: 12, h: 10, warehouse: "KS2" },
      { id: "2", code: "BOX-L-1612", description: "Large", l: 16, w: 12, h: 10, warehouse: "MLT1" },
      { id: "3", code: "BOX-CF-0909", description: null, l: 9, w: 9, h: 4, warehouse: "MLT1" },
    ]);
    expect(opts.map((o) => o.label)).toEqual(["BOX-L-1612 · KS2", "BOX-L-1612 · MLT1", "BOX-CF-0909"]);
    expect(opts[2]?.description).toBe("9×9×4");
  });
});

describe("General step blur validation", () => {
  it("uses the same image-URL message as Next", () => {
    expect(imageUrlError("ftp://bad")).toBe(IMAGE_URL_MESSAGE);
    expect(imageUrlError("not a url")).toBe(IMAGE_URL_MESSAGE);
    expect(imageUrlError("https://cdn.example.com/a.png")).toBeNull();
    expect(imageUrlError("  ")).toBeNull();
  });
});

describe("kit barcode is not silently set to the SKU", () => {
  let w: World;
  let auth: AuthContext;
  beforeEach(async () => {
    w = await createWorld();
    const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
    auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
  });
  afterEach(() => w.close());

  it("stores an empty barcode for a kit saved without one", async () => {
    const comp = await createProductFromWizard(w.db, { ...w.ctx, scope: auth.scope }, {
      ...emptyProductForm("Product", w.clientId), sku: "R3-COMP", name: "comp",
      packTypes: [{ ...newPackType("Primary", []), key: "u", packType: "Unit", length: 1, width: 1, height: 1, barcodes: [] }],
    } as unknown as ProductInput);
    const kit = await createProductFromWizard(w.db, { ...w.ctx, scope: auth.scope }, {
      ...emptyProductForm("Kit", w.clientId), sku: "R3-KIT", name: "kit", barcode: "", kitType: "Kit to Order",
      components: [{ productId: comp.id, sku: "R3-COMP", name: "comp", imageUrl: null, quantity: 2 }],
    } as unknown as ProductInput);
    const detail = await getProductDetail(w.db, auth.scope, auth.viewScope, kit.id);
    expect(detail?.product.barcode).toBe("");
    expect(detail?.product.sku).toBe("R3-KIT");
  });
});
