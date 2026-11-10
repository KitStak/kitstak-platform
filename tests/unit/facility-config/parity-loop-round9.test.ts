/**
 * Round 5 parity loop (critic R4, 7.8): generator limit + collision copy, code prefix is not a zone,
 * M10 change-log copy and per-line capacity audit, LP effective dimensions, detail helpers,
 * default-warehouse confirm copy and kit tagging in the product picker.
 */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { EMPTY_GRID_QUERY } from "@/server/query/grid-query";
import { LOCATION_INFO_DEFAULTS, locationSaveSchema, type LocationSaveInput } from "@/lib/grid-defs/facility/locations";
import { GENERATOR_MAX, generatorCollisionCopy, generatorCount, generatorLimitMessage, generatorSchema } from "@/lib/grid-defs/facility/location-generator";
import { capacityLineChanges, facilityEntityName, facilityFieldLabel, facilityUpdateMessage } from "@/lib/grid-defs/facility/change-log-copy";
import { capacityRulesSummary, cleanChangeMessage, positionTriple, tidyLegacyNames } from "@/lib/grid-defs/facility/common";
import { defaultSwitchImpact } from "@/lib/grid-defs/facility/warehouses";
import { maxWeightIssue } from "@/lib/grid-defs/facility/lp-types";
import { isKitItem } from "@/components/facility/pickers";
import { createLocation, getLocation, listLocations, updateLocation } from "@/server/repositories/locations";
import { planGenerator, runGeneratorNow } from "@/server/repositories/locations-generator";
import { getLpNumber, listLpNumbers } from "@/server/repositories/lp-numbers";
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

describe("generator limit and collision copy", () => {
  const huge = { zone: "", separator: "-" as const, aisles: { from: "A", to: "Z" }, racks: { from: "01", to: "99" }, levels: { from: "1", to: "9" }, positions: { from: "", to: "" } };

  it("A–Z × 01–99 × 1–9 is 23,166 and the message says what to do", () => {
    expect(generatorCount(huge)).toBe(23_166);
    expect(generatorLimitMessage(23_166)).toBe("23,166 locations exceeds the 5,000 limit; narrow a range");
    expect(generatorLimitMessage(GENERATOR_MAX)).toBeNull();
  });

  it("the schema puts the same message on Aisles", () => {
    const r = generatorSchema.safeParse({ ...huge, warehouseId: "w", locationType: "Shelves", areaType: "Storage" });
    const issue = r.error?.issues.find((i) => i.path.join(".") === "aisles.from");
    expect(issue?.message).toBe("23,166 locations exceeds the 5,000 limit; narrow a range");
  });

  it("re-running an existing range says nothing is left to create", () => {
    expect(generatorCollisionCopy(4, 4)).toEqual({ title: "All 4 codes already exist; nothing to create.", skipLabel: null });
    expect(generatorCollisionCopy(1, 1).title).toBe("This code already exists; nothing to create.");
    expect(generatorCollisionCopy(12, 3)).toEqual({ title: "3 codes already exist", skipLabel: "Skip existing codes and create the other 9" });
  });
});

