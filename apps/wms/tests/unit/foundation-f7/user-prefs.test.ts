import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/server/db/schema";
import { asArray, call, closeWorld, cookieFor, current, expectCsrf, openWorld, removeFilesRoot, req } from "./harness";

vi.mock("@/server/api/db", () => ({ getAppDb: async () => current().db }));

const viewsRoute = await import("@/app/api/saved-views/route");
const viewRoute = await import("@/app/api/saved-views/[id]/route");
const prefsRoute = await import("@/app/api/grid-prefs/[gridKey]/route");
const printersRoute = await import("@/app/api/printers/route");
const notificationsRoute = await import("@/app/api/notifications/route");
const readRoute = await import("@/app/api/notifications/read/route");
const tasksRoute = await import("@/app/api/background-tasks/route");
const taskRoute = await import("@/app/api/background-tasks/[id]/route");

beforeEach(async () => { await openWorld(); });
afterEach(() => closeWorld());
afterAll(() => removeFilesRoot());

describe("/api/saved-views", () => {
  it("saves own views, shares read-only, keeps one default, validates the query grammar", async () => {
    const w = current();
    const admin = await cookieFor(w.userId);
    const viewer = await cookieFor(w.viewerId);
    const save = (cookie: string, body: Record<string, unknown>) => call(viewsRoute.POST, req("POST", "/api/saved-views", { cookie, body }));

    const a = await save(admin, { gridKey: "shipment-orders", name: "Open", query: "f.status=in:Open", isDefault: true, isShared: true });
    expect(a.status).toBe(201);
    const b = await save(admin, { gridKey: "shipment-orders", name: "Today", query: "f.orderDate=date:today", isDefault: true });
    expect(b.status).toBe(201);
    expect((await save(admin, { gridKey: "shipment-orders", name: "Bad", query: "f.x=bogus:1" })).status).toBe(400);
    expect((await save(admin, { gridKey: "shipment-orders", name: "Open", query: "" })).json.code).toBe("DUPLICATE");

    const mine = asArray((await call(viewsRoute.GET, req("GET", "/api/saved-views?gridKey=shipment-orders", { cookie: admin }))).data);
    expect(mine.filter((v) => v.isDefault).map((v) => v.name)).toEqual(["Today"]);

    const viewerList = asArray((await call(viewsRoute.GET, req("GET", "/api/saved-views?gridKey=shipment-orders", { cookie: viewer }))).data);
    expect(viewerList.map((v) => v.name)).toEqual(["Open"]);
    const sharedId = String((a.data as { id: string }).id);
    const privateId = String((b.data as { id: string }).id);
    expect((await call(viewRoute.GET, req("GET", `/api/saved-views/${sharedId}`, { cookie: viewer }), { id: sharedId })).status).toBe(200);
    expect((await call(viewRoute.GET, req("GET", `/api/saved-views/${privateId}`, { cookie: viewer }), { id: privateId })).status).toBe(404);
    expect((await call(viewRoute.PATCH, req("PATCH", `/api/saved-views/${sharedId}`, { cookie: viewer, body: { name: "Hijack" } }), { id: sharedId })).status).toBe(403);
    expect((await call(viewRoute.DELETE, req("DELETE", `/api/saved-views/${sharedId}`, { cookie: viewer }), { id: sharedId })).status).toBe(403);

    const renamed = await call(viewRoute.PATCH, req("PATCH", `/api/saved-views/${sharedId}`, { cookie: admin, body: { name: "Open orders", version: 1 } }), { id: sharedId });
    expect(renamed.data).toMatchObject({ name: "Open orders", version: 2 });
    expect((await call(viewRoute.DELETE, req("DELETE", `/api/saved-views/${privateId}`, { cookie: admin }), { id: privateId })).status).toBe(200);
  });

  it("requires CSRF on mutations", async () => {
    await expectCsrf(viewsRoute.POST, "POST", "/api/saved-views", { gridKey: "g", name: "n", query: "" });
    await expectCsrf(viewRoute.PATCH, "PATCH", "/api/saved-views/x", { name: "n" }, { id: "x" });
    await expectCsrf(viewRoute.DELETE, "DELETE", "/api/saved-views/x", undefined, { id: "x" });
  });
});

