/**
 * M02 shipping — e2e:
 *  - unshipped shipment plans show no Actual Shipment (API null, grid dash);
 *  - Loading Started / Completed is refused while any order isn't Ready to Ship;
 *  - Print End of the Day report closes the manifest and stamps the close date;
 *  - viewer / operator role gating on label, EOD and plan actions.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/auth";
import { e2eBaseUrl } from "../fixtures/roles";

test.use({ actionTimeout: 45_000, navigationTimeout: 120_000 });
test.setTimeout(240_000);

interface PlanRow { id: string; code: string; status: string; actualShipmentAt: string | null; statusBlocks: Record<string, string>; version?: number }
interface EodRow { id: string; status: string; closeDate: string | null; isPrinted: boolean }

const LOADING = ["Loading Started", "Loading Completed"] as const;

/** Mutations need the double-submit CSRF token and a same-origin header. */
async function csrfHeaders(page: Page): Promise<Record<string, string>> {
  const base = e2eBaseUrl();
  let token = (await page.context().cookies(base)).find((c) => c.name === "ks_csrf")?.value;
  if (!token) {
    await page.request.get("/api/auth/csrf");
    token = (await page.context().cookies(base)).find((c) => c.name === "ks_csrf")?.value;
  }
  return { "x-csrf-token": token ?? "", Origin: base, Referer: `${base}/` };
}

test("unshipped plans have no actual shipment date (API and grid)", async ({ page }) => {
  const res = await page.request.get("/api/shipment-plans?ps=200", { timeout: 120_000 });
  expect(res.ok()).toBeTruthy();
  const rows = (await res.json()).data as PlanRow[];
  const unshipped = rows.filter((r) => r.status !== "Shipped");
  test.skip(unshipped.length === 0, "No unshipped plans in this DB");
  for (const r of unshipped) expect(r.actualShipmentAt, `${r.code} (${r.status})`).toBeNull();

  const plan = unshipped[0]!;
  await page.goto(`/shipment-plans?q=${encodeURIComponent(plan.code)}`);
  const row = page.getByRole("row").filter({ hasText: plan.code }).first();
  await expect(row).toBeVisible({ timeout: 120_000 });
  const header = page.getByRole("columnheader", { name: /actual shipment/i }).first();
  await expect(header).toBeVisible();
  const colIndex = await header.getAttribute("aria-colindex");
  if (colIndex) await expect(row.locator(`[aria-colindex="${colIndex}"]`)).toHaveText(/^\s*[—-]?\s*$/);
});

test("loading stages are refused until every order is Ready to Ship", async ({ page }) => {
  const res = await page.request.get("/api/shipment-plans?ps=200", { timeout: 120_000 });
  const rows = (await res.json()).data as PlanRow[];
  // Plans with no orders are blocked for a different reason ("Add orders to the plan before loading").
  const blocked = rows.find((r) => r.status !== "Shipped" && r.status !== "Cancelled" && LOADING.some((s) => s !== r.status && /ready to ship/i.test(r.statusBlocks?.[s] ?? "")));
  test.skip(!blocked, "No plan with orders waiting on Ready to Ship");
  const target = LOADING.find((s) => s !== blocked!.status && /ready to ship/i.test(blocked!.statusBlocks[s] ?? ""))!;
  expect(blocked!.statusBlocks[target]).toMatch(/ready to ship/i);
  const post = await page.request.post(`/api/shipment-plans/${blocked!.id}/status`, { data: { status: target }, headers: await csrfHeaders(page), timeout: 120_000 });
  expect(post.status()).toBeGreaterThanOrEqual(400);
  expect(post.status()).toBeLessThan(500);
  expect(JSON.stringify(await post.json())).toMatch(/ready to ship/i);
  const after = await page.request.get(`/api/shipment-plans?ps=200`, { timeout: 120_000 });
  const again = ((await after.json()).data as PlanRow[]).find((r) => r.id === blocked!.id)!;
  expect(again.status).toBe(blocked!.status);
});

test("printing the EOD report closes the manifest and sets the close date", async ({ page }) => {
  const list = await page.request.get("/api/end-of-day?ps=200", { timeout: 120_000 });
  const rows = (await list.json()).data as EodRow[];
  const open = rows.find((r) => r.status === "Open");
  test.skip(!open, "No open manifest in this DB");
  expect(open!.closeDate).toBeNull();
  const close = await page.request.post("/api/end-of-day/close", { data: { ids: [open!.id] }, headers: await csrfHeaders(page), timeout: 120_000 });
  expect(close.ok(), await close.text()).toBeTruthy();
  const after = await page.request.get("/api/end-of-day?ps=200", { timeout: 120_000 });
  // A pending manifest is stored on close, so it can come back under a new id: fall back to the latest closed one.
  const afterRows = (await after.json()).data as EodRow[];
  const row = afterRows.find((r) => r.id === open!.id)
    ?? afterRows.filter((r) => r.status === "Closed" && r.closeDate).sort((a, b) => String(b.closeDate).localeCompare(String(a.closeDate)))[0]!;
  expect(row.status).toBe("Closed");
  expect(row.closeDate).toBeTruthy();
  expect(row.isPrinted).toBe(true);
});

for (const role of ["viewer", "operator"] as const) {
  test(`${role}: supervisor shipping actions are refused`, async ({ asRole }) => {
    const p = await asRole(role);
    const eod = await p.request.post("/api/end-of-day/close", { data: { ids: ["x"] }, timeout: 120_000 });
    expect(eod.status()).toBe(403);
    const status = await p.request.post("/api/shipment-plans/x/status", { data: { status: "Loading Started" }, timeout: 120_000 });
    expect(status.status()).toBe(403);
    const voided = await p.request.post("/api/shipments/void", { data: { ids: ["x"] }, timeout: 120_000 });
    expect([403, 404, 405]).toContain(voided.status());
    if (role === "viewer") {
      const ret = await p.request.post("/api/ops/shipping/return-label", { data: { orderId: "x" }, timeout: 120_000 });
      expect(ret.status()).toBe(403);
    }
  });
}

test("viewer sees label actions disabled on /shipments", async ({ asRole }) => {
  const p = await asRole("viewer");
  await p.goto("/shipments");
  const first = p.getByRole("row").nth(1);
  await expect(first).toBeVisible({ timeout: 120_000 });
  await first.hover();
  const kebab = first.getByRole("button", { name: /actions|more/i }).first();
  test.skip(!(await kebab.count()), "No row action menu");
  await kebab.click();
  for (const name of [/void label/i, /create return label/i, /create retailer/i, /short label/i]) {
    const item = p.getByRole("menuitem", { name }).first();
    if (await item.count()) await expect(item).toHaveAttribute("aria-disabled", "true");
  }
});