describe("generator code prefix is not a location zone", () => {
  it("stores no zone for a prefix-only run, and the lookup name when a zone is picked", () => {
    const base = { warehouseId: w.warehouseId, zone: "KSCRITG", separator: "-", aisles: { from: "A", to: "A" }, racks: { from: "01", to: "02" }, levels: { from: "", to: "" }, positions: { from: "", to: "" }, locationType: "Shelves", areaType: "Storage" };
    const spec = generatorSchema.parse(base);
    expect(runGeneratorNow(w.db, auth, actor(), spec, planGenerator(w.db, auth, spec, false)).created).toBe(2);
    const row = w.db.select().from(schema.locations).where(eq(schema.locations.code, "KSCRITG-A-01")).get()!;
    expect(row.zone).toBe("");
    expect(row.locationZoneId).toBeNull();
    expect(getLocation(w.db, auth, row.id).locationZone).toBeNull();
    const listed = listLocations(w.db, auth, { ...EMPTY_GRID_QUERY, q: "KSCRITG" }).rows.find((r) => r.code === "KSCRITG-A-01");
    expect(listed?.locationZone ?? null).toBeNull();

    const zone = w.db.insert(schema.lookupValues).values({ type: "location_zone", name: "Bulk", warehouseId: w.warehouseId }).returning().get();
    const zoned = generatorSchema.parse({ ...base, zone: "KSZ", locationZoneId: zone.id });
    runGeneratorNow(w.db, auth, actor(), zoned, planGenerator(w.db, auth, zoned, false));
    const z = w.db.select().from(schema.locations).where(eq(schema.locations.code, "KSZ-A-01")).get()!;
    expect(z).toMatchObject({ zone: "Bulk", locationZoneId: zone.id });
    expect(getLocation(w.db, auth, z.id).locationZone).toBe("Bulk");
  });
});

describe("M10 change-log copy", () => {
  it("names entities and fields the way the UI does", () => {
    expect(facilityEntityName("lp_type", "KS-TOTE")).toBe("LP Type KS-TOTE");
    expect(facilityEntityName("shipment_package", "BOX-1")).toBe("Shipment Package BOX-1");
    expect(facilityEntityName("mobile_cart", null)).toBe("Mobile Cart");
    expect(facilityFieldLabel("isLocked")).toBe("Locked");
    expect(facilityFieldLabel("maxSkuQty")).toBe("Max SKU qty");
    expect(facilityFieldLabel("walkingPathPriority")).toBe("Walking path priority");
    expect(facilityFieldLabel("isSomethingNew")).toBe("Something new");
    expect(facilityFieldLabel("customFields.Bay color")).toBe("Bay color");
  });

  it("never stores a double space for an empty side", () => {
    expect(facilityUpdateMessage("Walking path priority", "", "77")).toBe("Walking path priority is modified. (blank) --> 77");
    expect(facilityUpdateMessage("Aisle", "B", " ")).toBe("Aisle is modified. B --> (blank)");
  });

  it("location create and edit write polished rows and one row per capacity line", () => {
    const cap = { clientId: w.clientId, productId: w.productId, packType: "Each", minQty: 10, maxQty: 50 };
    const { id } = createLocation(w.db, auth, actor(), save("KS-R9-CAP", {}, { productCapacities: [cap] }));
    const rows = () => w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, id)).all();
    expect(rows().map((r) => r.message)).toEqual(expect.arrayContaining(["Location KS-R9-CAP is created.", "MLT-WIDGET-01 -> Product capacity is created. Min 10, Max 50"]));

    const v = getLocation(w.db, auth, id).version;
    updateLocation(w.db, auth, actor(), id, save("KS-R9-CAP", { walkingPathPriority: 77, isLocked: true }, { version: v, productCapacities: [{ ...cap, maxQty: 60 }] }));
    const msgs = rows().map((r) => r.message);
    expect(msgs).toContain("MLT-WIDGET-01 -> Product capacity is modified. Min 10, Max 50 --> Min 10, Max 60");
    expect(msgs).toContain("Locked is modified. No --> Yes");
    expect(msgs.some((m) => /^Walking path priority is modified\. \S/.test(m))).toBe(true);
    expect(msgs.some((m) => m.includes("  "))).toBe(false);
    const capRow = rows().find((r) => r.field === "productCapacity" && r.type === "Update");
    expect(capRow).toMatchObject({ fieldLabel: "MLT-WIDGET-01 · Product capacity", fromValue: "Min 10, Max 50", toValue: "Min 10, Max 60" });

    const v2 = getLocation(w.db, auth, id).version;
    updateLocation(w.db, auth, actor(), id, save("KS-R9-CAP", { walkingPathPriority: 77, isLocked: true }, { version: v2 }));
    expect(rows().map((r) => r.message)).toContain("MLT-WIDGET-01 -> Product capacity is deleted. Was Min 10, Max 60");
  });

  it("rows stored before round 5 display with the new names", () => {
    expect(cleanChangeMessage("Lp type KS-CRIT-R4LPT25391 is created.")).toBe("LP Type KS-CRIT-R4LPT25391 is created.");
    expect(cleanChangeMessage("Walking Path Priority is modified.  --> 77")).toBe("Walking Path Priority is modified. (blank) → 77");
    expect(tidyLegacyNames("Is Locked")).toBe("Locked");
    expect(tidyLegacyNames("Max Sku Qty")).toBe("Max SKU Qty");
  });

  it("capacityLineChanges ignores unchanged lines", () => {
    const a = { key: "p|Each", label: "SKU-A", min: 1, max: 5 };
    expect(capacityLineChanges("lpCapacity", [a], [a])).toEqual([]);
    expect(capacityLineChanges("lpCapacity", [], [a])[0]?.message).toBe("SKU-A -> LP capacity is created. Min 1, Max 5");
  });
});

