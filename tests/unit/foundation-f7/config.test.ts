import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/server/db/schema";
import { recordUpdate } from "@/server/domain/change-log";
import { createOrder } from "@/server/domain/orders";
import { orderInput } from "../foundation/domain/fixtures";
import { asArray, call, closeWorld, cookieFor, current, expectGuarded, openWorld, removeFilesRoot, req } from "./harness";

vi.mock("@/server/api/db", () => ({ getAppDb: async () => current().db }));

const changeLogRoute = await import("@/app/api/change-log/route");
const cfRoute = await import("@/app/api/custom-fields/route");
const cfItemRoute = await import("@/app/api/custom-fields/[id]/route");
const lookupsRoute = await import("@/app/api/lookups/[type]/route");
const lookupRoute = await import("@/app/api/lookups/[type]/[id]/route");

beforeEach(() => { openWorld(); });
afterEach(() => closeWorld());
afterAll(() => removeFilesRoot());

const admin = (): Promise<string> => cookieFor(current().userId);

describe("GET /api/change-log", () => {
  it("returns paged field-level rows for an order in scope and 404 out of scope", async () => {
    const w = current();
    const order = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    recordUpdate(w.db, w.ctx, { entityType: "shipment_order", entityId: order.id, entityCode: order.code, before: { customerName: "Jane Doe" }, after: { customerName: "John Roe" } });
    const url = `/api/change-log?entityType=shipment_order&entityId=${order.id}&ps=100`;
    const res = await call(changeLogRoute.GET, req("GET", url, { cookie: await cookieFor(w.viewerId) }));
    expect(res.status).toBe(200);
    const rows = asArray(res.data);
    expect(rows.some((r) => r.type === "Create")).toBe(true);
    expect(rows.some((r) => r.fieldLabel === "Customer Name" && r.toValue === "John Roe")).toBe(true);
    expect(res.json.meta).toMatchObject({ page: 1, pageSize: 100 });

    const other = w.db.insert(schema.products).values({
      clientId: w.otherClientId, sku: "B-1", barcode: "B-1", name: "B", category: "General", weightOz: 1, lengthIn: 1, widthIn: 1, heightIn: 1, price: 1, status: "Active",
    }).returning().get().id;
    const foreign = createOrder(w.db, w.ctx, orderInput(w, [{ productId: other, quantity: 1 }], { clientId: w.otherClientId }));
    const hidden = await call(changeLogRoute.GET, req("GET", `/api/change-log?entityType=shipment_order&entityId=${foreign.id}`, { cookie: await cookieFor(w.viewerId) }));
    expect(hidden.status).toBe(404);
  });

  it("validates the entity type", async () => {
    const res = await call(changeLogRoute.GET, req("GET", "/api/change-log?entityType=bogus&entityId=x", { cookie: await admin() }));
    expect(res.status).toBe(400);
  });
});

describe("/api/custom-fields", () => {
  it("defines slots, enforces drop-down options and slot uniqueness, updates with version", async () => {
    const created = await call(cfRoute.POST, req("POST", "/api/custom-fields", {
      cookie: await admin(), body: { entityType: "shipment_order", slot: "dropDown1", name: "Channel", options: ["Web", "Phone", "Web"] },
    }));
    expect(created.status).toBe(201);
    const def = created.data as { id: string; options: string[] };
    expect(def.options).toEqual(["Web", "Phone"]);

    const noOptions = await call(cfRoute.POST, req("POST", "/api/custom-fields", {
      cookie: await admin(), body: { entityType: "shipment_order", slot: "dropDown2", name: "Bad" },
    }));
    expect(noOptions.status).toBe(400);
    const dup = await call(cfRoute.POST, req("POST", "/api/custom-fields", {
      cookie: await admin(), body: { entityType: "shipment_order", slot: "dropDown1", name: "Again", options: ["a"] },
    }));
    expect(dup.json.code).toBe("DUPLICATE");

    const updated = await call(cfItemRoute.PATCH, req("PATCH", `/api/custom-fields/${def.id}`, {
      cookie: await admin(), body: { isActive: false, version: 1 },
    }), { id: def.id });
    expect(updated.data).toMatchObject({ isActive: false, version: 2 });

    const listActive = await call(cfRoute.GET, req("GET", "/api/custom-fields?entityType=shipment_order", { cookie: await cookieFor(current().viewerId) }));
    expect(asArray(listActive.data)).toHaveLength(0);
    const listAll = await call(cfRoute.GET, req("GET", "/api/custom-fields?entityType=shipment_order&includeInactive=true", { cookie: await admin() }));
    expect(asArray(listAll.data)).toHaveLength(1);
    expect((await call(cfItemRoute.GET, req("GET", `/api/custom-fields/${def.id}`, { cookie: await admin() }), { id: def.id })).status).toBe(200);
  });

  it("is guarded for viewers and CSRF", async () => {
    await expectGuarded(cfRoute.POST, "POST", "/api/custom-fields", { entityType: "product", slot: "textBox1", name: "X" });
    await expectGuarded(cfItemRoute.PATCH, "PATCH", "/api/custom-fields/x", { name: "Y" }, { id: "x" });
  });
});

