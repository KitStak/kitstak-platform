/** M12 pure logic: rule catalogs, schemas, credential vault, sandbox store, carrier validation. */
import { describe, expect, it } from "vitest";
import { PUTAWAY_ACTIONS } from "@/server/domain/putaway-actions";
import { PUTAWAY_ACTION_DEFS, comparatorsFor, describeCondition, fieldDef, ORDER_CONDITION_FIELDS } from "@/lib/grid-defs/integrations/rule-fields";
import { algorithmSaveSchema } from "@/lib/grid-defs/integrations/algorithms";
import { workflowSaveSchema } from "@/lib/grid-defs/integrations/workflows";
import { presetSaveSchema } from "@/lib/grid-defs/integrations/rate-shopping";
import { editStoreSchema } from "@/lib/grid-defs/integrations/channels";
import { channelSettingsSchema } from "@/lib/domain-types";
import { credentialHints, decryptCredentials, encryptCredentials, mergeCredentials } from "@/server/integrations/crypto";
import { sandboxAdapter } from "@/server/integrations/sandbox";
import { UPS_DEF } from "@/server/integrations/carriers/ups";
import { CarrierError } from "@/server/domain/carriers/adapter";
import type { AdapterContext } from "@/server/integrations/channel-adapter";

describe("rule catalogs", () => {
  it("lists exactly the 38 putaway actions the domain implements", () => {
    expect(PUTAWAY_ACTION_DEFS).toHaveLength(38);
    expect(PUTAWAY_ACTION_DEFS.map((a) => a.key).sort()).toEqual(PUTAWAY_ACTIONS.map((a) => a.key).sort());
  });

  it("offers comparators by field type", () => {
    expect(comparatorsFor("lookup")).toEqual(["in", "notIn"]);
    expect(comparatorsFor("number")).toContain("between");
    expect(comparatorsFor("boolean")).toEqual(["equals"]);
  });

  it("describes conditions with readable names", () => {
    expect(describeCondition("putaway", { field: "areaType", comparator: "in", value: ["Picking"] })).toBe("Area Type in Picking");
    expect(describeCondition("order", { field: "client", comparator: "in", value: ["c1"] }, (id) => (id === "c1" ? "APX" : id))).toBe("Client in APX");
    expect(describeCondition("order", { field: "orderDate", comparator: "isEmpty", value: null })).toBe("Shipment Order Date is empty");
  });

  it("exposes address lines for workflows", () => {
    expect(fieldDef("order", "shipAddress")?.label).toBe("Address Line 1");
    expect(ORDER_CONDITION_FIELDS.length).toBeGreaterThanOrEqual(36);
  });
});

describe("schemas", () => {
  const base = { name: "A", warehouseId: "w", status: "Active" as const };
  it("requires an action on putaway rules", () => {
    const r = algorithmSaveSchema.safeParse({ ...base, kind: "Putaway", rules: [{ name: "R1", actions: [] }] });
    expect(r.success).toBe(false);
  });
  it("rejects duplicate rule names", () => {
    const r = algorithmSaveSchema.safeParse({ ...base, kind: "Allocation", rules: [{ name: "R" }, { name: "r" }] });
    expect(r.success).toBe(false);
  });

  const wf = { name: "Block PO Box", trigger: "Shipment Order Created" as const, match: "Any" as const, conditions: [], isActive: true, stopProcessing: false };
  it("requires action params and at least one action", () => {
    expect(workflowSaveSchema.safeParse({ ...wf, actions: [] }).success).toBe(false);
    const missing = workflowSaveSchema.safeParse({ ...wf, actions: [{ action: "Set Priority", params: {} }] });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.issues[0]?.path.join(".")).toBe("actions.0.params.priority");
    expect(workflowSaveSchema.safeParse({ ...wf, actions: [{ action: "Block Order", params: {} }] }).success).toBe(true);
  });
  it("limits purchase-order triggers to Notify Users", () => {
    expect(workflowSaveSchema.safeParse({ ...wf, trigger: "Purchase Order Created", actions: [{ action: "Block Order", params: {} }] }).success).toBe(false);
  });

  it("needs a transit time for Cheapest In Time and a service unless using all", () => {
    const p = { name: "P", description: "d", warehouseId: "w", clientId: "c", isActive: true, showErrors: false };
    expect(presetSaveSchema.safeParse({ ...p, method: "Cheapest In Time", useAllServices: true }).success).toBe(false);
    expect(presetSaveSchema.safeParse({ ...p, method: "Cheapest", useAllServices: false, serviceIds: [] }).success).toBe(false);
    expect(presetSaveSchema.safeParse({ ...p, method: "Cheapest In Time", transitDays: 3, useAllServices: true }).success).toBe(true);
  });

  it("requires a location mapping before orders download", () => {
    const settings = channelSettingsSchema.parse({ paymentStatuses: ["paid"], orders: { download: true } });
    const r = editStoreSchema.safeParse({ storeName: "S", isActive: true, apiVersion: "GraphQL", mappings: [], settings });
    expect(r.success).toBe(false);
  });
});

