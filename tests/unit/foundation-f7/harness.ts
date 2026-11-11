/**
 * Integration harness for F7 route handlers: real `defineRoute` pipeline (session,
 * CSRF, permission, zod, transaction, envelope) against an in-memory migrated DB.
 *
 * Each test file must declare, before importing any route:
 *   vi.mock("@/server/api/db", () => ({ getAppDb: async () => current().db }));
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { expect } from "vitest";
import * as schema from "@/server/db/schema";
import type { AppDb } from "@/server/api/db";
import { CSRF_COOKIE, CSRF_HEADER, generateCsrfToken } from "@/server/auth/csrf-shared";
import { issueSession } from "@/server/auth/session-store";
import { createWorld, type World } from "../foundation/domain/fixtures";

const FILES_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "ks-f7-files-"));
process.env.KITSTAK_FILES_DIR = FILES_ROOT;

export const BASE = "http://localhost:3000";

export interface F7World extends World {
  readonly viewerId: string;
  readonly operatorId: string;
  /** A second warehouse the viewer/operator are NOT linked to. */
  readonly otherWarehouseId: string;
}

let world: F7World | null = null;

export function current(): F7World {
  if (!world) throw new Error("F7 world not initialised: call openWorld() in beforeEach");
  return world;
}

/** Admin (from the domain world) + viewer (one warehouse, one client) + operator. */
export async function openWorld(): Promise<F7World> {
  const w = await createWorld();
  const db = w.db;
  const otherWarehouseId = (await db.insert(schema.warehouses).values({
    code: "RNO1", name: "Reno", addressLine: "1 Desert Rd", city: "Reno", state: "NV",
  }).returning())[0].id;
  const viewerId = (await db.insert(schema.users).values({
    email: "viewer@test.io", name: "Viewer", passwordHash: "x", role: "viewer", allClients: false,
  }).returning())[0].id;
  const operatorId = (await db.insert(schema.users).values({
    email: "operator@test.io", name: "Operator", passwordHash: "x", role: "operator", allClients: false,
  }).returning())[0].id;
  for (const userId of [viewerId, operatorId]) {
    await db.insert(schema.userWarehouses).values({ userId, warehouseId: w.warehouseId });
    await db.insert(schema.userClients).values({ userId, clientId: w.clientId });
  }
  world = { ...w, viewerId, operatorId, otherWarehouseId };
  return world;
}

export function closeWorld(): void {
  world?.close();
  world = null;
}

export function removeFilesRoot(): void {
  fs.rmSync(FILES_ROOT, { recursive: true, force: true });
}

export async function cookieFor(userId: string): Promise<string> {
  const { token } = await issueSession(current().db as AppDb, userId);
  return `kitstak_session=${token}`;
}

export interface ReqOptions {
  readonly cookie?: string;
  /** false = omit the CSRF cookie + header. */
  readonly csrf?: false;
  readonly body?: unknown;
  readonly form?: FormData;
  readonly headers?: Readonly<Record<string, string>>;
}

export function req(method: string, url: string, opts: ReqOptions = {}): NextRequest {
  const token = opts.csrf === false ? null : generateCsrfToken();
  const cookies = [opts.cookie, token ? `${CSRF_COOKIE}=${token}` : undefined].filter(Boolean).join("; ");
  const headers = new Headers({ host: "localhost:3000", origin: BASE, ...(opts.headers ?? {}) });
  if (cookies) headers.set("cookie", cookies);
  if (token) headers.set(CSRF_HEADER, token);
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(opts.body);
  }
  return new NextRequest(`${BASE}${url}`, { method, headers, body });
}

type Handler = (request: NextRequest, segment?: { params: Promise<Record<string, string | string[] | undefined>> }) => Promise<Response>;

export interface Called {
  readonly status: number;
  readonly json: Record<string, unknown>;
  readonly data: unknown;
  readonly response: Response;
}

export async function call(handler: Handler, request: NextRequest, params: Record<string, string> = {}): Promise<Called> {
  const response = await handler(request, { params: Promise.resolve(params) });
  const type = response.headers.get("content-type") ?? "";
  const json = type.includes("application/json") ? ((await response.clone().json()) as Record<string, unknown>) : {};
  return { status: response.status, json, data: json.data, response };
}

/** Asserts a mutation is refused for a viewer (403 FORBIDDEN) and without CSRF (403 CSRF). */
export async function expectGuarded(handler: Handler, method: string, url: string, body: unknown, params: Record<string, string> = {}): Promise<void> {
  const w = current();
  const viewer = await call(handler, req(method, url, { cookie: await cookieFor(w.viewerId), body }), params);
  expect(viewer.status, `${method} ${url} as viewer`).toBe(403);
  expect(viewer.json.code).toBe("FORBIDDEN");
  const noCsrf = await call(handler, req(method, url, { cookie: await cookieFor(w.userId), body, csrf: false }), params);
  expect(noCsrf.status, `${method} ${url} without CSRF`).toBe(403);
  expect(noCsrf.json.code).toBe("CSRF");
}

/** Asserts a mutation without CSRF is refused even for the admin. */
export async function expectCsrf(handler: Handler, method: string, url: string, body: unknown, params: Record<string, string> = {}): Promise<void> {
  const res = await call(handler, req(method, url, { cookie: await cookieFor(current().userId), body, csrf: false }), params);
  expect(res.status, `${method} ${url} without CSRF`).toBe(403);
  expect(res.json.code).toBe("CSRF");
}

export const asArray = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? (value as Record<string, unknown>[]) : []);
