/** Round 2 (parity loop): PATCH merge, server defaults, zone card compact counts. */
import { describe, expect, it } from "vitest";
import { LOCATION_INFO_DEFAULTS, locationInfoSchema, locationSaveSchema, mergeLocationPatch, type LocationRecordForMerge } from "@/lib/grid-defs/facility/locations";
import { compactCount } from "@/components/locations/zone-summary-strip";

const stored: LocationRecordForMerge = {
  code: "A-01-01-1", warehouseId: "wh1", locationGroupId: null, locationZoneId: "z1",
  locationType: "Shelves", areaType: "Picking", replenishmentType: null, walkingPathPriority: 10,
  capacityType: "None", maxCapacityQty: 0, maxSkuQty: null, mezzanine: null, aisle: "A", rack: null, bay: "01",
  column: null, level: "1", position: null, dimensionUnit: "Inch", height: 1, width: 2, length: 3,
  volumeUnit: "Cubic Inch", volume: 6, displayMember: null, barcode: "A-01-01-1", abcCode: "None",
  singleClient: false, isLocked: true, dedicatedClientId: null, printApplyOnPacking: false, colorCode: null, version: 4,
  productCapacities: [{ clientId: "c1", productId: "p1", packType: "Each", minQty: 1, maxQty: 5 }],
  lpCapacities: [],
};

describe("mergeLocationPatch", () => {
  it("keeps stored fields and capacities when a partial body is sent", () => {
    const merged = locationSaveSchema.parse(mergeLocationPatch(stored, { info: { maxSkuQty: 99 } }));
    expect(merged.info.maxSkuQty).toBe(99);
    expect(merged.info.code).toBe("A-01-01-1");
    expect(merged.info.rack).toBe("01");
    expect(merged.info.level).toBe(1);
    expect(merged.info.isLocked).toBe(true);
    expect(merged.productCapacities).toHaveLength(1);
    expect(merged.version).toBe(4);
  });

  it("replaces capacity arrays and version only when sent", () => {
    const merged = locationSaveSchema.parse(mergeLocationPatch(stored, { productCapacities: [], version: 3 }));
    expect(merged.productCapacities).toEqual([]);
    expect(merged.version).toBe(3);
  });

  it("still validates the merged document", () => {
    expect(locationSaveSchema.safeParse(mergeLocationPatch(stored, { info: { capacityType: "Quantity", maxCapacityQty: 0 } })).success).toBe(false);
  });
});

describe("server defaults for omitted enums", () => {
  it("fills capacityType / units / flags like the UI does", () => {
    const parsed = locationInfoSchema.parse({ code: "X-1", warehouseId: "wh1", locationType: "Shelves", areaType: "Picking" });
    expect(parsed.capacityType).toBe(LOCATION_INFO_DEFAULTS.capacityType);
    expect(parsed.dimensionUnit).toBe("Inch");
    expect(parsed.volumeUnit).toBe("Cubic Inch");
    expect(parsed.abcCode).toBe("None");
    expect(parsed.isLocked).toBe(false);
    expect(parsed.height).toBe(0);
  });
});

describe("compactCount", () => {
  it("keeps zone card subtitles to one line", () => {
    expect(compactCount(950)).toBe("950");
    expect(compactCount(1200)).toBe("1.2k");
    expect(compactCount(5000)).toBe("5k");
    expect(compactCount(22_982)).toBe("23k");
    expect(compactCount(1_250_000)).toBe("1.3M");
  });
});