describe("credential vault", () => {
  it("round-trips, masks and merges without leaking", () => {
    const token = encryptCredentials({ accessToken: "shpat_1234567890abcd" });
    expect(token.startsWith("v1.")).toBe(true);
    expect(token).not.toContain("shpat");
    expect(decryptCredentials(token)).toEqual({ accessToken: "shpat_1234567890abcd" });
    expect(credentialHints(decryptCredentials(token))).toEqual({ accessToken: "abcd" });
    expect(decryptCredentials("v1.bad.token.x")).toBeNull();
    expect(mergeCredentials({ apiKey: "a", apiSecret: "b" }, { apiKey: "", apiSecret: "c" })).toEqual({ apiKey: "a", apiSecret: "c" });
  });
});

describe("sandbox store", () => {
  const skus = [{ sku: "APX-TEE-1", title: "Tee", price: 20 }, { sku: "APX-TEE-2", title: "Tee 2", price: 22 }];
  const ctx = (runNumber: number): AdapterContext => ({
    connection: { id: "conn-1", distribution: "API" } as AdapterContext["connection"], credentials: null,
    settings: channelSettingsSchema.parse({}), runNumber, now: new Date("2026-11-06T12:00:00Z"),
  });
  it("is deterministic and returns no data every 7th run", async () => {
    const a = await sandboxAdapter(skus).fetchOrders(ctx(4), null);
    const b = await sandboxAdapter(skus).fetchOrders(ctx(4), null);
    expect(a.map((o) => o.number)).toEqual(b.map((o) => o.number));
    expect(await sandboxAdapter(skus).fetchOrders(ctx(7), null)).toHaveLength(0);
  });
  it("never sells an unknown SKU on a scheduled run (R5: errors only on demand)", async () => {
    for (let run = 1; run <= 30; run++) {
      const orders = await sandboxAdapter(skus).fetchOrders(ctx(run), null);
      expect(orders.flatMap((o) => o.lines).every((l) => skus.some((s) => s.sku === l.sku))).toBe(true);
    }
  });
  it("Simulate error adds one unknown-SKU order, flagged simulated, and re-fetches it by id", async () => {
    const orders = await sandboxAdapter(skus).fetchOrders({ ...ctx(3), simulateError: true }, null);
    expect(orders[0]?.id).toBe("sbx-3-0-sim");
    expect(orders[0]?.lines.some((l) => l.sku === "APX-SIM-3")).toBe(true);
    expect((orders[0]?.raw as { simulated?: boolean }).simulated).toBe(true);
    expect(orders.slice(1).flatMap((o) => o.lines).every((l) => !l.sku?.includes("-SIM-"))).toBe(true);
    const again = await sandboxAdapter(skus).fetchOrdersById(ctx(0), [orders[0]?.id ?? ""]);
    expect(again[0]?.number).toBe(orders[0]?.number);
    expect(again[0]?.lines.some((l) => l.sku === "APX-SIM-3")).toBe(true);
    // Even a "no data" run (every 7th) returns orders when an error is simulated.
    expect(await sandboxAdapter(skus).fetchOrders({ ...ctx(7), simulateError: true }, null)).not.toHaveLength(0);
  });
  it("re-fetches a pre-R5 error order (sbx-<run>-0) without the unknown SKU, so Retry Download clears it", async () => {
    const again = await sandboxAdapter(skus).fetchOrdersById(ctx(0), ["sbx-15-0"]);
    expect(again[0]?.lines.every((l) => skus.some((s) => s.sku === l.sku))).toBe(true);
  });
  it("ships one order per 4th run to a PO Box", async () => {
    const orders = await sandboxAdapter(skus).fetchOrders(ctx(5), null);
    expect(orders[1]?.shipTo?.line1.startsWith("PO Box")).toBe(true);
  });
});

describe("carrier validation (Test environment)", () => {
  const to = { name: "Jane", line1: "1 Main St", city: "Austin", state: "TX", postalCode: "78701", country: "United States" };
  it("rejects a UPS ship-from phone shorter than 10 characters with HTTP 400", () => {
    try {
      UPS_DEF.validateRequest({ ...to, phone: "555-12" }, to, [{ weightOz: 16, length: 6, width: 6, height: 6 }]);
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CarrierError);
      expect((e as CarrierError).httpCode).toBe(400);
      expect((e as CarrierError).message).toBe("ShipFrom PhoneNumber must be at least 10 alphanumeric characters");
    }
    expect(() => UPS_DEF.validateRequest({ ...to, phone: "5551234567" }, to, [{ weightOz: 16, length: 6, width: 6, height: 6 }])).not.toThrow();
  });
});
