import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/server/db/schema";
import { createOrder } from "@/server/domain/orders";
import { orderInput } from "../foundation/domain/fixtures";
import { asArray, call, closeWorld, cookieFor, current, expectGuarded, openWorld, removeFilesRoot, req } from "./harness";

vi.mock("@/server/api/db", () => ({ getAppDb: async () => current().db }));

const tagsRoute = await import("@/app/api/tags/route");
const tagRoute = await import("@/app/api/tags/[id]/route");
const applyRoute = await import("@/app/api/tags/apply/route");

beforeEach(async () => { await openWorld(); });
afterEach(() => closeWorld());
afterAll(() => removeFilesRoot());

async function adminCookie(): Promise<string> {
  return cookieFor(current().userId);
}

async function createTag(name: string, scope = "shipment_order"): Promise<Record<string, unknown>> {
  const res = await call(tagsRoute.POST, req("POST", "/api/tags", { cookie: await adminCookie(), body: { name, color: "#112233", scope } }));
  expect(res.status).toBe(201);
  return res.data as Record<string, unknown>;
}

describe("/api/tags", () => {
  it("creates, lists by scope, rejects duplicates and validates color", async () => {
    await createTag("Rush");
    await createTag("Fragile", "any");
    await createTag("Inbound", "purchase_order");
    const list = await call(tagsRoute.GET, req("GET", "/api/tags?scope=shipment_order", { cookie: await cookieFor(current().viewerId) }));
    expect(list.status).toBe(200);
    expect(asArray(list.data).map((t) => t.name)).toEqual(["Fragile", "Rush"]);

    const dup = await call(tagsRoute.POST, req("POST", "/api/tags", { cookie: await adminCookie(), body: { name: "rush", color: "#112233", scope: "shipment_order" } }));
    expect(dup.status).toBe(409);
    expect(dup.json.code).toBe("DUPLICATE");

    const bad = await call(tagsRoute.POST, req("POST", "/api/tags", { cookie: await adminCookie(), body: { name: "X", color: "red" } }));
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.json.fieldErrors as object)).toContain("color");
  });

  it("viewer gets 403 on POST /api/tags; mutations need CSRF", async () => {
    await expectGuarded(tagsRoute.POST, "POST", "/api/tags", { name: "Nope", color: "#000000" });
    const tag = await createTag("Rush");
    await expectGuarded(tagRoute.PATCH, "PATCH", `/api/tags/${String(tag.id)}`, { name: "x" }, { id: String(tag.id) });
    await expectGuarded(tagRoute.DELETE, "DELETE", `/api/tags/${String(tag.id)}`, undefined, { id: String(tag.id) });
    await expectGuarded(applyRoute.POST, "POST", "/api/tags/apply", { entityType: "shipment_order", ids: ["x"], tagIds: [tag.id], mode: "add" });
  });

  it("updates with optimistic concurrency and deletes", async () => {
    const tag = await createTag("Rush");
    const id = String(tag.id);
    const ok = await call(tagRoute.PATCH, req("PATCH", `/api/tags/${id}`, { cookie: await adminCookie(), body: { name: "Urgent", version: 1 } }), { id });
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({ name: "Urgent", version: 2 });
    const stale = await call(tagRoute.PATCH, req("PATCH", `/api/tags/${id}`, { cookie: await adminCookie(), body: { color: "#ffffff", version: 1 } }), { id });
    expect(stale.status).toBe(409);
    expect(stale.json.code).toBe("CONFLICT");
    const read = await call(tagRoute.GET, req("GET", `/api/tags/${id}`, { cookie: await adminCookie() }), { id });
    expect(read.data).toMatchObject({ name: "Urgent" });
    const del = await call(tagRoute.DELETE, req("DELETE", `/api/tags/${id}`, { cookie: await adminCookie() }), { id });
    expect(del.status).toBe(200);
    expect((await call(tagRoute.GET, req("GET", `/api/tags/${id}`, { cookie: await adminCookie() }), { id })).status).toBe(404);
  });

  it("bulk applies and removes per id, with cross-scope ids reported as NOT_FOUND", async () => {
    const w = current();
    const mine = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const otherClientProduct = (await w.db.insert(schema.products).values({
      clientId: w.otherClientId, sku: "BETA-1", barcode: "BETA-1", name: "Beta", category: "General", weightOz: 1, lengthIn: 1, widthIn: 1, heightIn: 1, price: 1, status: "Active",
    }).returning())[0].id;
    const foreign = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: otherClientProduct, quantity: 1 }], { clientId: w.otherClientId }));
    const tag = await createTag("Rush");
    const poTag = await createTag("Inbound", "purchase_order");

    // operator: scoped to w.clientId only, holds fulfillment.shipment_orders.tag
    const operator = await cookieFor(w.operatorId);
    const applied = await call(applyRoute.POST, req("POST", "/api/tags/apply", {
      cookie: operator, body: { entityType: "shipment_order", ids: [mine.id, foreign.id, "missing"], tagIds: [tag.id], mode: "add" },
    }));
    expect(applied.status).toBe(200);
    const result = applied.data as { succeeded: string[]; failed: { id: string; code: string }[] };
    expect(result.succeeded).toEqual([mine.id]);
    expect(result.failed.map((f) => [f.id, f.code])).toEqual([[foreign.id, "NOT_FOUND"], ["missing", "NOT_FOUND"]]);
    expect(await w.db.select().from(schema.entityTags)).toHaveLength(1);

    const wrongScope = await call(applyRoute.POST, req("POST", "/api/tags/apply", {
      cookie: operator, body: { entityType: "shipment_order", ids: [mine.id], tagIds: [poTag.id], mode: "add" },
    }));
    expect(wrongScope.status).toBe(400);

    const removed = await call(applyRoute.POST, req("POST", "/api/tags/apply", {
      cookie: operator, body: { entityType: "shipment_order", ids: [mine.id], tagIds: [tag.id], mode: "remove" },
    }));
    expect((removed.data as { succeeded: string[] }).succeeded).toEqual([mine.id]);
    expect(await w.db.select().from(schema.entityTags)).toHaveLength(0);
  });

  it("requires a session", async () => {
    expect((await call(tagsRoute.GET, req("GET", "/api/tags"))).status).toBe(401);
  });
});
