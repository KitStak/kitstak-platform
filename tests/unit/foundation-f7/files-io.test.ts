import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/server/db/schema";
import { createOrder } from "@/server/domain/orders";
import { orderInput } from "../foundation/domain/fixtures";
import { asArray, call, closeWorld, cookieFor, current, expectCsrf, expectGuarded, openWorld, removeFilesRoot, req } from "./harness";

vi.mock("@/server/api/db", () => ({ getAppDb: async () => current().db }));
const afterCallbacks: (() => unknown)[] = [];
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => { afterCallbacks.push(fn); },
}));
const tick = vi.fn(async () => ({ at: "2026-11-05T00:00:00.000Z", status: "ran", ran: [] }));
vi.mock("@/server/scheduler", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/scheduler")>()),
  runSchedulerTick: () => tick(),
}));

const filesRoute = await import("@/app/api/files/route");
const fileRoute = await import("@/app/api/files/[id]/route");
const attachmentsRoute = await import("@/app/api/attachments/route");
const notesRoute = await import("@/app/api/notes/route");
const printRoute = await import("@/app/api/print/route");
const exportsRoute = await import("@/app/api/exports/route");
const importRoute = await import("@/app/api/imports/[key]/route");
const templateRoute = await import("@/app/api/imports/[key]/template/route");
const batchRoute = await import("@/app/api/imports/batches/[id]/route");
const searchRoute = await import("@/app/api/search/route");
const cronRoute = await import("@/app/api/cron/tick/route");

beforeEach(() => { openWorld(); afterCallbacks.length = 0; });
afterEach(() => closeWorld());
afterAll(() => removeFilesRoot());

const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");

function pdfForm(fields: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set("file", new Blob([PDF], { type: "application/pdf" }), "invoice.pdf");
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return form;
}

function mkOrder(): string {
  const w = current();
  return createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }])).id;
}

describe("files, attachments and notes", () => {
  it("uploads, attaches, downloads through the owning record and deletes", async () => {
    const w = current();
    const orderId = mkOrder();
    const admin = await cookieFor(w.userId);
    const up = await call(filesRoute.POST, req("POST", "/api/files", { cookie: admin, form: pdfForm({ ownerEntityType: "shipment_order", ownerEntityId: orderId }) }));
    expect(up.status).toBe(201);
    const fileId = String((up.data as { id: string }).id);

    const att = await call(attachmentsRoute.POST, req("POST", "/api/attachments", {
      cookie: admin, body: { entityType: "shipment_order", entityId: orderId, documentType: "Invoice", fileId },
    }));
    expect(att.status).toBe(201);
    expect(att.data).toMatchObject({ fileName: "invoice.pdf", mime: "application/pdf", documentType: "Invoice" });

    const viewer = await cookieFor(w.viewerId);
    const list = await call(attachmentsRoute.GET, req("GET", `/api/attachments?entityType=shipment_order&entityId=${orderId}`, { cookie: viewer }));
    expect(asArray(list.data)).toHaveLength(1);

    const dl = await call(fileRoute.GET, req("GET", `/api/files/${fileId}?inline=1`, { cookie: viewer }), { id: fileId });
    expect(dl.status).toBe(200);
    expect(dl.response.headers.get("content-type")).toBe("application/pdf");
    expect(dl.response.headers.get("content-disposition")).toMatch(/^inline; filename="invoice.pdf"/);
    expect(new Uint8Array(await dl.response.arrayBuffer())).toEqual(PDF);

    const attId = String((att.data as { id: string }).id);
    expect((await call(attachmentsRoute.DELETE, req("DELETE", `/api/attachments?id=${attId}`, { cookie: viewer }))).status).toBe(403);
    expect((await call(attachmentsRoute.DELETE, req("DELETE", `/api/attachments?id=${attId}`, { cookie: admin }))).status).toBe(200);
    expect((await call(fileRoute.GET, req("GET", `/api/files/${fileId}`, { cookie: admin }), { id: fileId })).status).toBe(404);
  });

  it("hides files of out-of-scope records and rejects bad uploads", async () => {
    const w = current();
    const other = w.db.insert(schema.products).values({
      clientId: w.otherClientId, sku: "B-1", barcode: "B-1", name: "B", category: "General", weightOz: 1, lengthIn: 1, widthIn: 1, heightIn: 1, price: 1, status: "Active",
    }).returning().get().id;
    const foreign = createOrder(w.db, w.ctx, orderInput(w, [{ productId: other, quantity: 1 }], { clientId: w.otherClientId })).id;
    const admin = await cookieFor(w.userId);
    const up = await call(filesRoute.POST, req("POST", "/api/files", { cookie: admin, form: pdfForm({ ownerEntityType: "shipment_order", ownerEntityId: foreign }) }));
    const fileId = String((up.data as { id: string }).id);
    const viewer = await cookieFor(w.viewerId);
    expect((await call(fileRoute.GET, req("GET", `/api/files/${fileId}`, { cookie: viewer }), { id: fileId })).status).toBe(404);

    const text = new FormData();
    text.set("file", new Blob(["hello"], { type: "text/plain" }), "a.txt");
    expect((await call(filesRoute.POST, req("POST", "/api/files", { cookie: admin, form: text }))).status).toBe(400);
    expect((await call(filesRoute.POST, req("POST", "/api/files", { cookie: admin, body: { x: 1 } }))).status).toBe(400);
    const viewerUpload = await call(filesRoute.POST, req("POST", "/api/files", { cookie: viewer, form: pdfForm({ ownerEntityType: "shipment_order", ownerEntityId: mkOrder() }) }));
    expect(viewerUpload.status).toBe(403);
    await expectCsrf(filesRoute.POST, "POST", "/api/files", undefined);
  });

  it("notes: add, list, author or editor deletes", async () => {
    const w = current();
    const orderId = mkOrder();
    const operator = await cookieFor(w.operatorId);
    const added = await call(notesRoute.POST, req("POST", "/api/notes", { cookie: operator, body: { entityType: "shipment_order", entityId: orderId, body: "Call customer" } }));
    expect(added.status).toBe(201);
    expect(added.data).toMatchObject({ body: "Call customer", userName: "Operator" });
    const list = await call(notesRoute.GET, req("GET", `/api/notes?entityType=shipment_order&entityId=${orderId}`, { cookie: await cookieFor(w.viewerId) }));
    expect(asArray(list.data)).toHaveLength(1);
    await expectGuarded(notesRoute.POST, "POST", "/api/notes", { entityType: "shipment_order", entityId: orderId, body: "x" });
    const id = String((added.data as { id: string }).id);
    expect((await call(notesRoute.DELETE, req("DELETE", `/api/notes?id=${id}`, { cookie: await cookieFor(w.viewerId) }))).status).toBe(403);
    expect((await call(notesRoute.DELETE, req("DELETE", `/api/notes?id=${id}`, { cookie: operator }))).status).toBe(200);
    await expectGuarded(attachmentsRoute.POST, "POST", "/api/attachments", { entityType: "shipment_order", entityId: orderId, documentType: "Other", fileId: "x" });
  });
});

