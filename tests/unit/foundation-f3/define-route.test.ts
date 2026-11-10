import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { z } from "zod";
import { auditLog, users, warehouses } from "@/server/db/schema";
import type { AppDb } from "@/server/api/db";
import { CSRF_COOKIE, CSRF_HEADER, generateCsrfToken } from "@/server/auth/csrf-shared";
import { issueSession } from "@/server/auth/session-store";
import { seededDb, type SeededDb } from "./fixtures";

let current: SeededDb;
vi.mock("@/server/api/db", () => ({ getAppDb: async (): Promise<AppDb> => current.db }));

const { defineRoute } = await import("@/server/api/define-route");
const { created, listResult } = await import("@/server/api/envelope");
const { AppError } = await import("@/server/api/errors");

const BASE = "http://localhost:3000";

async function cookieFor(userId: string): Promise<string> {
  const { token } = await issueSession(current.db, userId);
  return `kitstak_session=${token}`;
}

function request(method: string, path: string, opts: { cookie?: string; csrf?: string | false; body?: unknown } = {}): NextRequest {
  const csrf = opts.csrf === undefined ? generateCsrfToken() : opts.csrf;
  const cookies = [opts.cookie, csrf ? `${CSRF_COOKIE}=${csrf}` : undefined].filter(Boolean).join("; ");
  const headers = new Headers({ host: "localhost:3000", origin: BASE });
  if (cookies) headers.set("cookie", cookies);
  if (csrf) headers.set(CSRF_HEADER, csrf);
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`${BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

const listRoute = defineRoute({
  permission: "settings.warehouse.view",
  handler: ({ db, grid }) => {
    const query = grid();
    const rows = db.select({ id: warehouses.id }).from(warehouses).all();
    return listResult(rows, { total: rows.length, page: query.page, pageSize: query.pageSize });
  },
});

const createRoute = defineRoute({
  body: z.object({ code: z.string().min(1), name: z.string().min(1) }),
  handler: ({ db, body }) => {
    db.insert(warehouses).values({ id: `wh-${body.code}`, code: body.code, name: body.name, addressLine: "a", city: "c", state: "s" }).run();
    if (body.name === "boom") throw new AppError("RULE_VIOLATION", "Not allowed");
    return created({ id: `wh-${body.code}` });
  },
});

describe("defineRoute", () => {
  beforeEach(() => {
    current = seededDb();
  });
  afterEach(() => current.close());

  it("401 without a session, 200 with one (envelope + meta)", async () => {
    expect((await listRoute(request("GET", "/api/wh"))).status).toBe(401);
    const res = await listRoute(request("GET", "/api/wh?ps=300", { cookie: await cookieFor(current.ids.admin) }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({ success: true, meta: { total: 2, page: 1, pageSize: 300 } });
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("403 + audit row when the permission is missing", async () => {
    const res = await listRoute(request("GET", "/api/wh", { cookie: await cookieFor(current.ids.viewer) }));
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ success: false, code: "FORBIDDEN" });
    expect(current.db.select().from(auditLog).all().some((a) => a.action === "security.permission_denied")).toBe(true);
  });

  it("400 VALIDATION for a malformed grid query", async () => {
    const res = await listRoute(request("GET", "/api/wh?f.x=bogus:1", { cookie: await cookieFor(current.ids.admin) }));
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ code: "VALIDATION" });
  });

  it("rejects mutations without a CSRF token (403 + audit)", async () => {
    const res = await createRoute(request("POST", "/api/wh", { cookie: await cookieFor(current.ids.admin), csrf: false, body: { code: "W9", name: "X" } }));
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ code: "CSRF" });
    expect(current.db.select().from(auditLog).all().some((a) => a.action === "security.csrf_rejected")).toBe(true);
  });

  it("validates bodies and returns fieldErrors", async () => {
    const res = await createRoute(request("POST", "/api/wh", { cookie: await cookieFor(current.ids.admin), body: { code: "" } }));
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(Object.keys(body.fieldErrors as object).sort()).toEqual(["code", "name"]);
  });

  it("commits on success (201) and rolls back on a domain error", async () => {
    const cookie = await cookieFor(current.ids.admin);
    expect((await createRoute(request("POST", "/api/wh", { cookie, body: { code: "W9", name: "Nine" } }))).status).toBe(201);
    const failed = await createRoute(request("POST", "/api/wh", { cookie, body: { code: "W8", name: "boom" } }));
    expect(failed.status).toBe(422);
    expect(await json(failed)).toMatchObject({ code: "RULE_VIOLATION", error: "Not allowed" });
    const codes = current.db.select({ code: warehouses.code }).from(warehouses).all().map((r) => r.code);
    expect(codes).toContain("W9");
    expect(codes).not.toContain("W8");
  });

  it("deactivating a user kills their session on the next request", async () => {
    const cookie = await cookieFor(current.ids.admin);
    expect((await listRoute(request("GET", "/api/wh", { cookie }))).status).toBe(200);
    current.db.update(users).set({ isActive: false }).where(eq(users.id, current.ids.admin)).run();
    expect((await listRoute(request("GET", "/api/wh", { cookie }))).status).toBe(401);
  });

  it("never leaks internal error details", async () => {
    const broken = defineRoute({ auth: "public", handler: () => { throw new Error("SQLITE_IOERR /secret/path"); } });
    const res = await broken(request("GET", "/api/x"));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("secret");
    expect(text).toContain("Internal server error");
  });

  it("rate limits mutations per user", async () => {
    const limited = defineRoute({ rateLimit: { name: "t", limit: 1, windowMs: 60_000 }, transaction: false, handler: () => ({ ok: true }) });
    const cookie = await cookieFor(current.ids.admin);
    expect((await limited(request("POST", "/api/t", { cookie, body: {} }))).status).toBe(200);
    const second = await limited(request("POST", "/api/t", { cookie, body: {} }));
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeTruthy();
  });

  it("refuses async handlers inside a transaction", async () => {
    const asyncTx = defineRoute({ handler: async () => ({ ok: true }) });
    const res = await asyncTx(request("POST", "/api/t", { cookie: await cookieFor(current.ids.admin), body: {} }));
    expect(res.status).toBe(500);
  });
});
