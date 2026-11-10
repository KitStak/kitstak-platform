/** M10 locations against an in-memory migrated DB: create/edit, rules, guarded delete, lock, generator, imports, export. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { EMPTY_GRID_QUERY, parseGridQuery } from "@/server/query/grid-query";
import { LOCATION_INFO_DEFAULTS, locationSaveSchema, type LocationSaveInput } from "@/lib/grid-defs/facility/locations";
import { expandPattern, expandRange, generatorCount, generatorSchema, rangeError } from "@/lib/grid-defs/facility/location-generator";
import { createLocation, deleteBlocker, deleteLocations, getLocation, listLocations, setLocationsLocked, updateLocation } from "@/server/repositories/locations";
import { planGenerator, runGeneratorNow } from "@/server/repositories/locations-generator";
import { applyLocationImport, applyLocationUpdateImport, applyProductCapacityImport, applyProductCapacityUpdateImport } from "@/server/repositories/locations-import";
import { locationsExport } from "@/server/repositories/locations-export";
import { createWorld, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
const actor = () => ({ userId: w.userId, source: "Web" });

beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
});
afterEach(() => w.close());

const save = (code: string, extra: Partial<LocationSaveInput["info"]> = {}, rest: Partial<LocationSaveInput> = {}) =>
  locationSaveSchema.parse({ info: { ...LOCATION_INFO_DEFAULTS, code, warehouseId: w.warehouseId, ...extra }, productCapacities: [], lpCapacities: [], ...rest });

const importCtx = () => ({ db: w.db, auth, actor: actor(), batchId: "b1", rowNumber: 1 });

describe("location schema", () => {
  it("requires a dedicated client for single-client locations and capacity above 0", () => {
    const r = locationSaveSchema.safeParse({ info: { ...LOCATION_INFO_DEFAULTS, code: "X", warehouseId: "w", singleClient: true, capacityType: "Maximum Unit Quantity", maxCapacityQty: 0 } });
    const paths = r.error?.issues.map((i) => i.path.join("."));
    expect(paths).toContain("info.dedicatedClientId");
    expect(paths).toContain("info.maxCapacityQty");
  });

  it("rejects a duplicate product + pack type capacity and max below min", () => {
    const cap = { clientId: "c", productId: "p", packType: "Each", minQty: 5, maxQty: 50 };
    const dup = locationSaveSchema.safeParse({ info: { ...LOCATION_INFO_DEFAULTS, code: "X", warehouseId: "w" }, productCapacities: [cap, cap] });
    expect(dup.error?.issues[0]?.message).toBe("This product and pack type already has a capacity");
    const bad = locationSaveSchema.safeParse({ info: { ...LOCATION_INFO_DEFAULTS, code: "X", warehouseId: "w" }, productCapacities: [{ ...cap, maxQty: 2 }] });
    expect(bad.error?.issues[0]?.message).toBe("Max qty must be at least the min qty");
  });
});

describe("location repository", () => {
  it("creates KS-E2E-LOC-01 with barcode = code, Only 1 SKU and a product capacity, and logs Create", () => {
    const input = save("KS-E2E-LOC-01", { locationType: "Shelves", areaType: "Picking", onlyOneSku: true }, {
      productCapacities: [{ clientId: w.clientId, productId: w.productId, packType: "Each", minQty: 5, maxQty: 50 }],
    });
    const { id } = createLocation(w.db, auth, actor(), input);
    const d = getLocation(w.db, auth, id);
    expect(d).toMatchObject({ code: "KS-E2E-LOC-01", barcode: "KS-E2E-LOC-01", onlyOneSku: true, areaType: "Picking", inventoryStatus: "Available" });
    expect(d.productCapacities).toEqual([expect.objectContaining({ sku: "MLT-WIDGET-01", minQty: 5, maxQty: 50, packType: "Each" })]);
    const log = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, id)).all();
    expect(log.map((c) => c.type)).toContain("Create");
  });

  it("rejects a duplicate code in the same warehouse", () => {
    createLocation(w.db, auth, actor(), save("KS-TEST-DUP"));
    expect(() => createLocation(w.db, auth, actor(), save("ks-test-dup"))).toThrow(/already exists/i);
  });

  it("edits with optimistic concurrency and writes field-level change log", () => {
    const { id } = createLocation(w.db, auth, actor(), save("KS-TEST-EDIT"));
    const v1 = getLocation(w.db, auth, id).version;
    updateLocation(w.db, auth, actor(), id, save("KS-TEST-EDIT", { aisle: "C" }, { version: v1 }));
    expect(getLocation(w.db, auth, id).aisle).toBe("C");
    expect(() => updateLocation(w.db, auth, actor(), id, save("KS-TEST-EDIT", { aisle: "D" }, { version: v1 }))).toThrow(/changed/i);
    const fields = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, id)).all().filter((c) => c.type === "Update");
    expect(fields.length).toBeGreaterThan(0);
  });

  it("blocks delete when the location holds inventory; deletes an empty one", () => {
    w.db.insert(schema.inventory).values({ productId: w.productId, clientId: w.clientId, warehouseId: w.warehouseId, locationId: w.loc.storageA, onHand: 4, receivedAt: new Date().toISOString() }).run();
    expect(deleteBlocker(w.db, w.loc.storageA)).toMatch(/holds 4 units/);
    const { id } = createLocation(w.db, auth, actor(), save("KS-TEST-DEL"));
    const result = deleteLocations(w.db, auth, actor(), [w.loc.storageA, id]);
    expect(result.succeeded).toEqual([id]);
    expect(result.failed[0]).toMatchObject({ id: w.loc.storageA, code: "INVALID_STATE" });
  });

  it("locks and unlocks, rejecting a no-op", () => {
    const { id } = createLocation(w.db, auth, actor(), save("KS-TEST-LOCK"));
    expect(setLocationsLocked(w.db, auth, actor(), [id], true).succeeded).toEqual([id]);
    expect(setLocationsLocked(w.db, auth, actor(), [id], true).failed[0]?.message).toMatch(/already locked/);
    expect(setLocationsLocked(w.db, auth, actor(), [id], false).succeeded).toEqual([id]);
  });

  it("lists with grid filters and hides out-of-scope warehouses", () => {
    createLocation(w.db, auth, actor(), save("KS-TEST-ZZ-01", { areaType: "Receiving" }));
    const q = parseGridQuery(new URLSearchParams("q=KS-TEST-ZZ&qm=sw")).query;
    expect(listLocations(w.db, auth, q).rows.map((r) => r.code)).toEqual(["KS-TEST-ZZ-01"]);
    const noScope = { ...auth, scope: { warehouseIds: [], clientIds: "all" }, viewScope: { warehouseIds: [], clientIds: "all" } } as unknown as AuthContext;
    expect(listLocations(w.db, noScope, EMPTY_GRID_QUERY).total).toBe(0);
  });

  it("exports the same rows as the list", () => {
    const page = locationsExport.fetchPage({ db: w.db, auth, gridKey: "locations", query: EMPTY_GRID_QUERY, rawQuery: "" }, 1, 100);
    expect("rows" in page && page.total).toBe(listLocations(w.db, auth, EMPTY_GRID_QUERY).total);
  });
});

describe("bulk location generator", () => {
  const spec = () => generatorSchema.parse({
    warehouseId: w.warehouseId, zone: "KS", separator: "-", aisles: { from: "A", to: "B" }, racks: { from: "01", to: "03" },
    levels: { from: "1", to: "2" }, positions: { from: "", to: "" }, locationType: "Shelves", areaType: "Storage",
  });

  it("expands ranges and validates them", () => {
    expect(expandRange({ from: "A", to: "C" })).toEqual(["A", "B", "C"]);
    expect(expandRange({ from: "1", to: "10" })[0]).toBe("01");
    expect(rangeError({ from: "C", to: "A" }, "Aisle", true)).toMatch(/low to high/);
    expect(rangeError({ from: "", to: "" }, "Aisle", true)).toMatch(/required/);
    expect(generatorCount(spec())).toBe(12);
    expect(expandPattern(spec())[0]?.code).toBe("KS-A-01-1");
  });

  it("creates 12 locations; a second run reports 12 collisions and creates 0", () => {
    const first = runGeneratorNow(w.db, auth, actor(), spec(), planGenerator(w.db, auth, spec(), false));
    expect(first.created).toBe(12);
    const plan = planGenerator(w.db, auth, spec(), false);
    expect(plan.collisions).toHaveLength(12);
    expect(plan.rows).toHaveLength(0);
    expect(runGeneratorNow(w.db, auth, actor(), spec(), plan).created).toBe(0);
  });
});

describe("location imports", () => {
  it("bulk import creates, a repeat is rejected, bulk update overlays non-empty cells", () => {
    const r = applyLocationImport(importCtx(), { warehouseCode: "MLT1", code: "KS-TEST-IMP-01", locationType: "Shelves", areaType: "Picking" });
    expect(r.message).toMatch(/Created location KS-TEST-IMP-01/);
    expect(() => applyLocationImport(importCtx(), { warehouseCode: "MLT1", code: "KS-TEST-IMP-01" })).toThrow(/already exists/);
    applyLocationUpdateImport(importCtx(), { warehouseCode: "MLT1", code: "KS-TEST-IMP-01", aisle: "Q" });
    expect(getLocation(w.db, auth, r.entityId ?? "").aisle).toBe("Q");
    expect(() => applyLocationImport(importCtx(), { warehouseCode: "NOPE", code: "X" })).toThrow();
  });

  it("product capacity import adds then update changes; wrong mode is rejected", () => {
    const row = { warehouseCode: "MLT1", locationCode: "A-01-01", clientCode: "ACME", sku: "MLT-WIDGET-01", minQty: 2, maxQty: 20 };
    applyProductCapacityImport(importCtx(), row);
    expect(() => applyProductCapacityImport(importCtx(), row)).toThrow(/already has a capacity/);
    applyProductCapacityUpdateImport(importCtx(), { ...row, maxQty: 40 });
    expect(getLocation(w.db, auth, w.loc.storageA).productCapacities[0]).toMatchObject({ minQty: 2, maxQty: 40 });
    expect(() => applyProductCapacityUpdateImport(importCtx(), { ...row, sku: "MLT-GADGET-02" })).toThrow(/no capacity/);
  });
});
