/**
 * BUILD_PLAN F8.4 — `/dev/ui` shows every primitive, the wizard in both modes and the
 * grid with all toolbar features on seeded data. This is the automated half of the
 * critic sign-off: it proves the showcase is complete and behaves; the visual
 * judgement stays with the critic.
 *
 * Runs against the shared app on a freshly reset database:
 * `npm run db:reset && npx playwright test --project=e2e tests/e2e/foundation/dev-ui.spec.ts`.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures/auth";

const SECTIONS = ["display", "inputs", "overlays", "navigation", "forms", "wizard", "grid"] as const;
const STATUS_DOMAINS = ["Shipment order", "Purchase order", "Job", "Task", "Count", "Return", "Shipment plan", "End of day", "Label type", "Export"] as const;
const INPUT_SPECIMENS = ["Text field", "Textarea", "Number input", "Select", "Combobox", "Date picker", "Date-time picker", "Time picker", "Date range picker", "Chip input", "Color swatches", "Checkbox", "Switch", "Yes / No toggle", "Segmented control", "Radio cards", "File dropzone"] as const;
const OVERLAY_SPECIMENS = ["Dialogs", "Confirm dialog", "Drawer", "Toasts", "Tooltips", "Popover"] as const;
const PAGE_LOAD_TIMEOUT_MS = 120_000;
const MIN_SEEDED_ROWS = 50;

/** Hydration and React DOM-nesting errors mean the page is broken even if it looks right. */
const FATAL_CONSOLE = /hydrat|cannot be a child of|cannot contain a nested/i;

async function openShowcase(page: Page): Promise<string[]> {
  const fatal: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && FATAL_CONSOLE.test(msg.text())) fatal.push(msg.text().slice(0, 300));
  });
  await page.goto("/dev/ui", { timeout: PAGE_LOAD_TIMEOUT_MS });
  await expect(page.getByRole("heading", { name: "UI Showcase", level: 1 })).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT_MS });
  await expect(page.locator("#grid tbody tr").first()).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT_MS });
  return fatal;
}

function pageWizard(page: Page): Locator {
  return page.locator("#wizard");
}

test.describe("F8.4 /dev/ui showcase", () => {
  test.describe.configure({ mode: "serial" });

  test("lists every section and primitive without hydration errors", async ({ adminPage }) => {
    test.setTimeout(PAGE_LOAD_TIMEOUT_MS * 2);
    const fatal = await openShowcase(adminPage);
    for (const id of SECTIONS) await expect(adminPage.locator(`section#${id}`), `section #${id}`).toHaveCount(1);
    const display = adminPage.locator("#display");
    for (const label of STATUS_DOMAINS) await expect(display.getByText(label, { exact: true }).first(), `status map ${label}`).toBeVisible();
    const inputs = adminPage.locator("#inputs");
    for (const label of INPUT_SPECIMENS) await expect(inputs.getByText(label).first(), `input ${label}`).toBeVisible();
    const overlays = adminPage.locator("#overlays");
    for (const label of OVERLAY_SPECIMENS) await expect(overlays.getByText(label).first(), `overlay ${label}`).toBeVisible();
    expect(fatal, "hydration / DOM nesting errors").toEqual([]);
  });

  test("wizard: linear mode locks unreached steps and validates per step", async ({ adminPage }) => {
    test.setTimeout(PAGE_LOAD_TIMEOUT_MS * 2);
    await openShowcase(adminPage);
    const wizard = pageWizard(adminPage);
    await expect(wizard.getByRole("radio", { name: "Linear (create)" })).toHaveAttribute("aria-checked", "true");
    await expect(wizard.getByRole("button", { name: /^Step 2/ })).toBeDisabled();
    await expect(wizard.getByRole("button", { name: /^Step 3/ })).toBeDisabled();
    await wizard.getByRole("button", { name: "Next", exact: true }).first().click();
    await expect(wizard.getByRole("alert").filter({ hasText: "SKU is required" }).first()).toBeVisible();
    await expect(wizard.getByRole("alert").filter({ hasText: "Name is required" }).first()).toBeVisible();
    await expect(wizard.locator('input[name="sku"]').first()).toBeFocused();
  });

  test("wizard: free mode makes every step clickable with edit defaults", async ({ adminPage }) => {
    test.setTimeout(PAGE_LOAD_TIMEOUT_MS * 2);
    await openShowcase(adminPage);
    const wizard = pageWizard(adminPage);
    await wizard.getByRole("radio", { name: "Free (edit)" }).click();
    const shipping = wizard.getByRole("button", { name: /^Step 3/ });
    await expect(shipping).toBeEnabled();
    await shipping.click();
    await expect(wizard.getByText("Preferred carrier")).toBeVisible();
    await expect(wizard.getByText("KIT-STARTER")).toBeVisible();
    await expect(wizard.getByText("Drawer variant (pills)")).toBeVisible();
  });

  test("grid: seeded rows with every toolbar feature", async ({ adminPage }) => {
    test.setTimeout(PAGE_LOAD_TIMEOUT_MS * 2);
    await openShowcase(adminPage);
    const grid = adminPage.locator("#grid");
    expect(await grid.locator("tbody tr").count()).toBeGreaterThanOrEqual(MIN_SEEDED_ROWS);
    await expect(grid.getByRole("button", { name: /^Search mode/ })).toBeVisible();
    await expect(grid.getByRole("button", { name: "Views", exact: true })).toBeVisible();
    await expect(grid.getByRole("button", { name: "Actions", exact: true })).toBeVisible();
    await expect(grid.getByRole("button", { name: "Export As Excel", exact: true })).toBeVisible();
    await expect(grid.getByText("Show 100 items")).toBeAttached();
    await expect(grid.getByRole("button", { name: /^Move .* column$/ }).first()).toBeVisible();

    const filter = grid.getByRole("button", { name: "Filter", exact: true });
    await filter.click();
    await expect(filter).toHaveAttribute("aria-expanded", "true");
    const builder = adminPage.getByRole("dialog");
    await expect(builder.getByText("Status", { exact: true })).toBeVisible();
    await adminPage.keyboard.press("Escape");

    await grid.getByRole("checkbox", { name: "Select row" }).first().check();
    await expect(grid.getByText(/Selected: 1/)).toBeVisible();
    await expect(grid.getByRole("button", { name: "Create job" })).toBeEnabled();
  });

  test("viewer without screen configuration lands on the 403 page", async ({ viewerPage }) => {
    test.setTimeout(PAGE_LOAD_TIMEOUT_MS);
    await viewerPage.goto("/dev/ui", { timeout: PAGE_LOAD_TIMEOUT_MS });
    await expect(viewerPage).toHaveURL(/\/forbidden/);
  });
});
