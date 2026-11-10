/**
 * M10 facility-config — e2e acceptance against the shared dev app.
 *
 *   1. KS-E2E-LOC-01 created through the Create location wizard; barcode defaults to the code.
 *   2. Location generator: a 12-code pattern creates 12, the same pattern again creates 0.
 *   3. LP numbers from a fresh LP type's sequence: <prefix>00001..00003 and a 3-label PDF.
 *   4. SSCC18 without a client is rejected inline (no raw field key in the copy).
 *   5. Shipment package create toast copy.
 *
 * Test records are prefixed KS-E2E / KSE and removed again where they would pile up
 * (generated bins, per-run LP types are kept small and uniquely named).
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/auth";
import { e2eBaseUrl } from "../fixtures/roles";
import { PACKAGE_CREATED_MESSAGE } from "@/lib/grid-defs/facility/shipment-packages";

const base = e2eBaseUrl();
const LOC_CODE = "KS-E2E-LOC-01";

// Shared dev server: first hits compile routes, so API calls get generous timeouts.
test.use({ actionTimeout: 45_000 });


async function csrf(page: Page): Promise<string> {
  const read = async () => (await page.context().cookies(base)).find((c) => c.name === "ks_csrf")?.value;
  const existing = await read();
  if (existing) return existing;
  await page.request.get(`${base}/api/auth/csrf`);
  return (await read()) ?? "";
}

async function api<T>(page: Page, method: "GET" | "POST" | "DELETE", path: string, data?: unknown): Promise<{ status: number; body: { data: T; error?: string; code?: string; fieldErrors?: Record<string, string[]> } }> {
  const headers: Record<string, string> = method === "GET" ? {} : { "x-csrf-token": await csrf(page), Origin: base };
  const res = await page.request.fetch(`${base}${path}`, { method, headers, data, timeout: 90_000 });
  return { status: res.status(), body: await res.json() };
}

async function mainWarehouse(page: Page): Promise<{ id: string; code: string }> {
  const { body } = await api<{ id: string; code: string }[]>(page, "GET", "/api/warehouses?pageSize=50");
  const wh = body.data.find((w) => w.code === "MLT1") ?? body.data[0];
  if (!wh) throw new Error("No warehouse in scope");
  return wh;
}

test.describe("facility config", () => {
  test.setTimeout(240_000);

  test("Create location wizard: KS-E2E-LOC-01 gets barcode = code and a blank walking path", async ({ adminPage: page }) => {
    const existing = await api<{ id: string; code: string; storedUnits: number }[]>(page, "GET", `/api/locations?q=${LOC_CODE}&qm=eq`);
    const old = existing.body.data.find((r) => r.code === LOC_CODE);
    if (old && old.storedUnits === 0) await api(page, "DELETE", `/api/locations/${old.id}`);
    const wh = await mainWarehouse(page);

    await page.goto("/locations", { timeout: 120_000 });
    await page.getByRole("button", { name: "Create location" }).first().click();
    const drawer = page.getByRole("dialog", { name: /Create location/ });
    await drawer.getByLabel("Location code").fill(LOC_CODE);
    const warehouse = drawer.getByLabel("Warehouse");
    if (!(await warehouse.textContent())?.includes(wh.code)) {
      await warehouse.click();
      await page.getByRole("option", { name: new RegExp(`^${wh.code}`) }).click();
    }
    // Area type is required (Logiwa parity).
    await drawer.getByRole("combobox", { name: "Area type" }).click();
    await page.getByRole("option", { name: /^Picking/ }).first().click();
    await drawer.getByRole("button", { name: /^Next/ }).click();
    await drawer.getByRole("button", { name: /^Next/ }).click();
    await drawer.getByRole("button", { name: /^Back/ }).click(); // every step can go back
    await drawer.getByRole("button", { name: /^Next/ }).click();
    await drawer.getByRole("button", { name: "Create location" }).click();
    await expect(page.getByText(`Location ${LOC_CODE} created.`).first()).toBeVisible({ timeout: 30_000 });

    const after = await api<{ id: string; code: string; barcode: string; walkingPathPriority: number | null; level: string | null }[]>(page, "GET", `/api/locations?q=${LOC_CODE}&qm=eq`);
    const row = after.body.data.find((r) => r.code === LOC_CODE);
    expect(row?.barcode).toBe(LOC_CODE);
    expect(row?.walkingPathPriority).toBeNull();
    expect(row?.level).toBeNull();

    // Detail tab state survives a reload.
    await page.goto(`/locations/${row?.id}?tab=ledger`, { timeout: 120_000 });
    await expect(page.getByRole("tab", { name: /Ledger/ })).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
    await page.getByRole("tab", { name: /open tasks/i }).click();
    await expect(page).toHaveURL(/tab=tasks/);
    await page.reload();
    await expect(page.getByRole("tab", { name: /open tasks/i })).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
  });

  test("Generator: 12 codes, then the same pattern creates 0", async ({ adminPage: page }) => {
    const wh = await mainWarehouse(page);
    const prefix = `KSG${Date.now().toString(36).slice(-4).toUpperCase()}`;
    const spec = {
      warehouseId: wh.id, zone: prefix, separator: "-",
      aisles: { from: "A", to: "B" }, racks: { from: "01", to: "03" }, levels: { from: "1", to: "2" }, positions: { from: "", to: "" },
      locationType: "Shelves", areaType: "Picking", locationZoneId: null, locationGroupId: null, walkingPathStart: 1, walkingPathStep: 1,
    };
    const preview = await api<{ total: number; collisionCount: number }>(page, "POST", "/api/locations/generator/preview", spec);
    expect(preview.body.data).toMatchObject({ total: 12, collisionCount: 0 });
    const first = await api<{ created: number; skipped: number }>(page, "POST", "/api/locations/generator", { ...spec, skipExisting: false });
    expect(first.body.data.created).toBe(12);
    const second = await api<{ created: number; skipped: number }>(page, "POST", "/api/locations/generator", { ...spec, skipExisting: true });
    expect(second.body.data).toMatchObject({ created: 0, skipped: 12 });

    // UI: the same pattern shows 12 collisions and a singular button for a 1-code pattern.
    await page.goto("/locations", { timeout: 120_000 });
    await page.getByRole("button", { name: "Generate locations" }).first().click();
    const drawer = page.getByRole("dialog", { name: /Generate locations/ });
    await drawer.getByLabel("Code prefix").fill(prefix);
    // The collision check runs once the aisle and rack ranges are filled.
    await drawer.getByLabel("Aisles from").fill("A");
    await drawer.getByLabel("Aisles to").fill("B");
    await drawer.getByLabel("Racks from").fill("01");
    await drawer.getByLabel("Racks to").fill("03");
    await drawer.getByLabel("Levels from").fill("1");
    await drawer.getByLabel("Levels to").fill("2");
    await expect(drawer.getByText(/12 codes already exist/).first()).toBeVisible({ timeout: 30_000 });
    await drawer.getByLabel("Aisles to").fill("A");
    await drawer.getByLabel("Racks to").fill("01");
    await drawer.getByLabel("Levels from").fill("");
    await drawer.getByLabel("Levels to").fill("");
    await drawer.getByLabel("Racks from").fill("09");
    await drawer.getByLabel("Racks to").fill("09");
    await expect(drawer.getByRole("button", { name: "Create 1 location", exact: true })).toBeVisible({ timeout: 30_000 });
    await drawer.getByRole("button", { name: "Cancel" }).click();

    const list = await api<{ id: string; code: string }[]>(page, "GET", `/api/locations?q=${prefix}&pageSize=50`);
    const ids = list.body.data.filter((r) => r.code.startsWith(prefix)).map((r) => r.id);
    expect(ids).toHaveLength(12);
    await api(page, "POST", "/api/locations/bulk-delete", { ids });
  });

  test("LP numbers from sequence: 00001..00003 and a 3-label PDF", async ({ adminPage: page }) => {
    const wh = await mainWarehouse(page);
    const tag = Date.now().toString(36).slice(-4).toUpperCase();
    const type = await api<{ id: string }>(page, "POST", "/api/lp-types", {
      warehouseId: wh.id, code: `KS-E2E-TOTE-${tag}`, numberPrefix: `KSE${tag}-`, numberLength: 5, description: "KS-TEST e2e tote",
      length: 0, width: 0, height: 0, dimensionUnit: "Inch", weightUnit: "Ounce", emptyWeight: 0, maxWeight: 0, volumeUnit: "Cubic Inch", maxVolume: 0,
    });
    expect(type.status).toBe(201);
    const created = await api<{ created: number; numbers: string[] }>(page, "POST", "/api/lp-numbers", { warehouseId: wh.id, lpTypeId: type.body.data.id, method: "sequence", count: 3, isSscc18: false });
    expect(created.body.data.numbers).toEqual([`KSE${tag}-00001`, `KSE${tag}-00002`, `KSE${tag}-00003`]);

    const list = await api<{ id: string; number: string }[]>(page, "GET", `/api/lp-numbers?q=KSE${tag}-&pageSize=10`);
    const ids = list.body.data.map((r) => r.id);
    const labels = await api<Record<string, unknown>[]>(page, "POST", "/api/lp-numbers/labels", { ids });
    expect(labels.body.data).toHaveLength(3);
    const print = await api<{ url: string; mime: string }>(page, "POST", "/api/print", { typeKey: "lp-label", records: labels.body.data, options: { copies: 1 } });
    expect(print.body.data.mime).toBe("application/pdf");
    const pdf = await page.request.get(`${base}${print.body.data.url}`);
    // The renderer writes compressed object streams, so count pages with a real parser.
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(await pdf.body())).getPageCount()).toBe(3);
  });

  test("SSCC18 without a client: inline error, no raw field key", async ({ adminPage: page }) => {
    const wh = await mainWarehouse(page);
    const types = await api<{ id: string }[]>(page, "GET", `/api/lp-types?f.warehouseId=in:${wh.id}&pageSize=1`);
    const res = await api(page, "POST", "/api/lp-numbers", { warehouseId: wh.id, lpTypeId: types.body.data[0]?.id, method: "sequence", count: 1, isSscc18: true, clientId: null });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors?.clientId).toEqual(["Client is required for SSCC18 numbers"]);
    const zero = await api(page, "POST", "/api/lp-numbers", { warehouseId: wh.id, lpTypeId: types.body.data[0]?.id, method: "sequence", count: 0 });
    expect(zero.body.fieldErrors?.count).toEqual(["Enter a count of at least 1"]);

    await page.goto("/settings/lp-numbers", { timeout: 120_000 });
    await page.getByRole("button", { name: /Create LP number/ }).first().click();
    const drawer = page.getByRole("dialog", { name: /Create LP number/ });
    // The drawer's warehouse defaults load right after it opens and shift the layout, so retry
    // the toggle until it sticks instead of racing that first paint.
    const ssccYes = drawer.getByRole("radiogroup", { name: "SSCC18" }).getByRole("radio", { name: "Yes" });
    await expect(async () => {
      await ssccYes.click();
      await expect(ssccYes).toHaveAttribute("aria-checked", "true", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await drawer.getByRole("button", { name: /^Create/ }).click();
    await expect(drawer.getByText(/Client is required/)).toBeVisible();
    await expect(page.getByText(/clientId/)).toHaveCount(0);
  });

  test("Shipment package create shows the success copy", async ({ adminPage: page }) => {
    const wh = await mainWarehouse(page);
    const code = `KS-E2E-BOX-${Date.now().toString(36).slice(-4).toUpperCase()}`;
    await page.goto("/settings/shipment-packages", { timeout: 120_000 });
    await page.getByRole("button", { name: "Create shipment package" }).first().click();
    const drawer = page.getByRole("dialog", { name: /shipment package/i });
    await drawer.getByLabel("Code").fill(code);
    const warehouse = drawer.getByLabel("Warehouse");
    if (!(await warehouse.textContent())?.includes(wh.code)) {
      await warehouse.click();
      await page.getByRole("option", { name: new RegExp(`^${wh.code}`) }).click();
    }
    for (const label of ["Length", "Width", "Height"]) await drawer.getByRole("spinbutton", { name: label, exact: true }).fill("10");
    for (let step = 0; step < 3; step += 1) await drawer.getByRole("button", { name: /^Next/ }).click();
    await drawer.getByRole("button", { name: "Finish", exact: true }).click();
    await expect(page.getByText(`${PACKAGE_CREATED_MESSAGE}: ${code}.`).first()).toBeVisible({ timeout: 30_000 });

    const list = await api<{ id: string; code: string }[]>(page, "GET", `/api/shipment-packages?q=${code}`);
    const id = list.body.data.find((r) => r.code === code)?.id;
    if (id) await api(page, "DELETE", `/api/shipment-packages/${id}`);
  });
});
