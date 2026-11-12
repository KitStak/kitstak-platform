/**
 * M05 live mutation walk, driven through the browser (not only the API):
 *   1. RF receiving (phone viewport): scan PO, scan barcode, rescan SKU (+1), scan location,
 *      Receive 2 → the PO becomes Started with 2 received.
 *   2. Putaway: open the task from the worklist, pick the best suggestion, move 1 → 1 unit waits.
 *   3. Cancel receipt: Receiving History › Master ID drawer (renders from the row at once) ›
 *      Cancel receipt › confirm → the receipt is cancelled and the stock reversed.
 *   4. Ledger: the drawer's ledger link opens Receiving transactions filtered to the PO and SKU,
 *      and lists the Cancel Receiving row.
 *   5. Vendor create through the drawer.
 *   6. Bulk delete of two Pending POs from the list.
 *
 * Creates KS-TEST-WALK-* POs and a "KS-TEST Walk Vendor …" on the shared dev DB.
 * Run: E2E_BASE_URL=http://localhost:3000/ npx playwright test tests/e2e/inbound-receiving/mutation-walk.spec.ts --project=e2e --no-deps
 */
import { expect, test } from '../fixtures/auth';
import { api, createTestPo, json, quietHmr, stamp, TEST_SKU } from './helpers';

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(30_000);
  await quietHmr(page.context());
});

test('receive partial (RF) → putaway → cancel receipt → ledger', async ({ page }) => {
  test.setTimeout(180_000);
  const a = await api();
  const code = `KS-TEST-WALK-${stamp()}`;
  const { po, barcode } = await createTestPo(a, code, 5);

  // 1. RF receive by scan, phone viewport.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/receiving/rf');
  await page.getByTestId('rf-po-scan').fill(code);
  await page.getByTestId('rf-po-scan').press('Enter');
  await expect(page.getByTestId('rf-po')).toHaveText(code);
  await page.getByTestId('rf-sku-scan').fill(barcode);
  await page.getByTestId('rf-sku-scan').press('Enter');
  await expect(page.getByTestId('rf-line')).toBeVisible();
  await page.getByTestId('rf-sku-scan').fill(TEST_SKU);
  await page.getByTestId('rf-sku-scan').press('Enter');
  await expect(page.getByTestId('rf-qty')).toHaveValue('2');
  await page.getByTestId('rf-location-scan').fill('MLT1-RECV');
  await page.getByTestId('rf-location-scan').press('Enter');
  await expect(page.getByTestId('rf-location')).toHaveText('MLT1-RECV');
  await expect(page.getByTestId('rf-issue')).toContainText('Ready');
  await page.getByTestId('rf-confirm').click();
  await expect(page.getByTestId('rf-log')).toContainText(`2 × ${TEST_SKU}`);
  const started = await json<{
    status: string;
    receivedQuantity: number;
    version: number;
    lines: { id: string }[];
  }>(await a.c.get(`/api/purchase-orders/${po.id}`));
  expect(started.status).toBe('Started');
  expect(started.receivedQuantity).toBe(2);

  // 2. Putaway 1 of the 2 units.
  await page.setViewportSize({ width: 1440, height: 900 });
  // Stock of one SKU / location / lot shares a bucket, so the task is found by SKU + location
  // (it may also hold units from earlier walks) and checked by its quantity going down by one.
  type Task = { id: string; qty: number; fromLocationCode: string };
  const tasks = async () =>
    (await json<Task[]>(await a.c.get(`/api/putaway?q=${TEST_SKU}&ps=100`))).find(
      (t) => t.fromLocationCode === 'MLT1-RECV',
    );
  const before = await tasks();
  expect(before?.qty ?? 0).toBeGreaterThanOrEqual(2);
  await page.goto(`/receiving/putaway?q=${TEST_SKU}`);
  await page.locator(`tr[data-row-id="${before?.id}"]`).click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('button:has-text("Best")').click();
  await dlg.getByLabel('Quantity').fill('1');
  await dlg.getByRole('button', { name: 'Confirm putaway' }).click();
  await expect(dlg).toBeHidden();
  await expect.poll(async () => (await tasks())?.qty ?? 0).toBe((before?.qty ?? 0) - 1);

  // 3. Cancel a receipt from Receiving History (the drawer renders from the grid row).
  const rec = await json<{ receiptIds: string[] }>(
    await a.c.post(`/api/purchase-orders/${po.id}/receive`, {
      headers: a.h,
      data: { version: started.version, lines: [{ lineId: started.lines[0]?.id, quantity: 1 }] },
    }),
  );
  const receipt = await json<{ masterId: number }>(await a.c.get(`/api/receipts/${rec.receiptIds[0]}`));
  await page.goto(`/receiving/history?f.masterId=eq:${receipt.masterId}`);
  const row = page.locator('tr[data-row-id]').first();
  await expect(row).toContainText('Purchase order');
  await row.getByRole('button', { name: String(receipt.masterId), exact: true }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('Receiving type')).toBeVisible({ timeout: 2_000 });
  await drawer.getByRole('button', { name: 'Cancel receipt' }).click();
  await page
    .getByRole('alertdialog')
    .or(page.getByRole('dialog').filter({ hasText: /cancel/i }))
    .last()
    .getByRole('button', { name: /^(Yes|Cancel receiving|Confirm)$/ })
    .first()
    .click();
  await expect
    .poll(
      async () =>
        (await json<{ cancelledAt: string | null }>(await a.c.get(`/api/receipts/${rec.receiptIds[0]}`)))
          .cancelledAt,
      { timeout: 15_000 },
    )
    .not.toBeNull();

  // 4. Receiving-scoped ledger with PO / SKU filters, showing the Cancel Receiving row.
  await page.goto(`/receiving/history?f.masterId=eq:${receipt.masterId}`);
  await page
    .locator('tr[data-row-id]')
    .first()
    .getByRole('button', { name: String(receipt.masterId), exact: true })
    .click();
  await page.getByRole('link', { name: `${TEST_SKU} on ${code} ledger` }).click();
  await expect(page).toHaveURL(/\/receiving\/transactions\?/);
  await expect(page.getByRole('heading', { name: 'Receiving transactions' })).toBeVisible();
  await expect(page.locator('tr[data-row-id]').filter({ hasText: 'Cancel Receiving' }).first()).toBeVisible();
  await expect(
    page
      .locator('tr[data-row-id]')
      .filter({ hasText: /^Receiving/ })
      .first(),
  ).toBeVisible();
  await a.c.dispose();
});

