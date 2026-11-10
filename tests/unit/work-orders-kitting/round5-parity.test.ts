import { describe, expect, it } from "vitest";
import { woTxnView } from "@/lib/grid-defs/work-orders/wo-transactions";
import { planningDeniedForRoles } from "@/lib/grid-defs/work-orders/wo-planning";
import { formatInZone } from "@/lib/grid-defs/work-orders/wo-time";
import { printReason } from "@/lib/grid-defs/work-orders/work-order-model";

const KIT = "kit-1";

describe("work order Transactions tab signing (Logiwa Inventory Transaction Summary)", () => {
  it("signs a From-only component row as consumed (−n)", () => {
    const v = woTxnView({ type: "Kitting", qty: 2, productId: "c-1", fromLocationId: "L1", toLocationId: null }, KIT);
    expect(v).toEqual({ qty: -2, direction: "out", label: "Kitting (component consumed)" });
  });
  it("labels the kit receipt row as Kitting kit output (+n), not Receiving", () => {
    const v = woTxnView({ type: "Receiving", qty: 1, productId: KIT, fromLocationId: null, toLocationId: "K1" }, KIT);
    expect(v).toEqual({ qty: 1, direction: "in", label: "Kitting (kit output)" });
  });
  it("labels disassembly rows by role", () => {
    expect(woTxnView({ type: "DisassembleKit", qty: 1, productId: KIT, fromLocationId: "K1", toLocationId: null }, KIT)).toMatchObject({ qty: -1, label: "Disassembly (kit consumed)" });
    expect(woTxnView({ type: "DisassembleKit", qty: 2, productId: "c-1", fromLocationId: null, toLocationId: "L1" }, KIT)).toMatchObject({ qty: 2, label: "Disassembly (component returned)" });
  });
  it("keeps moves unsigned", () => {
    expect(woTxnView({ type: "Picking", qty: 3, productId: "c-1", fromLocationId: "L1", toLocationId: "K1" }, KIT)).toMatchObject({ qty: 3, direction: "move" });
  });
});

describe("planning gate", () => {
  it("denies system operator/viewer-only users", () => {
    expect(planningDeniedForRoles(["operator"])).toBe(true);
    expect(planningDeniedForRoles(["operator", "viewer"])).toBe(true);
  });
  it("allows managers, admins, custom roles and unknown role sets", () => {
    expect(planningDeniedForRoles(["operator", "manager"])).toBe(false);
    expect(planningDeniedForRoles(["planner-custom"])).toBe(false);
    expect(planningDeniedForRoles([])).toBe(false);
    expect(planningDeniedForRoles(undefined)).toBe(false);
  });
});

describe("print picking list guard", () => {
  const base = { requestedQty: 2, processedQty: 0 } as const;
  it("disables for without-picking work orders", () => {
    expect(printReason({ ...base, status: "Completed", type: "Work Order without Picking" })).toBe("Built without picking: no picking list");
  });
  it("allows a reprint for completed with-picking work orders", () => {
    expect(printReason({ ...base, status: "Completed", type: "Work Order with Picking" })).toBeNull();
  });
  it("allows open with-picking work orders", () => {
    expect(printReason({ ...base, status: "Open", type: "Work Order with Picking" })).toBeNull();
  });
});

describe("warehouse time zone formatting", () => {
  it("formats with a TZ suffix in the warehouse zone", () => {
    expect(formatInZone("2026-11-10T05:44:16.000Z", "America/New_York")).toBe("11/10/2026 12:44 AM EST");
    expect(formatInZone("2026-11-10T05:44:16.000Z", "America/Chicago")).toBe("11/09/2026 11:44 PM CST");
  });
  it("renders empty values as a dash", () => {
    expect(formatInZone(null, "America/Chicago")).toBe("–");
  });
});
