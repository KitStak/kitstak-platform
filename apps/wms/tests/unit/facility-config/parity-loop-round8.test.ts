import { describe, expect, it } from "vitest";
import { locationInfoSchema, LOCATION_INFO_DEFAULTS } from "@/lib/grid-defs/facility/locations";
import { warehouseSchema } from "@/lib/grid-defs/facility/warehouses";
import { lpTypeSchema } from "@/lib/grid-defs/facility/lp-types";
import { duplicateCartSchema } from "@/lib/grid-defs/facility/mobile-carts";
import { requiredPattern, selectableWarehouseOptions } from "@/lib/grid-defs/facility/common";

const issuesAt = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }, key: string) =>
  (result.error?.issues ?? []).filter((i) => i.path.join(".") === key).map((i) => i.message);

describe("critic R4: a blank code reports one error", () => {
  it("requiredPattern: blank → only 'required'; bad format → only the format rule", () => {
    const s = requiredPattern("Code", 10, /^[A-Z]+$/, "Capitals only");
    expect(s.safeParse("").error?.issues.map((i) => i.message)).toEqual(["Code is required"]);
    expect(s.safeParse("   ").error?.issues.map((i) => i.message)).toEqual(["Code is required"]);
    expect(s.safeParse("ab").error?.issues.map((i) => i.message)).toEqual(["Capitals only"]);
    expect(s.safeParse("AB").success).toBe(true);
    expect(s.safeParse("ABCDEFGHIJK").error?.issues.map((i) => i.message)).toEqual(["Code can be at most 10 characters"]);
  });

  it("location code", () => {
    const r = locationInfoSchema.safeParse({ ...LOCATION_INFO_DEFAULTS, code: "", warehouseId: "w1" });
    expect(issuesAt(r, "code")).toEqual(["Location code is required"]);
    const bad = locationInfoSchema.safeParse({ ...LOCATION_INFO_DEFAULTS, code: "-A", warehouseId: "w1" });
    expect(issuesAt(bad, "code")).toEqual(["Use letters, numbers, dot, dash, slash or underscore"]);
  });

  it("warehouse code / prefix, LP type code, cart duplicate code", () => {
    expect(issuesAt(warehouseSchema.safeParse({ code: "", prefix: "" }), "code")).toEqual(["Code is required"]);
    expect(issuesAt(warehouseSchema.safeParse({ code: "", prefix: "" }), "prefix")).toEqual(["Prefix is required"]);
    expect(issuesAt(lpTypeSchema.safeParse({ code: "" }), "code")).toEqual(["Code is required"]);
    expect(issuesAt(duplicateCartSchema.safeParse({ code: "" }), "code")).toEqual(["Code is required"]);
  });
});

describe("critic R4: inactive warehouses leave the pickers", () => {
  const all = [{ value: "mlt1", label: "MLT1" }, { value: "crit", label: "KS-CRIT-WH" }, { value: "ks2", label: "KS2" }];
  const inactive = new Set(["crit"]);
  it("drops inactive warehouses from create pickers", () => {
    expect(selectableWarehouseOptions(all, inactive).map((o) => o.value)).toEqual(["mlt1", "ks2"]);
    expect(selectableWarehouseOptions(all, inactive, "").map((o) => o.value)).toEqual(["mlt1", "ks2"]);
  });
  it("keeps the record's own inactive warehouse so an edit is never blank", () => {
    expect(selectableWarehouseOptions(all, inactive, "crit").map((o) => o.value)).toEqual(["mlt1", "crit", "ks2"]);
  });
  it("treats every warehouse as active when the flags are unknown", () => {
    expect(selectableWarehouseOptions(all, new Set())).toHaveLength(3);
  });
});
