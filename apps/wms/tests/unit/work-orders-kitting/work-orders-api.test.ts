/** M08 route handlers through the real defineRoute pipeline (session, CSRF, permission, zod, scope). */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jobTypeSettingsSchema } from "@/lib/domain-types";
import * as schema from "@/server/db/schema";
import { ledger } from "@/server/domain/ledger";
import { locationRow } from "../foundation/domain/fixtures";
import { asArray, call, closeWorld, cookieFor, current, expectCsrf, expectGuarded, openWorld, removeFilesRoot, req } from "../foundation-f7/harness";

vi.mock("@/server/api/db", () => ({ getAppDb: async () => current().db }));

const listRoute = await import("@/app/api/work-orders/route");
const oneRoute = await import("@/app/api/work-orders/[id]/route");
const kitRoute = await import("@/app/api/work-orders/create-kit/route");
const pickingRoute = await import("@/app/api/work-orders/picking/route");
const countsRoute = await import("@/app/api/work-orders/status-counts/route");
const kitsRoute = await import("@/app/api/kits/route");
const recalcRoute = await import("@/app/api/kits/recalculate/route");
const sourcesRoute = await import("@/app/api/kits/sources/route");

let kitId = "";
let kittingLocId = "";

beforeEach(async () => {
  const w = await openWorld();
  kitId = (await w.db.insert(schema.products).values({
    clientId: w.clientId, sku: "MLT-KIT-2PK", barcode: "MLT-KIT-2PK", name: "MLTest 2 Pack Kit", category: "General",
    weightOz: 16, lengthIn: 6, widthIn: 4, heightIn: 4, price: 25, status: "Active", isKit: true, kitType: "Kit to Stock",
  }).returning())[0].id;
  await w.db.insert(schema.kitComponents).values({ kitProductId: kitId, componentProductId: w.productId, quantity: 2 });
  kittingLocId = (await w.db.insert(schema.locations).values(locationRow(w.warehouseId, "KIT-01", { areaType: "Kitting", preventAllocation: true })).returning())[0].id;
  await w.db.insert(schema.jobTypes).values({ code: "WO-PICK", description: "Work Order Picking", warehouseId: w.warehouseId, operationType: "Work Order", settings: jobTypeSettingsSchema.parse({}) });
  await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 22 });
});
afterEach(() => closeWorld());
afterAll(() => removeFilesRoot());

const body = (extra: Record<string, unknown> = {}) => {
  const w = current();
  return {
    warehouseId: w.warehouseId, clientId: w.clientId, code: "KS-TEST-WO-E2E", type: "Work Order without Picking", buildFor: "Stock",
    kitProductId: kitId, requestedQty: 5, components: [{ componentProductId: w.productId, locationId: w.loc.storageA }], ...extra,
  };
};
const admin = () => cookieFor(current().userId);