describe("/api/lookups/[type]", () => {
  it("creates global and scoped values, hides out-of-scope rows, logs changes", async () => {
    const w = current();
    const post = async (body: Record<string, unknown>) =>
      call(lookupsRoute.POST, req("POST", "/api/lookups/damage_reason", { cookie: await admin(), body }), { type: "damage_reason" });
    const global = await post({ name: "Crushed" });
    expect(global.status).toBe(201);
    expect((await post({ name: "Wet", clientId: w.otherClientId })).status).toBe(201);
    expect((await post({ name: "crushed" })).json.code).toBe("DUPLICATE");

    const viewerList = await call(lookupsRoute.GET, req("GET", "/api/lookups/damage_reason", { cookie: await cookieFor(w.viewerId) }), { type: "damage_reason" });
    expect(asArray(viewerList.data).map((r) => r.name)).toEqual(["Crushed"]);
    const adminList = await call(lookupsRoute.GET, req("GET", "/api/lookups/damage_reason", { cookie: await admin() }), { type: "damage_reason" });
    expect(asArray(adminList.data)).toHaveLength(2);

    const id = String((global.data as { id: string }).id);
    const patched = await call(lookupRoute.PATCH, req("PATCH", `/api/lookups/damage_reason/${id}`, { cookie: await admin(), body: { name: "Crushed Box", version: 1 } }), { type: "damage_reason", id });
    expect(patched.data).toMatchObject({ name: "Crushed Box", version: 2 });
    expect(w.db.select().from(schema.changeLog).all().filter((r) => r.entityType === "lookup_value").map((r) => r.type)).toEqual(["Create", "Create", "Update"]);

    expect((await call(lookupRoute.GET, req("GET", `/api/lookups/so_type/${id}`, { cookie: await admin() }), { type: "so_type", id })).status).toBe(404);
    const del = await call(lookupRoute.DELETE, req("DELETE", `/api/lookups/damage_reason/${id}`, { cookie: await admin() }), { type: "damage_reason", id });
    expect(del.status).toBe(200);
    expect((await call(lookupRoute.GET, req("GET", `/api/lookups/damage_reason/${id}`, { cookie: await admin() }), { type: "damage_reason", id })).status).toBe(404);
  });

  it("rejects unknown types and guards mutations", async () => {
    expect((await call(lookupsRoute.GET, req("GET", "/api/lookups/nope", { cookie: await admin() }), { type: "nope" })).status).toBe(400);
    await expectGuarded(lookupsRoute.POST, "POST", "/api/lookups/po_type", { name: "X" }, { type: "po_type" });
    await expectGuarded(lookupRoute.PATCH, "PATCH", "/api/lookups/po_type/x", { name: "X" }, { type: "po_type", id: "x" });
    await expectGuarded(lookupRoute.DELETE, "DELETE", "/api/lookups/po_type/x", undefined, { type: "po_type", id: "x" });
  });
});
