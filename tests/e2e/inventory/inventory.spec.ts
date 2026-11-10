/**
 * M06 inventory — e2e happy paths and guard paths against the shared dev app.
 * Every mutation is reverted at the end of its test so the shared DB keeps its totals.
 */
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures/auth";
import { expectNoA11yViolations } from "../fixtures/a11y";
import { e2eBaseUrl } from "../fixtures/roles";

const base = e2eBaseUrl();
const SKU = process.env.E2E_INVENTORY_SKU ?? "APX-TEE-BLK-M";
const LOCATION = process.env.E2E_INVENTORY_LOCATION ?? "E-01-01-2";
const ROW_URL = `/inventory/by-location?q=${SKU}&qm=eq&f.location=eq:${LOCATION}`;

// The shared dev server compiles routes on first hit and serves many agents; 10s API timeouts flake.
test.use({ actionTimeout: 45_000 });

interface Bucket { id: string; version: number; totalQty: number; sku: string; location: string; lpNumber: string | null; damageReason: string | null }

async function csrf(page: Page): Promise<string> {
  const c = (await page.context().cookies(base)).find((x) => x.name === "ks_csrf")?.value;
  if (c) return c;
  await page.request.get(`${base}/api/auth/csrf`);
  return (await page.context().cookies(base)).find((x) => x.name === "ks_csrf")?.value ?? "";
}

async function bucket(request: APIRequestContext): Promise<Bucket> {
  const res = await request.get(`${base}/api/inventory/by-location?q=${SKU}&qm=eq&f.location=eq:${LOCATION}`);
  const rows = (await res.json()).data as Bucket[];
  const b = rows.find((r) => !r.lpNumber && !r.damageReason);
  if (!b) throw new Error(`No plain Stock bucket for ${SKU} @ ${LOCATION}`);
  return b;
}

async function restoreQty(page: Page, qty: number): Promise<void> {
  const b = await bucket(page.request);
  if (b.totalQty === qty) return;
  const reasons = (await (await page.request.get(`${base}/api/inventory/reasons`)).json()).data;
  const res = await page.request.post(`${base}/api/inventory/buckets/${b.id}/quantity`, {
    headers: { "x-csrf-token": await csrf(page), Origin: base },
    data: { mode: "adjust", qty, reasonId: reasons.adjustmentReasons[0].id, note: "KS-TEST e2e restore", version: b.version },
  });
  expect(res.ok()).toBe(true);
}

async function waitForRows(page: Page): Promise<void> {
  await expect(page.getByRole("row").nth(1)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("[data-status]").first().or(page.getByText(/No inventory/))).toBeVisible({ timeout: 60_000 });
}