test('vendor create and bulk delete of purchase orders', async ({ page }) => {
  test.setTimeout(120_000);
  const a = await api();
  const name = `KS-TEST Walk Vendor ${stamp()}`;
  await page.goto('/receiving/vendors');
  await page.locator('tr[data-row-id]').first().waitFor();
  await page.getByRole('button', { name: 'Create vendor' }).first().click();
  const dr = page.getByRole('dialog');
  await dr.getByLabel('Client').click();
  await page
    .getByRole('option', { name: /Copperline/ })
    .first()
    .click();
  await dr.getByLabel('Display name').fill(name);
  await dr.getByLabel('Vendor name').fill(`${name} LLC`);
  await dr.getByRole('button', { name: 'Create vendor' }).click();
  await expect(dr).toBeHidden();
  const vendors = await json<{ id: string; displayName: string }[]>(
    await a.c.get(`/api/vendors?q=${encodeURIComponent(name)}&ps=5`),
  );
  expect(vendors[0]?.displayName).toBe(name);

  const prefix = `KS-TEST-WALK-DEL-${stamp()}`;
  for (const s of ['A', 'B']) await createTestPo(a, `${prefix}-${s}`, 1, vendors[0]?.id);
  await page.goto(`/receiving?q=${prefix}`);
  await expect(page.locator('tr[data-row-id]')).toHaveCount(2);
  for (const i of [0, 1]) await page.locator('tr[data-row-id]').nth(i).getByRole('checkbox').click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('menuitem', { name: /Delete purchase order/ }).click();
  await page
    .getByRole('alertdialog')
    .or(page.getByRole('dialog'))
    .last()
    .getByRole('button', { name: 'Yes' })
    .click();
  await expect(page.locator('tr[data-row-id]')).toHaveCount(0);
  expect(await json<unknown[]>(await a.c.get(`/api/purchase-orders?q=${prefix}&ps=10`))).toHaveLength(0);
  await a.c.dispose();
});
