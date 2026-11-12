/** Acceptance "Carrier errors": a UPS label call with a short ship-from phone is logged under Label Generation with HTTP 400. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import "@/server/domain/carriers";
import { createOrder } from "@/server/domain/orders/create-update";
import { createLabel, rateShop } from "@/server/domain/shipping/labels";
import type { AuthContext } from "@/server/auth/context";
import { createPreset } from "@/server/repositories/rate-shopping";
import { presetSaveSchema } from "@/lib/grid-defs/integrations/rate-shopping";
import { carrierSettingsSchema } from "@/lib/domain-types";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

let w: World;
beforeEach(async () => { w = await createWorld(); });
afterEach(() => w.close());

async function upsTestSetup(phone: string) {
  const settings = carrierSettingsSchema.parse({
    shipFrom: { useRetailerAddress: false, address: { companyName: "MLT1", line1: "100 Main St", city: "Memphis", state: "TN", postalCode: "38118", country: "United States", phone } },
  });
  const conn = (await w.db.insert(schema.carrierConnections).values({ provider: "ups", setupName: "UPS-TEST", accountPrefix: "UPS", warehouseId: w.warehouseId, environment: "Test", settings }).returning())[0];
  const svc = (await w.db.insert(schema.carrierServices).values({ connectionId: conn.id, carrierCode: "UPS", serviceCode: "03", name: "UPS Ground", transitDays: 5 }).returning())[0];
  return { conn, svc };
}

async function packingOrder() {
  const order = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]) as Parameters<typeof createOrder>[2]);
  await w.db.update(schema.shipmentOrders).set({ status: "Packing Started" }).where(eq(schema.shipmentOrders.id, order.id));
  return order;
}

describe("carrier label errors", () => {
  it("logs a UPS ship-from phone under 10 characters as a Label Generation error with HTTP 400", async () => {
    const { conn, svc } = await upsTestSetup("555-12");
    const order = await packingOrder();
    await expect(createLabel(w.db, w.ctx, { orderId: order.id, carrierConnectionId: conn.id, carrierServiceId: svc.id, packages: [{ weightOz: 16, length: 6, width: 6, height: 6 }], source: "OrderGrid" }, { files: w.files }))
      .rejects.toThrow(/PhoneNumber must be at least 10/);
    const log = (await w.db.select().from(schema.carrierCallLogs).where(and(eq(schema.carrierCallLogs.connectionId, conn.id), eq(schema.carrierCallLogs.step, "LabelGeneration"))).limit(1))[0];
    expect(log?.httpCode).toBe(400);
    expect(log?.status).not.toBe("Success");
    expect(JSON.parse(log?.requestJson ?? "{}")).toHaveProperty("service", "03");
    expect(JSON.parse(log?.responseJson ?? "{}").error).toMatch(/PhoneNumber/);
    expect(await w.db.select().from(schema.shipments).where(eq(schema.shipments.orderId, order.id))).toHaveLength(0);
  });

  it("creates a label once the phone is valid", async () => {
    const { conn, svc } = await upsTestSetup("901-555-0142");
    const order = await packingOrder();
    const res = await createLabel(w.db, w.ctx, { orderId: order.id, carrierConnectionId: conn.id, carrierServiceId: svc.id, packages: [{ weightOz: 16, length: 6, width: 6, height: 6 }], source: "OrderGrid" }, { files: w.files });
    expect(res.shipments).toHaveLength(1);
    expect(res.masterTrackingNumber).toMatch(/^1Z/);
  });
});

describe("rate shopping at label time", () => {
  it("a Cheapest preset picks the lowest sandbox rate and records the preset on the rate call", async () => {
    const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
    const auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
    const preset = await createPreset(w.db, auth, { userId: w.userId, source: "admin@test.io" }, presetSaveSchema.parse({
      name: "KS-TEST Cheapest", description: "Lowest", warehouseId: w.warehouseId, clientId: w.clientId, isActive: true, method: "Cheapest", showErrors: false, useAllServices: true, serviceIds: [],
    }));
    const order = await packingOrder();
    const res = await rateShop(w.db, w.ctx, { orderId: order.id, presetId: preset.id, packages: [{ weightOz: 16, length: 6, width: 6, height: 6 }] });
    expect(res.quotes.length).toBeGreaterThan(1);
    expect(res.selected?.price).toBe(Math.min(...res.quotes.map((q) => q.price)));
    const log = (await w.db.select().from(schema.carrierCallLogs).where(eq(schema.carrierCallLogs.step, "RateCall")).limit(1))[0];
    expect(log?.rateShoppingName).toBe("KS-TEST Cheapest");
  });
});