test.describe("inventory pages", () => {
  test.setTimeout(180_000);

  for (const path of ["/inventory", "/inventory/by-location", "/inventory/atp"]) {
    test(`${path} renders without console errors and passes axe`, async ({ adminPage: page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      await page.goto(path, { timeout: 120_000 });
      await expect(page.getByText(/^Total: \d/)).toBeVisible({ timeout: 90_000 });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // Shell / grid-header contrast is shared code: docs/requests/inventory.md REQ-3.
      await expectNoA11yViolations(page, { exclude: ["header", "nav", "thead"] });
      expect(errors.filter((e) => !/Download the React DevTools|HMR|Fast Refresh/.test(e))).toEqual([]);
    });
  }

  test("Total Inventory: SKU and Open SO links open pre-filtered lists in a new tab", async ({ adminPage: page }) => {
    await page.goto(`/inventory?q=${SKU}&qm=eq`, { timeout: 120_000 });
    const link = page.getByRole("link", { name: new RegExp(`Product ${SKU}`) }).first();
    await expect(link).toBeVisible({ timeout: 90_000 });
    await expect(link).toHaveAttribute("target", "_blank");
    expect(decodeURIComponent((await link.getAttribute("href")) ?? "")).toContain(`/products?f.sku=eq:${SKU}&f.clientId=in:`);
    await expect(page.getByRole("cell", { name: "All Warehouses" }).first()).toBeVisible();
  });

  test("ATP defaults to every warehouse in scope and explains the formulas", async ({ adminPage: page }) => {
    await page.goto("/inventory/atp", { timeout: 120_000 });
    await expect(page.getByText(/Current ATP = Undamaged − Open SO/)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/^Total: [1-9]/)).toBeVisible({ timeout: 90_000 });
  });

  test("Allocated rows have no ⋯ menu and explain why", async ({ adminPage: page }) => {
    await page.goto("/inventory/by-location?f.status=nin:Stock", { timeout: 120_000 });
    await waitForRows(page);
    const lock = page.getByLabel(/stock belongs to an order in progress/).first();
    await expect(lock).toBeVisible();
    await lock.focus();
    await expect(page.getByRole("tooltip")).toContainText("only available on Stock rows");
  });

  test("Adjust: Save stays disabled until valid, then posts the delta", async ({ adminPage: page }) => {
    const start = await bucket(page.request);
    try {
      await page.goto(ROW_URL, { timeout: 120_000 });
      await waitForRows(page);
      await page.getByRole("button", { name: `Actions for ${SKU} in ${LOCATION}` }).first().click();
      await page.getByRole("menuitem", { name: "Adjust" }).click();
      const drawer = page.getByRole("dialog", { name: "Adjust Inventory" });
      await expect(drawer).toBeVisible();
      await drawer.getByRole("button", { name: "Save" }).click();
      await expect(drawer.getByText("Enter a quantity")).toBeVisible();
      await drawer.getByLabel("New Quantity").fill(String(start.totalQty - 2));
      await drawer.getByLabel("Adjustment reason").click();
      await page.getByRole("option", { name: "Inventory quantity discrepancy" }).click();
      await drawer.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText(`${SKU} @ ${LOCATION}: ${start.totalQty} → ${start.totalQty - 2}`).first()).toBeVisible({ timeout: 30_000 });
      expect((await bucket(page.request)).totalQty).toBe(start.totalQty - 2);
    } finally {
      await restoreQty(page, start.totalQty);
    }
  });

  test("Transfer LP/Loc menu opens both drawers with Find", async ({ adminPage: page }) => {
    await page.goto("/inventory/by-location", { timeout: 120_000 });
    await waitForRows(page);
    for (const item of ["Transfer LP", "Transfer Location"]) {
      await page.getByRole("button", { name: "Transfer LP/Loc" }).click();
      await page.getByRole("menuitem", { name: item, exact: true }).click();
      const drawer = page.getByRole("dialog", { name: item });
      await expect(drawer.getByRole("button", { name: "Find" })).toBeVisible();
      await drawer.getByRole("button", { name: "Find" }).click();
      await expect(drawer.getByText(/is required\./)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
    }
  });

  test("Change Attributes needs a selection, then opens the single-field drawer", async ({ adminPage: page }) => {
    await page.goto(ROW_URL, { timeout: 120_000 });
    await waitForRows(page);
    const trigger = page.getByRole("button", { name: "Change Attributes" });
    await expect(trigger).toBeDisabled();
    await page.getByRole("row").nth(1).getByRole("checkbox").check();
    await expect(trigger).toBeEnabled();
    await trigger.click();
    await page.getByRole("menuitem", { name: "Change Lot/Batch Number" }).click();
    const drawer = page.getByRole("dialog", { name: "Change Lot/Batch Number" });
    await expect(drawer.getByText(/lot\/batch numbers that you have selected will be updated/)).toBeVisible();
  });

  test("Add Inventory shows inline errors for missing fields", async ({ adminPage: page }) => {
    await page.goto("/inventory/by-location", { timeout: 120_000 });
    const add = page.getByRole("button", { name: "Add Inventory" }).first();
    await expect(add).toBeEnabled({ timeout: 60_000 });
    await add.click();
    const drawer = page.getByRole("dialog", { name: "Add Inventory" });
    await drawer.getByRole("button", { name: "Save" }).click();
    await expect(drawer.getByText("Location is required")).toBeVisible();
    await expect(drawer.getByText("Quantity to Add is required")).toBeVisible();
  });

  test("viewer sees no mutation controls and the API refuses", async ({ viewerPage: page }) => {
    await page.goto("/inventory/by-location", { timeout: 120_000 });
    await expect(page.getByText(/^Total: /)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("button", { name: "Add Inventory" }).first()).toBeDisabled();
    const res = await page.request.post(`${base}/api/inventory/transfer-location`, {
      headers: { "x-csrf-token": await csrf(page), Origin: base },
      data: { fromLocationId: "x", target: { kind: "location", id: "y" } },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe("inventory transfers", () => {
  test.setTimeout(180_000);

  test("Transfer Product moves a partial quantity and lists the move", async ({ adminPage: page }) => {
    const start = await bucket(page.request);
    const TARGET = process.env.E2E_INVENTORY_TARGET ?? "F-01-01-2";
    try {
      await page.goto(ROW_URL, { timeout: 120_000 });
      await waitForRows(page);
      await page.getByRole("button", { name: `Actions for ${SKU} in ${LOCATION}` }).first().click();
      await page.getByRole("menuitem", { name: "Transfer product" }).click();
      const drawer = page.getByRole("dialog", { name: "Transfer Product" });
      await drawer.getByLabel("Transfer Product Quantity").fill("5");
      const target = drawer.getByRole("combobox").last();
      await target.click();
      await page.keyboard.type(TARGET);
      await page.getByRole("option", { name: new RegExp(TARGET) }).first().click();
      await drawer.getByRole("button", { name: "Transfer" }).click();
      await expect(page.getByText(`5 × ${SKU}: ${LOCATION} → ${TARGET}`).first()).toBeVisible({ timeout: 30_000 });
      expect((await bucket(page.request)).totalQty).toBe(start.totalQty - 5);
    } finally {
      const moved = ((await (await page.request.get(`${base}/api/inventory/by-location?q=${SKU}&qm=eq&f.location=eq:${TARGET}`)).json()).data as Bucket[])
        .find((r) => !r.lpNumber && !r.damageReason);
      const origin = await bucket(page.request);
      const missing = start.totalQty - origin.totalQty;
      if (moved && missing > 0) {
        const res = await page.request.post(`${base}/api/inventory/transfer-product`, {
          headers: { "x-csrf-token": await csrf(page), Origin: base },
          data: { inventoryId: moved.id, qty: missing, target: { kind: "location", id: (origin as unknown as { locationId: string }).locationId }, note: "KS-TEST e2e restore" },
        });
        expect(res.ok()).toBe(true);
      }
    }
  });
});