describe("/api/work-orders", () => {
  it("creates, lists, reads, edits with 409 on stale versions and deletes", async () => {
    const created = await call(listRoute.POST, req("POST", "/api/work-orders", { cookie: await admin(), body: body() }));
    expect(created.status).toBe(201);
    const row = created.data as Record<string, unknown>;
    expect(row).toMatchObject({ code: "KS-TEST-WO-E2E", status: "Open", kitSku: "MLT-KIT-2PK" });
    const id = String(row.id);

    const list = await call(listRoute.GET, req("GET", "/api/work-orders?q=KS-TEST&qm=sw", { cookie: await cookieFor(current().viewerId) }));
    expect(list.status).toBe(200);
    expect(asArray(list.data).map((r) => r.code)).toEqual(["KS-TEST-WO-E2E"]);
    const counts = await call(countsRoute.GET, req("GET", "/api/work-orders/status-counts", { cookie: await admin() }));
    expect(counts.data).toEqual({ Open: 1 });

    const detail = await call(oneRoute.GET, req("GET", `/api/work-orders/${id}`, { cookie: await admin() }), { id });
    expect(detail.status).toBe(200);

    const edit = { version: Number(row.version), data: body({ requestedQty: 6 }) };
    const ok = await call(oneRoute.PATCH, req("PATCH", `/api/work-orders/${id}`, { cookie: await admin(), body: edit }), { id });
    expect(ok.status).toBe(200);
    const stale = await call(oneRoute.PATCH, req("PATCH", `/api/work-orders/${id}`, { cookie: await admin(), body: edit }), { id });
    expect(stale.status).toBe(409);
    expect(stale.json.code).toBe("CONFLICT");

    const del = await call(oneRoute.DELETE, req("DELETE", `/api/work-orders/${id}`, { cookie: await admin() }), { id });
    expect(del.status).toBe(200);
    const gone = await call(oneRoute.GET, req("GET", `/api/work-orders/${id}`, { cookie: await admin() }), { id });
    expect(gone.status).toBe(404);
  });

  it("returns field errors for invalid bodies", async () => {
    const res = await call(listRoute.POST, req("POST", "/api/work-orders", { cookie: await admin(), body: body({ components: [] }) }));
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("VALIDATION");
    expect(Object.keys((res.json.fieldErrors ?? {}) as object).some((k) => k.startsWith("components."))).toBe(true);
  });

  it("refuses mutations for viewers and without CSRF", async () => {
    await expectGuarded(listRoute.POST, "POST", "/api/work-orders", body());
    await expectGuarded(kitRoute.POST, "POST", "/api/work-orders/create-kit", { workOrderId: "x", qty: 1, locationId: "y" });
    await expectGuarded(pickingRoute.POST, "POST", "/api/work-orders/picking", { ids: ["x"] });
    // Recalculate Now rewrites a shared derived table: viewers get 403, CSRF still applies.
    await expectGuarded(recalcRoute.POST, "POST", "/api/kits/recalculate", {});
    await expectCsrf(recalcRoute.POST, "POST", "/api/kits/recalculate", {});
    const sources = await call(sourcesRoute.GET, req("GET", `/api/kits/sources?productIds=${current().productId}&warehouseId=${current().warehouseId}`, { cookie: await admin() }));
    expect(sources.status).toBe(200);
    const buckets = (sources.data as Record<string, { lockedBy: string | null }[]>)[current().productId] ?? [];
    expect(buckets.length).toBeGreaterThan(0);
    expect(buckets.every((b) => b.lockedBy === null)).toBe(true);
  });

  it("builds kits through create-kit and reports kit capacity", async () => {
    const created = await call(listRoute.POST, req("POST", "/api/work-orders", { cookie: await admin(), body: body() }));
    const id = String((created.data as Record<string, unknown>).id);
    const recalc = await call(recalcRoute.POST, req("POST", "/api/kits/recalculate", { cookie: await admin(), body: {} }));
    expect(recalc.status).toBe(200);
    const before = await call(kitsRoute.GET, req("GET", "/api/kits", { cookie: await admin() }));
    expect(asArray(before.data).find((r) => r.sku === "MLT-KIT-2PK")?.netKittingCapacity).toBe(11);

    const res = await call(kitRoute.POST, req("POST", "/api/work-orders/create-kit", { cookie: await admin(), body: { workOrderId: id, qty: 5, locationId: kittingLocId } }));
    expect(res.status).toBe(200);
    expect((res.data as Record<string, unknown>).status).toBe("Completed");
    const kitStock = (await current().db.select().from(schema.inventory).where(eq(schema.inventory.productId, kitId))).reduce((s, b) => s + b.onHand, 0);
    expect(kitStock).toBe(5);
  });

  it("hides work orders outside the caller's warehouses (404)", async () => {
    const w = current();
    const created = await call(listRoute.POST, req("POST", "/api/work-orders", { cookie: await admin(), body: body() }));
    const id = String((created.data as Record<string, unknown>).id);
    await w.db.update(schema.workOrders).set({ warehouseId: w.otherWarehouseId }).where(eq(schema.workOrders.id, id));
    const res = await call(oneRoute.GET, req("GET", `/api/work-orders/${id}`, { cookie: await cookieFor(w.viewerId) }), { id });
    expect(res.status).toBe(404);
  });
});
