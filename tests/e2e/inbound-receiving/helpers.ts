/**
 * Shared helpers for the M05 browser specs: an API context with the CSRF header, JSON
 * unwrapping, a test PO factory, and `quietHmr` (on the shared dev server other modules'
 * edits push Fast Refresh rebuilds / "HMR hash mismatch" reloads to every open page; the
 * proxy drops those messages so a page under test is not reloaded mid-step. The app itself
 * is untouched and the socket stays connected.)
 */
import { request as pwRequest, type APIRequestContext, type APIResponse, type BrowserContext } from "@playwright/test";
import { expect } from "../fixtures/auth";
import { e2eBaseUrl, storageStatePath } from "../fixtures/roles";

export interface Api {
  readonly c: APIRequestContext;
  readonly h: Record<string, string>;
}

export async function api(): Promise<Api> {
  const c = await pwRequest.newContext({ baseURL: e2eBaseUrl(), storageState: storageStatePath("admin"), timeout: 30_000 });
  await c.get("/api/auth/csrf");
  const token = (await c.storageState()).cookies.find((k) => k.name === "ks_csrf")?.value ?? "";
  return { c, h: { "x-csrf-token": token } };
}

export async function json<T>(res: APIResponse): Promise<T> {
  expect(res.status(), await res.text()).toBeLessThan(300);
  return ((await res.json()) as { data: T }).data;
}

const DROP = /"(type|action)":"(reloadPage|serverComponentChanges|serverOnlyChanges|built|building|rebuilding)"|"type":"turbopack-message"/;

export async function quietHmr(context: BrowserContext): Promise<void> {
  await context.routeWebSocket((url) => url.pathname.includes("hmr"), (ws) => {
    const server = ws.connectToServer();
    server.onMessage((m) => { if (!(typeof m === "string" && DROP.test(m) && !m.includes('"type":"sync"'))) ws.send(m); });
    ws.onMessage((m) => server.send(m));
  });
}

export interface TestPo {
  readonly id: string;
  readonly code: string;
  readonly lines: readonly { readonly id: string }[];
}

export const TEST_SKU = "CPL-MUG-12OZ";

/** A Pending PO for the non-tracked Copperline mug at MLT1 (KS-TEST-* records on the dev DB). */
export async function createTestPo(a: Api, code: string, qty = 5, vendorId?: string): Promise<{ po: TestPo; barcode: string; vendorId: string }> {
  const product = (await json<{ id: string; clientId: string; sku: string; barcode: string }[]>(await a.c.get(`/api/products?q=${TEST_SKU}&ps=5`))).find((p) => p.sku === TEST_SKU);
  const wh = (await json<{ id: string; code: string }[]>(await a.c.get("/api/warehouses?q=MLT1&ps=10"))).find((w) => w.code === "MLT1");
  const vendor = vendorId ?? (await json<{ id: string }[]>(await a.c.get(`/api/vendors?ps=1&clientId=${product?.clientId}&active=1`)))[0]?.id;
  const po = await json<TestPo>(await a.c.post("/api/purchase-orders", {
    headers: a.h,
    data: { warehouseId: wh?.id, clientId: product?.clientId, vendorId: vendor, code, poType: "Purchase Order", poDate: new Date().toISOString(), lines: [{ productId: product?.id, orderedQuantity: qty, unitCost: 1 }] },
  }));
  return { po, barcode: product?.barcode ?? TEST_SKU, vendorId: vendor ?? "" };
}

export const stamp = (): string => Date.now().toString(36).toUpperCase();
