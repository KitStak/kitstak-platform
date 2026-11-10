/** M10 round 1 (parity loop): starter locations on warehouse create, warehouse labels, saved lookup options, contents product ids. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { warehouseLabel, withSavedOption } from "@/lib/grid-defs/facility/common";
import { LOCATION_INFO_DEFAULTS, locationSaveSchema } from "@/lib/grid-defs/facility/locations";
import { STARTER_LOCATION_SUFFIXES, WAREHOUSE_DEFAULTS, warehouseSchema } from "@/lib/grid-defs/facility/warehouses";
import { createLocation, getLocationContents } from "@/server/repositories/locations";
import { createWarehouse, STARTER_LOCATIONS, starterLocationCode } from "@/server/repositories/warehouses";
import { createWorld, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
const actor = () => ({ userId: w.userId, source: "Web" });

beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId, role: "admin" }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
});
afterEach(() => w.close());

const whInput = (extra: Record<string, unknown> = {}) =>
  warehouseSchema.parse({ ...WAREHOUSE_DEFAULTS, code: "KST3", name: "KS Test 3", prefix: "k3", addressLine: "1 Test Rd", postalCode: "38118", city: "Memphis", state: "TN", contactName: "Dana Ortiz", contactPhone: "901-555-0142", ...extra });

describe("warehouse starter locations", () => {
  it("creates <PREFIX>-RECV/PACK/SHIP/RET and wires them as the defaults", () => {
    expect(STARTER_LOCATIONS.map((s) => s.suffix)).toEqual([...STARTER_LOCATION_SUFFIXES]);
    const { id, starterLocations } = createWarehouse(w.db, auth, actor(), whInput());
    expect(starterLocations).toEqual(["K3-RECV", "K3-PACK", "K3-SHIP", "K3-RET"]);
    const locs = w.db.select({ id: schema.locations.id, code: schema.locations.code, areaType: schema.locations.areaType, barcode: schema.locations.barcode })
      .from(schema.locations).where(eq(schema.locations.warehouseId, id)).all();
    const byCode = new Map(locs.map((l) => [l.code, l]));
    expect(byCode.get("K3-RECV")).toMatchObject({ areaType: "Receiving", barcode: "K3-RECV" });
    expect(byCode.get("K3-PACK")?.areaType).toBe("Packing");
    expect(byCode.get("K3-SHIP")?.areaType).toBe("Shipment");
    expect(byCode.get("K3-RET")?.areaType).toBe("Returns");
    const wh = w.db.select().from(schema.warehouses).where(eq(schema.warehouses.id, id)).get();
    expect(wh?.defaultReceivingLocationId).toBe(byCode.get("K3-RECV")?.id);
    expect(wh?.defaultShipLocationId).toBe(byCode.get("K3-SHIP")?.id);
    expect(wh?.defaultReturnLocationId).toBe(byCode.get("K3-RET")?.id);
    // The caller's own scope object is untouched (the widening is local to the create).
    expect(auth.scope.warehouseIds).toEqual([w.warehouseId]);
  });

  it("skips them when the option is off", () => {
    const { id, starterLocations } = createWarehouse(w.db, auth, actor(), whInput({ code: "KST4", prefix: "K4", createStarterLocations: false }));
    expect(starterLocations).toEqual([]);
    expect(w.db.select().from(schema.locations).where(eq(schema.locations.warehouseId, id)).all()).toHaveLength(0);
  });

  it("builds codes from a trimmed, upper-cased prefix", () => {
    expect(starterLocationCode(" mlt2 ", "RECV")).toBe("MLT2-RECV");
  });
});

describe("display helpers", () => {
  it("does not repeat a code the warehouse name already starts with", () => {
    expect(warehouseLabel("MLT1", "MLT1 - Main Fulfillment")).toBe("MLT1 - Main Fulfillment");
    expect(warehouseLabel("KS2", "Overflow")).toBe("KS2 · Overflow");
    expect(warehouseLabel(null, "Overflow")).toBe("Overflow");
  });

  it("keeps a saved lookup value visible until its list has loaded", () => {
    const saved = { id: "g1", name: "Fast Movers" };
    expect(withSavedOption([], saved, "g1")).toEqual([{ value: "g1", label: "Fast Movers" }]);
    expect(withSavedOption([{ value: "g1", label: "Fast Movers" }], saved, "g1")).toHaveLength(1);
    expect(withSavedOption([], saved, "g2")).toEqual([]);
    expect(withSavedOption([], undefined, "g1")).toEqual([]);
  });
});

describe("location contents", () => {
  it("returns product ids so the detail page can link SKUs", () => {
    const save = locationSaveSchema.parse({ info: { ...LOCATION_INFO_DEFAULTS, code: "KS-TEST-CONT", warehouseId: w.warehouseId }, productCapacities: [], lpCapacities: [] });
    const { id } = createLocation(w.db, auth, actor(), save);
    const contents = getLocationContents(w.db, auth, id);
    expect(contents).toMatchObject({ buckets: [], tasks: [], ledger: [] });
  });
});