describe("LP numbers inherit their type's dimensions", () => {
  it("an LP with no dimensions shows the type's, and actual volume is L × W × H", () => {
    const t = w.db.insert(schema.lpTypes).values({ warehouseId: w.warehouseId, code: "TOTE9", numberPrefix: "T9-", numberLength: 5, length: 24, width: 16, height: 12, emptyWeight: 50 }).returning().get();
    const bare = w.db.insert(schema.licensePlates).values({ warehouseId: w.warehouseId, lpTypeId: t.id, number: "T9-00001" }).returning().get();
    w.db.insert(schema.licensePlates).values({ warehouseId: w.warehouseId, lpTypeId: t.id, number: "T9-00002", length: 10, width: 10, height: 10, weight: 5, actualVolume: 900 }).run();
    const rows = listLpNumbers(w.db, auth, EMPTY_GRID_QUERY).rows;
    expect(rows.find((r) => r.number === "T9-00001")).toMatchObject({ length: 24, width: 16, height: 12, weight: 50, actualVolume: 4608 });
    expect(rows.find((r) => r.number === "T9-00002")).toMatchObject({ length: 10, weight: 5, actualVolume: 900 });
    expect(getLpNumber(w.db, auth, bare.id)).toMatchObject({ length: 24, actualVolume: 4608 });
    const stored = w.db.select().from(schema.licensePlates).where(and(eq(schema.licensePlates.id, bare.id))).get()!;
    expect(stored.length).toBe(0);
  });
});

describe("small copy helpers", () => {
  it("location detail position and capacity summary", () => {
    expect(positionTriple(null, "A", "01")).toBe("— / A / 01");
    expect(positionTriple("", "", "")).toBeNull();
    expect(capacityRulesSummary(0, 0)).toBe("0 products · 0 LPs");
    expect(capacityRulesSummary(1, 1)).toBe("1 product · 1 LP");
  });

  it("default warehouse confirm names both warehouses and what stays", () => {
    const copy = defaultSwitchImpact("MLT1", "KS2");
    expect(copy).toContain("MLT1 stops being the default and KS2 is marked Default");
    expect(copy).toContain("don't change");
    expect(defaultSwitchImpact(null, "KS2")).not.toContain("stops being");
  });

  it("kit picker items are recognised and max weight below empty weight is flagged", () => {
    expect(isKitItem({ id: "p", label: "APX-KIT", meta: { isKit: true } })).toBe(true);
    expect(isKitItem({ id: "p", label: "APX", meta: { isKit: false } })).toBe(false);
    expect(isKitItem({ id: "p", label: "APX" })).toBe(false);
    expect(maxWeightIssue(10, 5)).toBe("Max weight must be at least the empty weight");
    expect(maxWeightIssue(10, 0)).toBeNull();
  });
});
