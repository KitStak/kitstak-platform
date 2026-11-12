/**
 * M04 stations-returns — e2e against the shared dev app (admin).
 *   - Owned routes render without console errors and pass axe (shell/grid header excluded).
 *   - Pack an order keyboard-only: wrong SKU rejected, over-pack blocked, 2 boxes (F2), Get Rate, F9.
 *   - Create RMA wizard (shipped-order picker, back/next validation) → Return Station receive (Restock).
 *   - Change status offers only legal moves; a cancelled RMA can't be received.
 * Setup data is created through the public APIs and tagged KS-TEST.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '../fixtures/auth';
import { expectNoA11yViolations } from '../fixtures/a11y';
import { e2eBaseUrl } from '../fixtures/roles';

const base = e2eBaseUrl();
const WAREHOUSE = process.env.E2E_WAREHOUSE_CODE ?? 'MLT1';
const STATION = process.env.E2E_PACK_STATION ?? 'PACK-01';
const SKU_A = process.env.E2E_PACK_SKU_A ?? 'APX-TEE-WHT-M';
const SKU_B = process.env.E2E_PACK_SKU_B ?? 'APX-TEE-NVY-M';
const WRONG_SKU = process.env.E2E_PACK_WRONG_SKU ?? 'APX-TEE-BLK-M';
const RETURN_STATION = process.env.E2E_RETURN_STATION ?? 'RET-01';
// Virtual locations (e.g. MLT1-RTN) are never return targets, so use a physical Returns-area bin.
const RETURN_TARGET = process.env.E2E_RETURN_TARGET ?? 'RET-02';

// The shared dev server compiles routes on first hit and serves many agents.
test.use({ actionTimeout: 45_000 });

interface Envelope<T> {
  readonly success: boolean;
  readonly data: T;
}

async function csrf(page: Page): Promise<string> {
  const c = (await page.context().cookies(base)).find((x) => x.name === 'ks_csrf')?.value;
  if (c) return c;
  await page.request.get(`${base}/api/auth/csrf`);
  return (await page.context().cookies(base)).find((x) => x.name === 'ks_csrf')?.value ?? '';
}

async function getJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(`${base}${path}`, { timeout: 120_000 });
  expect(res.ok(), `${path} → ${res.status()}`).toBe(true);
  return ((await res.json()) as Envelope<T>).data;
}

async function postJson<T>(page: Page, path: string, data: unknown): Promise<T> {
  const res = await page.request.post(`${base}${path}`, {
    data,
    headers: { 'x-csrf-token': await csrf(page), Origin: base },
    timeout: 120_000,
  });
  const body = (await res.json()) as Envelope<T> & { error?: string };
  expect(res.ok(), `${path} → ${res.status()} ${body.error ?? ''}`).toBe(true);
  return body.data;
}

interface Ids {
  warehouseId: string;
  stationId: string;
  productA: { id: string; clientId: string };
  productB: { id: string };
  jobTypeId: string;
}

async function ids(page: Page): Promise<Ids> {
  const me = await getJson<{ contextOptions: { warehouses: { id: string; code: string }[] } }>(
    page.request,
    '/api/me',
  );
  const warehouseId = me.contextOptions.warehouses.find((w) => w.code === WAREHOUSE)?.id ?? '';
  const stations = await getJson<{ id: string; code: string }[]>(
    page.request,
    `/api/packing/stations?warehouseId=${warehouseId}`,
  );
  const product = async (sku: string) =>
    (
      await getJson<{ id: string; label: string; meta: { clientId: string } }[]>(
        page.request,
        `/api/pickers/products?q=${sku}`,
      )
    ).find((p) => p.label === sku);
  const a = await product(SKU_A);
  const b = await product(SKU_B);
  const jobTypes = await getJson<{ id: string; warehouseId: string; template: string }[]>(
    page.request,
    '/api/job-types?q=Multi',
  );
  const jobTypeId =
    jobTypes.find((j) => j.warehouseId === warehouseId && j.template === 'Multi-Item Orders')?.id ?? '';
  expect(warehouseId && a && b && jobTypeId && stations.length).toBeTruthy();
  return {
    warehouseId,
    stationId: stations.find((s) => s.code === STATION)?.id ?? '',
    productA: { id: a!.id, clientId: a!.meta.clientId },
    productB: { id: b!.id },
    jobTypeId,
  };
}

/** Creates a KS-TEST order (2× A, 1× B), allocates, picks it into the packing station → Ready to Pack. */
async function readyToPackOrder(page: Page, x: Ids): Promise<{ id: string; code: string }> {
  const order = await postJson<{ id: string; code: string }>(page, '/api/orders', {
    warehouseId: x.warehouseId,
    clientId: x.productA.clientId,
    customerName: 'Hannah Brooks',
    customerEmail: 'hannah.brooks@example.com',
    shipAddress: '418 Maple Ridge Rd',
    shipCity: 'Nashville',
    shipState: 'Tennessee',
    shipZip: '37209',
    shipCountry: 'USA',
    storeOrderNumber: `KS-TEST-E2E-${Date.now()}`,
    lines: [
      { productId: x.productA.id, quantity: 2, unitPrice: 18 },
      { productId: x.productB.id, quantity: 1, unitPrice: 18 },
    ],
  });
  const alloc = await postJson<{ allocated: string[] }>(page, '/api/ops/allocate', {
    orderIds: [order.id],
    warehouseId: x.warehouseId,
  });
  expect(alloc.allocated).toContain(order.id);
  await postJson(page, '/api/ops/jobs', {
    mode: 'create',
    operation: 'order',
    orderIds: [order.id],
    jobTypeId: x.jobTypeId,
  });
  const tasks = await getJson<{ id: string; orderId: string; taskType: string; status: string }[]>(
    page.request,
    `/api/tasks?f.orderCode=eq:${order.code}&ps=200`,
  );
  const picks = tasks
    .filter((t) => t.orderId === order.id && t.taskType === 'Picking' && t.status !== 'Completed')
    .map((t) => t.id);
  expect(picks.length).toBeGreaterThan(0);
  await postJson(page, '/api/ops/tasks/execute', { taskIds: picks, targetLocationId: x.stationId });
  return order;
}