describe("print, exports, imports", () => {
  it("renders a printout to a downloadable file", async () => {
    const cookie = await cookieFor(current().viewerId);
    const res = await call(printRoute.POST, req("POST", "/api/print", { cookie, body: { typeKey: "location-label", records: [{ code: "A-01-01" }] } }));
    expect(res.status).toBe(201);
    const data = res.data as { fileId: string; mime: string; url: string };
    expect(data.mime).toBe("application/pdf");
    const dl = await call(fileRoute.GET, req("GET", data.url, { cookie }), { id: data.fileId });
    expect(dl.status).toBe(200);
    expect((await call(printRoute.POST, req("POST", "/api/print", { cookie, body: { typeKey: "location-label", records: [] } }))).status).toBe(400);
    await expectCsrf(printRoute.POST, "POST", "/api/print", { typeKey: "location-label", records: [{ code: "A" }] });
  });

  it("queues an export (202) and schedules the runner; checks the grid permission", async () => {
    const w = current();
    const res = await call(exportsRoute.POST, req("POST", "/api/exports", { cookie: await cookieFor(w.viewerId), body: { gridKey: "jobs", query: "ps=100" } }));
    expect(res.status).toBe(202);
    expect(res.data).toMatchObject({ kind: "export", status: "queued", gridKey: "jobs" });
    expect(afterCallbacks).toHaveLength(1);
    const unknown = await call(exportsRoute.POST, req("POST", "/api/exports", { cookie: await cookieFor(w.viewerId), body: { gridKey: "nope" } }));
    expect(unknown.status).toBe(400);
    await expectCsrf(exportsRoute.POST, "POST", "/api/exports", { gridKey: "jobs" });
  });

  it("serves the import overview, template and validation preview; viewer is forbidden", async () => {
    const w = current();
    const admin = await cookieFor(w.userId);
    const params = { key: "locations" };
    const overview = await call(importRoute.GET, req("GET", "/api/imports/locations", { cookie: admin }), params);
    expect(overview.status).toBe(200);
    expect((overview.json.meta as { definition: { key: string } }).definition.key).toBe("locations");
    expect((await call(importRoute.GET, req("GET", "/api/imports/locations", { cookie: await cookieFor(w.viewerId) }), params)).status).toBe(403);
    expect((await call(importRoute.GET, req("GET", "/api/imports/zzz", { cookie: admin }), { key: "zzz" })).status).toBe(404);

    const template = await call(templateRoute.GET, req("GET", "/api/imports/locations/template", { cookie: admin }), params);
    expect(template.status).toBe(200);
    const bytes = new Uint8Array(await template.response.arrayBuffer());
    expect(String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0)).toBe("PK");

    const form = new FormData();
    form.set("file", new Blob(["Code,Foo\nA-1,x\n"], { type: "text/csv" }), "locations.csv");
    form.set("dryRun", "true");
    const preview = await call(importRoute.POST, req("POST", "/api/imports/locations", { cookie: admin, form }), params);
    expect(preview.status).toBe(200);
    expect(preview.data).toMatchObject({ totalRows: 1 });

    const real = new FormData();
    real.set("file", new Blob(["Code\nA-1\n"], { type: "text/csv" }), "locations.csv");
    const run = await call(importRoute.POST, req("POST", "/api/imports/locations", { cookie: admin, form: real }), params);
    expect(run.status).toBe(409);
    expect(run.json.code).toBe("INVALID_STATE");

    const viewerForm = new FormData();
    viewerForm.set("file", new Blob(["Code\nA\n"], { type: "text/csv" }), "l.csv");
    expect((await call(importRoute.POST, req("POST", "/api/imports/locations", { cookie: await cookieFor(w.viewerId), form: viewerForm }), params)).status).toBe(403);
    await expectCsrf(importRoute.POST, "POST", "/api/imports/locations", undefined, params);
  });

  it("returns batch details with row results", async () => {
    const w = current();
    const fileId = w.db.insert(schema.files).values({ name: "l.csv", mime: "text/csv", size: 1, sha256: "x", storagePath: "x" }).returning().get().id;
    const batchId = w.db.insert(schema.importBatches).values({
      importKey: "locations", status: "Partially Successful", masterRowCount: 2, successCount: 1, errorCount: 1, fileId, uploadedBy: w.userId,
    }).returning().get().id;
    w.db.insert(schema.importRows).values([
      { batchId, rowNumber: 2, success: true, data: "{}" },
      { batchId, rowNumber: 3, success: false, data: "{}", message: "Bad zone" },
    ]).run();
    const admin = await cookieFor(w.userId);
    const res = await call(batchRoute.GET, req("GET", `/api/imports/batches/${batchId}?errorsOnly=true`, { cookie: admin }), { id: batchId });
    expect(res.status).toBe(200);
    expect(asArray(res.data).map((r) => r.message)).toEqual(["Bad zone"]);
    expect(res.json.meta).toMatchObject({ total: 1, batch: { id: batchId } });
    expect((await call(batchRoute.GET, req("GET", `/api/imports/batches/${batchId}`, { cookie: await cookieFor(w.viewerId) }), { id: batchId })).status).toBe(403);
  });
});

describe("search and cron", () => {
  it("searches pages for the caller and validates the query", async () => {
    const cookie = await cookieFor(current().viewerId);
    const res = await call(searchRoute.GET, req("GET", "/api/search?q=inventory", { cookie }));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
    expect((await call(searchRoute.GET, req("GET", "/api/search?q=x", { cookie }))).status).toBe(400);
  });

  it("cron tick: 503 when unconfigured, 401 on a bad token, runs with the right bearer", async () => {
    const saved = process.env.CRON_SECRET;
    try {
      process.env.CRON_SECRET = "short";
      expect((await call(cronRoute.POST, req("POST", "/api/cron/tick", { csrf: false }))).status).toBe(503);
      const secret = "c".repeat(40);
      process.env.CRON_SECRET = secret;
      expect((await call(cronRoute.POST, req("POST", "/api/cron/tick", { csrf: false, headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
      const ok = await call(cronRoute.POST, req("POST", "/api/cron/tick", { csrf: false, headers: { authorization: `Bearer ${secret}` } }));
      expect(ok.status).toBe(200);
      expect(ok.data).toMatchObject({ status: "ran" });
      expect(tick).toHaveBeenCalledTimes(1);
    } finally {
      process.env.CRON_SECRET = saved;
    }
  });
});