describe("/api/grid-prefs/[gridKey]", () => {
  it("returns null until saved, then the saved prefs; validates page size", async () => {
    const cookie = await cookieFor(current().viewerId);
    const params = { gridKey: "shipment-orders" };
    expect((await call(prefsRoute.GET, req("GET", "/api/grid-prefs/shipment-orders", { cookie }), params)).data).toBeNull();
    const prefs = { visible: ["code", "status"], order: ["status", "code"], widths: { code: 120 }, density: "Small", pageSize: 300 };
    const put = await call(prefsRoute.PUT, req("PUT", "/api/grid-prefs/shipment-orders", { cookie, body: prefs }), params);
    expect(put.status).toBe(200);
    expect((await call(prefsRoute.GET, req("GET", "/api/grid-prefs/shipment-orders", { cookie }), params)).data).toEqual(prefs);
    const bad = await call(prefsRoute.PUT, req("PUT", "/api/grid-prefs/shipment-orders", { cookie, body: { ...prefs, pageSize: 42 } }), params);
    expect(bad.status).toBe(400);
    await expectCsrf(prefsRoute.PUT, "PUT", "/api/grid-prefs/shipment-orders", prefs, params);
  });
});

describe("/api/printers", () => {
  it("lists warehouses in scope and assigns printers only inside it", async () => {
    const w = current();
    const cookie = await cookieFor(w.viewerId);
    const list = asArray((await call(printersRoute.GET, req("GET", "/api/printers", { cookie }))).data);
    expect(list.map((p) => p.warehouseId)).toEqual([w.warehouseId]);
    const put = await call(printersRoute.PUT, req("PUT", "/api/printers", { cookie, body: { warehouseId: w.warehouseId, barcodePrinter: "Zebra ZT410", laserPrinter: "" } }));
    expect(put.data).toMatchObject({ barcodePrinter: "Zebra ZT410", laserPrinter: null });
    const outside = await call(printersRoute.PUT, req("PUT", "/api/printers", { cookie, body: { warehouseId: w.otherWarehouseId, barcodePrinter: "X" } }));
    expect(outside.status).toBe(400);
    await expectCsrf(printersRoute.PUT, "PUT", "/api/printers", { warehouseId: w.warehouseId });
  });
});

describe("/api/notifications", () => {
  it("lists own notifications with an unread badge and marks them read", async () => {
    const w = current();
    const add = async (userId: string, title: string) => (await w.db.insert(schema.notifications).values({ userId, kind: "test", title }).returning())[0].id;
    const n1 = await add(w.viewerId, "One");
    await add(w.viewerId, "Two");
    await add(w.userId, "Admin only");
    const cookie = await cookieFor(w.viewerId);
    const list = await call(notificationsRoute.GET, req("GET", "/api/notifications", { cookie }));
    expect(asArray(list.data)).toHaveLength(2);
    expect(list.json.meta).toMatchObject({ total: 2, unread: 2 });

    const one = await call(readRoute.POST, req("POST", "/api/notifications/read", { cookie, body: { ids: [n1] } }));
    expect(one.data).toEqual({ updated: 1 });
    const unread = await call(notificationsRoute.GET, req("GET", "/api/notifications?unread=true", { cookie }));
    expect(asArray(unread.data).map((n) => n.title)).toEqual(["Two"]);
    expect((await call(readRoute.POST, req("POST", "/api/notifications/read", { cookie, body: { all: true } }))).data).toEqual({ updated: 1 });
    expect((await call(readRoute.POST, req("POST", "/api/notifications/read", { cookie, body: {} }))).status).toBe(400);
    await expectCsrf(readRoute.POST, "POST", "/api/notifications/read", { all: true });
  });
});

describe("/api/background-tasks", () => {
  it("shows only the caller's tasks", async () => {
    const w = current();
    const mine = (await w.db.insert(schema.backgroundTasks).values({ kind: "export", title: "Mine", userId: w.viewerId }).returning())[0].id;
    const theirs = (await w.db.insert(schema.backgroundTasks).values({ kind: "import", title: "Theirs", userId: w.userId }).returning())[0].id;
    const cookie = await cookieFor(w.viewerId);
    const list = await call(tasksRoute.GET, req("GET", "/api/background-tasks?kind=export", { cookie }));
    expect(asArray(list.data).map((t) => t.title)).toEqual(["Mine"]);
    expect((await call(taskRoute.GET, req("GET", `/api/background-tasks/${mine}`, { cookie }), { id: mine })).status).toBe(200);
    expect((await call(taskRoute.GET, req("GET", `/api/background-tasks/${theirs}`, { cookie }), { id: theirs })).status).toBe(404);
  });
});
