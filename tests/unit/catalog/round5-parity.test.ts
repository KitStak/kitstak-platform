/** M09 catalog, critic round 4 → round 5: hierarchical pack weight derivation and data-gap flags. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import type { Scope } from "@/server/auth/scope";
import { convertVolume, convertWeight, hasMissingWeight } from "@/lib/grid-defs/products/catalog-options";
import {
  derivedPackWeight, fillDerivedPackWeights, minimumPackVolume, packDataGaps, rederiveDependentWeights, type DerivablePack,
} from "@/lib/grid-defs/products/pack-derivation";
import { emptyProductForm, newPackType, type ProductInput } from "@/lib/grid-defs/products/product-form";
import { createProductFromWizard } from "@/server/repositories/products-commands";
import { planTestDataPurge, purgeTestCatalogData } from "@/server/repositories/products-test-data";
import { createWorld, type World } from "../foundation/domain/fixtures";

const unit: DerivablePack = { key: "u", kind: "Primary", packType: "Unit", weight: 1.2, weightUnit: "Pound", length: 4, width: 3, height: 2, dimensionUnit: "Inch", volumeUnit: "Cubic Inch", volume: 24 };
const kase: DerivablePack = { key: "c", kind: "Hierarchical", packType: "Case", parentKey: "u", childQty: 12, weight: null, weightUnit: "Pound", length: 0, width: 0, height: 0, dimensionUnit: "Inch", volumeUnit: "Cubic Inch", volume: 0 };
const pallet: DerivablePack = { key: "p", kind: "Hierarchical", packType: "Pallet", parentKey: "c", childQty: 40, weight: 0, weightUnit: "Kilogram", volumeUnit: "Cubic Foot" };

describe("unit conversions", () => {
  it("converts weights and volumes through a common base", () => {
    expect(convertWeight(16, "Ounce", "Pound")).toBe(1);
    expect(convertWeight(1, "Kilogram", "Gram")).toBeCloseTo(1000, 0);
    expect(convertVolume(1728, "Cubic Inch", "Cubic Foot")).toBe(1);
  });
  it("treats missing or 0 weight as missing", () => {
    expect(hasMissingWeight({ weight: null })).toBe(true);
    expect(hasMissingWeight({ weight: 0 })).toBe(true);
    expect(hasMissingWeight({ weight: 0.01 })).toBe(false);
  });
});

describe("derivedPackWeight", () => {
  it("is child qty × contained pack weight (Case of 12 × 1.2 lb = 14.4 lb)", () => {
    expect(derivedPackWeight(kase, [unit])).toBe(14.4);
    expect(derivedPackWeight(kase, [unit, kase])).toBe(14.4);
  });
  it("resolves chains through un-weighed parents and converts units", () => {
    // 40 × 14.4 lb = 576 lb ≈ 261.27 kg
    expect(derivedPackWeight(pallet, [unit, kase, pallet])).toBeCloseTo(261.27, 1);
  });
  it("falls back to the primary when the parent key is missing", () => {
    expect(derivedPackWeight({ ...kase, parentKey: null }, [unit])).toBe(14.4);
  });
  it("is null for primary/irregular packs and when the child has no weight", () => {
    expect(derivedPackWeight(unit, [unit])).toBeNull();
    expect(derivedPackWeight({ ...kase, kind: "Irregular" }, [unit])).toBeNull();
    expect(derivedPackWeight(kase, [{ ...unit, weight: 0 }])).toBeNull();
  });
});

describe("fillDerivedPackWeights / rederiveDependentWeights", () => {
  it("fills only missing hierarchical weights, parents first", () => {
    const out = fillDerivedPackWeights([pallet, kase, unit]);
    expect(out.find((p) => p.key === "c")?.weight).toBe(14.4);
    expect(out.find((p) => p.key === "p")?.weight).toBeCloseTo(261.27, 1);
    expect(fillDerivedPackWeights([unit, { ...kase, weight: 15 }])[1]?.weight).toBe(15);
  });
  it("updates calculated weights when the child changes, keeps typed ones", () => {
    const before = [unit, { ...kase, weight: 14.4 }];
    const after = rederiveDependentWeights(before, [{ ...unit, weight: 2 }, { ...kase, weight: 14.4 }]);
    expect(after[1]?.weight).toBe(24);
    const typed = [unit, { ...kase, weight: 15 }];
    expect(rederiveDependentWeights(typed, [{ ...unit, weight: 2 }, { ...kase, weight: 15 }])[1]?.weight).toBe(15);
  });
});

describe("minimumPackVolume / packDataGaps", () => {
  it("gives a lower-bound volume for a case from its contents", () => {
    expect(minimumPackVolume(kase, [unit])).toBe(288);
    expect(minimumPackVolume(unit, [unit])).toBeNull();
  });
  it("flags missing dimensions and weight", () => {
    expect(packDataGaps(kase)).toEqual(["dimensions", "weight"]);
    expect(packDataGaps(unit)).toEqual([]);
  });
});

describe("server save derives hierarchical weight", () => {
  let w: World;
  let scope: Scope;
  beforeEach(async () => {
    w = await createWorld();
    scope = { warehouseIds: [w.warehouseId], clientIds: "all" };
  });
  afterEach(() => w.close());

  it("stores Case weight = 12 × Unit weight when saved without one", async () => {
    const u = { ...newPackType("Primary", []), key: "u", packType: "Each", length: 4, width: 3, height: 2, weight: 1.2, barcodes: [] };
    const c = { ...newPackType("Hierarchical", [u]), key: "c", packType: "Case", parentKey: "u", childQty: 12, weight: null, barcodes: [] };
    const row = await createProductFromWizard(w.db, { ...w.ctx, scope }, {
      ...emptyProductForm("Product", w.clientId), sku: "R5-HIER", name: "R5 hier", packTypes: [u, c],
    } as unknown as ProductInput);
    const packs = await w.db.select().from(schema.productPackTypes).where(eq(schema.productPackTypes.productId, row.id));
    const caseRow = packs.find((p) => p.packType === "Case");
    expect(caseRow?.uomQty).toBe(12);
    expect(caseRow?.weight).toBe(14.4);
  });
});

describe("test-data purge options", () => {
  let w: World;
  beforeEach(async () => { w = await createWorld(); });
  afterEach(() => w.close());
  const ctx = () => ({ ...w.ctx, scope: { warehouseIds: [w.warehouseId], clientIds: "all" as const } });
  const make = async (sku: string) => await createProductFromWizard(w.db, ctx(), {
    ...emptyProductForm("Product", w.clientId), sku, name: sku,
    packTypes: [{ ...newPackType("Primary", []), key: "u", packType: "Each", length: 1, width: 1, height: 1, barcodes: [] }],
  } as unknown as ProductInput);

  it("skips records created after createdBefore and never deactivates with deleteOnly", async () => {
    const old = await make("KS-CRIT-OLD");
    const stocked = await make("KS-CRIT-STOCK");
    const fresh = await make("KS-CRIT-FRESH");
    await w.db.update(schema.products).set({ createdAt: "2026-01-01T00:00:00.000Z" }).where(eq(schema.products.id, old.id));
    await w.db.update(schema.products).set({ createdAt: "2026-01-01T00:00:00.000Z" }).where(eq(schema.products.id, stocked.id));
    await w.db.update(schema.products).set({ createdAt: "2026-06-01T00:00:00.000Z" }).where(eq(schema.products.id, fresh.id));
    await w.db.insert(schema.inventory).values({ warehouseId: w.warehouseId, locationId: w.loc.storageA, clientId: w.clientId, productId: stocked.id, onHand: 2, receivedAt: "2026-01-01" });
    const cutoff = { createdBefore: "2026-03-01T00:00:00.000Z" };
    expect((await planTestDataPurge(w.db, undefined, cutoff)).deletable.map((r) => r.sku)).toEqual(["KS-CRIT-OLD"]);
    const plan = await purgeTestCatalogData(w.db, ctx(), undefined, { ...cutoff, deleteOnly: true });
    expect(plan.deactivate).toEqual([]);
    expect((await w.db.select().from(schema.products).where(eq(schema.products.id, old.id)).limit(1))[0]).toBeUndefined();
    expect((await w.db.select().from(schema.products).where(eq(schema.products.id, stocked.id)).limit(1))[0]?.status).toBe("Active");
    expect((await w.db.select().from(schema.products).where(eq(schema.products.id, fresh.id)).limit(1))[0]?.status).toBe("Active");
  });
});