async function scan(page: Page, code: string): Promise<void> {
  await page.keyboard.type(code);
  await page.keyboard.press('Enter');
}

async function pickOption(page: Page, trigger: string, text: RegExp): Promise<void> {
  await page.locator(trigger).click();
  await page.getByRole('option', { name: text }).first().click();
}

test.describe('stations & returns', () => {
  test.setTimeout(300_000);

  for (const path of ['/packing-station', '/return-station', '/orders/returns', '/orders/returns/new']) {
    test(`${path} renders without console errors and passes axe`, async ({ adminPage: page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await page.goto(path, { timeout: 120_000 });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 90_000 });
      await page.waitForTimeout(1500);
      // color-contrast: the remaining hits are shared tokens/primitives (text-faint, StatTile, Select
      // placeholder, wizard rail, success StatusPill), docs/requests/stations-returns.md REQ-4.
      await expectNoA11yViolations(page, {
        exclude: ['header', 'nav', 'thead'],
        disableRules: ['color-contrast'],
      });
      expect(errors.filter((e) => !/Download the React DevTools|HMR|Fast Refresh/.test(e))).toEqual([]);
    });
  }

  test('dashboard: start tiles stay disabled until a station is chosen', async ({ adminPage: page }) => {
    await page.goto('/packing-station', { timeout: 120_000 });
    const tile = page.getByRole('button', { name: /Scan a location/ });
    await expect(tile).toBeDisabled();
    await pickOption(page, '#ps-warehouse', new RegExp(WAREHOUSE));
    await pickOption(page, '#ps-station', new RegExp(STATION));
    await expect(tile).toBeEnabled();
    await page.keyboard.press('2');
    await expect(page).toHaveURL(/\/packing-station\/[0-9a-f-]{36}\/location/, { timeout: 90_000 });
  });

  test('pack an order with the keyboard: wrong SKU, over-pack, two boxes, rate, complete', async ({
    adminPage: page,
  }) => {
    const x = await ids(page);
    const order = await readyToPackOrder(page, x);
    await page.goto(`/packing-station/${x.stationId}/order`, { timeout: 120_000 });
    await expect(page.locator('#pack-source')).toBeFocused({ timeout: 90_000 });
    await scan(page, order.code);
    await expect(page.locator('#pack-product')).toBeFocused({ timeout: 90_000 });

    await scan(page, WRONG_SKU);
    await expect(page.getByText(`Wrong item: ${WRONG_SKU} is not on this order.`).first()).toBeVisible();
    await scan(page, SKU_A);
    await scan(page, SKU_A);
    await page.locator('#pkg-1').focus();
    await page.keyboard.press('Enter');
    await page.getByRole('option', { name: /BOX-S/ }).first().click();
    await expect(page.getByLabel('Package 1 length')).not.toHaveValue('');
    await page.getByLabel('Package 1 weight pounds').fill('1');
    await page.locator('#pack-product').focus();
    await page.keyboard.press('F2');
    await expect(page.getByText(/Package 2 is open/).first()).toBeVisible();

    await scan(page, SKU_B);
    await scan(page, SKU_B);
    await expect(page.getByText(/already fully packed .* Over-packing is blocked/).first()).toBeVisible();
    await page.locator('#pkg-2').focus();
    await page.keyboard.press('Enter');
    await page.getByRole('option', { name: /BOX-S/ }).first().click();
    await page.getByLabel('Package 2 weight ounces').fill('10');
    await page.getByRole('button', { name: 'Get rate' }).first().click();
    await expect(page.getByText(/\$\d+\.\d{2}/).first()).toBeVisible({ timeout: 60_000 });

    await page.locator('#pack-product').focus();
    await page.keyboard.press('F9');
    await expect(page.getByRole('heading', { name: `Order ${order.code} packed` })).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByText(/Master tracking/)).toBeVisible();
    await expect(page.getByText(/^Package 2 ·/)).toBeVisible();
    const detail = await getJson<{ order: { status: string } }>(page.request, `/api/orders/${order.id}`);
    expect(detail.order.status).toBe('Ready to Ship');
  });

  test('Create RMA through the wizard, then receive it at the return station', async ({
    adminPage: page,
  }) => {
    const hits = await getJson<{ id: string; code: string; returnableUnits: number }[]>(
      page.request,
      '/api/returns/shippable/search',
    );
    const target = hits.find((h) => h.returnableUnits > 0);
    test.skip(!target, 'No shipped order with returnable units');

    await page.goto('/orders/returns/new', { timeout: 120_000 });
    // Next stays disabled until an order is chosen.
    await expect(page.getByRole('button', { name: /Choose a shipped order/ })).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
    await page.getByRole('button', { name: /Choose a shipped order/ }).click();
    const picker = page.getByRole('dialog');
    await expect(picker.getByRole('option').first()).toBeVisible({ timeout: 90_000 });
    await page.keyboard.type(target!.code);
    await expect(picker.getByRole('option')).toHaveCount(1, { timeout: 30_000 });
    await page.keyboard.press('Enter');
    await expect(picker).toBeHidden();
    await expect(page.getByText(target!.code).first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText(/units? selected/)).toBeVisible();
    if (await page.getByText(/^0 units selected/).isVisible()) {
      // Next validates on click: with nothing selected the wizard stays on the Items step.
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(page.getByText(/^0 units selected/)).toBeVisible();
      await page
        .getByRole('checkbox', { name: /^Return / })
        .first()
        .click();
    }
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText(/^[1-9]\d* units? selected/)).toBeVisible();
    // A customer return reason is required on every selected line.
    for (const reason of await page.getByRole('combobox', { name: /^Return reason for / }).all()) {
      if (!(await reason.isEnabled())) continue;
      await reason.click();
      await page.getByRole('option').first().click();
    }
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.locator('#rma-note').fill('KS-TEST e2e return');
    await page.getByRole('button', { name: 'Create RMA' }).click();
    await expect(page.getByText(/RMA\d{6}/).first()).toBeVisible({ timeout: 90_000 });
    const rmaCode =
      (
        await page
          .getByText(/RMA\d{6}/)
          .first()
          .innerText()
      ).match(/RMA\d{6}/)?.[0] ?? '';
    expect(rmaCode).not.toBe('');

    await page.goto('/return-station', { timeout: 120_000 });
    // The station remembers the last warehouse/station/target; set them only when it has none.
    const start = page.getByRole('button', { name: /Return with RMA/ });
    await expect(start).toBeVisible({ timeout: 90_000 });
    if (await start.isDisabled()) {
      await pickOption(page, '#rs-warehouse', new RegExp(WAREHOUSE));
      await page.locator('#rs-station').click();
      await page.keyboard.type(RETURN_STATION);
      await page
        .getByRole('option', { name: new RegExp(RETURN_STATION) })
        .first()
        .click();
      await page.getByRole('combobox', { name: 'Return target' }).click();
      await page.keyboard.type(RETURN_TARGET);
      await page
        .getByRole('option', { name: new RegExp(RETURN_TARGET) })
        .first()
        .click();
    }
    await page.getByRole('button', { name: /Return with RMA/ }).click();
    await expect(page.locator('#rma-lookup')).toBeFocused({ timeout: 60_000 });
    await scan(page, rmaCode);
    await expect(page.locator('#rma-item')).toBeFocused({ timeout: 90_000 });
    const items = page.getByRole('list', { name: 'Items to receive' });
    for (const plus of await items.getByRole('button', { name: /^One more/ }).all()) {
      while (await plus.isEnabled()) await plus.click();
    }
    await page.keyboard.press('F9');
    await expect(page.getByText(`Return ${rmaCode} received`)).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/Status: Completed/)).toBeVisible();
  });

  test('status pills count grid rows: All equals the grid total', async ({ adminPage: page }) => {
    await page.goto('/orders/returns', { timeout: 120_000 });
    const all = page.getByRole('button', { name: /\bAll( lines)?\s*\d/ }).first();
    await expect(all).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/Total:\s*\d+/).first()).toBeVisible({ timeout: 60_000 });
    const pill = Number((await all.innerText()).replace(/\D+/g, ''));
    const total = Number(
      ((
        await page
          .getByText(/Total:\s*\d+/)
          .first()
          .innerText()
      ).match(/Total:\s*(\d+)/) ?? [])[1],
    );
    expect(pill).toBe(total);
  });

  test("Change status offers only legal moves; a cancelled RMA can't be received", async ({
    adminPage: page,
  }) => {
    await page.goto('/orders/returns?f.status=in%3ACancelled', { timeout: 120_000 });
    const row = page
      .getByRole('row')
      .filter({ hasText: /RMA\d{6}/ })
      .first();
    await expect(row).toBeVisible({ timeout: 90_000 });
    const cancelledCode = (await row.innerText()).match(/RMA\d{6}/)?.[0] ?? '';
    expect(cancelledCode).not.toBe('');
    await row.getByRole('checkbox').click();
    // Cancelled is terminal: the bulk action stays disabled (no legal move).
    await expect(page.getByRole('button', { name: 'Change status' }).first()).toBeDisabled({
      timeout: 30_000,
    });
    await row.getByRole('checkbox').click();

    await page.getByRole('button', { name: /^Pending/ }).click();
    const pending = page
      .getByRole('row')
      .filter({ hasText: /RMA\d{6}/ })
      .first();
    await expect(pending).toContainText('Pending', { timeout: 60_000 });
    await pending.getByRole('checkbox').click();
    await page.getByRole('button', { name: 'Change status' }).first().click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByRole('radio', { name: /Completed/ })).toBeDisabled({ timeout: 30_000 });
    await expect(modal.getByRole('radio', { name: /In Transit/ })).toBeEnabled();
    await expect(modal.getByRole('radio', { name: /Cancelled/ })).toBeEnabled();
    await modal.getByRole('button', { name: 'Cancel' }).click();

    const x = await ids(page);
    const lookup = await getJson<{ receivable: boolean; reason: string | null }[]>(
      page.request,
      `/api/returns/lookup?warehouseId=${x.warehouseId}&code=${cancelledCode}`,
    );
    expect(lookup[0]?.receivable).toBe(false);
    expect(lookup[0]?.reason).toMatch(/cancelled/i);
  });

  test("viewer can't open Create RMA (server-side gate) and the API rejects the post", async ({
    viewerPage: page,
  }) => {
    await page.goto('/orders/returns/new', { timeout: 120_000 });
    await expect(page).toHaveURL(/\/forbidden/, { timeout: 90_000 });
    const res = await page.request.post(`${base}/api/returns`, {
      data: {},
      headers: { 'x-csrf-token': await csrf(page), Origin: base },
      timeout: 120_000,
    });
    expect(res.status()).toBe(403);
  });
});
