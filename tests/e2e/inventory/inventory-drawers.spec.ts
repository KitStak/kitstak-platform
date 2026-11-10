/**
 * M06 inventory: every drawer opened in a real browser, with a screenshot of each
 * (blind-judge round 3). Read-only: drawers are opened, validated and closed without saving.
 * Screenshots go to test-results/inventory-drawers/ (or E2E_SHOT_DIR).
 * Run on a warm server: npx playwright test tests/e2e/inventory/inventory-drawers.spec.ts --project=e2e
 */
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/auth";
import { e2eBaseUrl } from "../fixtures/roles";

const base = e2eBaseUrl();
const SHOTS = process.env.E2E_SHOT_DIR ?? path.join("test-results", "inventory-drawers");
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

test.use({ actionTimeout: 45_000 });
test.describe.configure({ timeout: 180_000 });

interface Row { id: string; location: string; lpNumber: string | null; allocatedQty: number }

async function firstRows(page: Page, query = ""): Promise<Row[]> {
  const res = await page.request.get(`${base}/api/inventory/by-location?ps=50${query}`, { timeout: 90_000 });
  return (await res.json()).data as Row[];
}

async function waitForRows(page: Page): Promise<void> {
  await expect(page.getByRole("row").nth(1)).toBeVisible({ timeout: 60_000 });
}

async function pick(page: Page, drawer: ReturnType<Page["getByRole"]>, text: string): Promise<void> {
  const input = drawer.locator("#tc-source");
  await input.click();
  await page.keyboard.type(text);
  await page.getByRole("option").filter({ hasText: text }).first().click({ timeout: 45_000 });
}

test.describe("inventory drawers (screenshots)", () => {
  test("Add Inventory", async ({ adminPage: page }) => {
    await page.goto("/inventory/by-location", { timeout: 120_000 });
    await page.getByRole("button", { name: "Add Inventory" }).first().click();
    const drawer = page.getByRole("dialog", { name: "Add Inventory" });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("button", { name: "Save" }).click();
    await expect(drawer.getByText("Location is required")).toBeVisible();
    await shot(page, "add-inventory");
  });

  test("Transfer LP and Transfer Location: Find, then the summary card", async ({ adminPage: page }) => {
    const rows = await firstRows(page);
    const lp = rows.find((r) => r.lpNumber)?.lpNumber;
    const loc = rows.find((r) => !r.lpNumber)?.location;
    await page.goto("/inventory/by-location", { timeout: 120_000 });
    await waitForRows(page);
    for (const [item, value] of [["Transfer LP", lp], ["Transfer Location", loc]] as const) {
      await page.getByRole("button", { name: "Transfer LP/Loc" }).click();
      await page.getByRole("menuitem", { name: item, exact: true }).click();
      const drawer = page.getByRole("dialog", { name: item });
      await expect(drawer.getByRole("button", { name: "Find" })).toBeVisible();
      if (value) {
        await pick(page, drawer, value);
        await drawer.getByRole("button", { name: "Find" }).click();
        await expect(drawer.getByRole("region", { name: "Contents" })).toBeVisible({ timeout: 60_000 });
      }
      await shot(page, item.toLowerCase().replace(/\s+/g, "-"));
      await page.keyboard.press("Escape");
      // A picked source makes the drawer dirty, so closing asks to confirm.
      const leave = page.getByRole("button", { name: "Leave" });
      if (await leave.isVisible().catch(() => false)) await leave.click();
      await expect(drawer).toBeHidden();
    }
  });

  test("Change Attributes: all four variants", async ({ adminPage: page }) => {
    // Only Stock rows are eligible; the first unfiltered row can be allocated.
    await page.goto("/inventory/by-location?f.status=in:Stock", { timeout: 120_000 });
    await waitForRows(page);
    await page.getByRole("row").nth(1).getByRole("checkbox").check();
    for (const name of ["Change Lot/Batch Number", "Change Expiry Date", "Change Production Date", "Change Damage Reason"]) {
      await page.getByRole("button", { name: "Change Attributes" }).click();
      await page.getByRole("menuitem", { name }).click();
      const drawer = page.getByRole("dialog", { name });
      await expect(drawer).toBeVisible();
      await shot(page, name.toLowerCase().replace(/[^a-z]+/g, "-"));
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
    }
  });

  test("Import Inventory: template, history grid and error details", async ({ adminPage: page }) => {
    await page.goto("/imports/inventory", { timeout: 120_000 });
    await expect(page.getByText("Download our excel template")).toBeVisible({ timeout: 60_000 });
    const tpl = await page.request.get(`${base}/api/imports/inventory/template`, { timeout: 90_000 });
    expect(tpl.status()).toBe(200);
    for (const h of ["Status", "Success", "Error"]) await expect(page.getByRole("columnheader", { name: h }).first()).toBeVisible();
    await shot(page, "import-history");
    const rowMenu = page.getByRole("row").nth(1).getByRole("button", { name: /actions|more/i });
    if (await rowMenu.count()) {
      await rowMenu.first().click();
      await page.getByRole("menuitem", { name: "Details" }).click();
      const drawer = page.getByRole("dialog");
      await expect(drawer.getByText("Show errors")).toBeVisible();
      await shot(page, "import-details");
    }
  });
});
