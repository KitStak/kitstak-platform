/**
 * M05 acceptance in the browser: create a PO through the 5-step wizard (inline duplicate
 * check, 2 lines via the product drawer, new vendor via the vendor drawer), then partial
 * receive with the lot/expiry tracking guard, cancel that receipt from Receiving History,
 * fully receive, and confirm cancel is blocked once the PO is Completed.
 *
 * Creates KS-TEST-E2E-* records on the shared dev DB (Copperline Coffee Co. · MLT1).
 * Run: npx playwright test tests/e2e/inbound-receiving --project=e2e --no-deps
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures/auth';

const LOAD_MS = 120_000;
const CLIENT = 'Copperline';
const LOT_SKU = 'CPL-BAG-MED-12';
const PLAIN_SKU = 'CPL-MUG-12OZ';
const EXPIRY_DAYS = 180;

function ymd(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 864e5);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

const nextButton = (main: Locator): Locator => main.getByRole('button', { name: 'Next', exact: true }).last();

async function addLine(page: Page, main: Locator, sku: string, qty: number, price: number): Promise<void> {
  await main.getByLabel('Search products').fill(sku);
  await expect(page.getByLabel('Product results').locator('li').filter({ hasText: sku }).first()).toBeVisible(
    { timeout: 30_000 },
  );
  await page.getByLabel(`Quantity of ${sku}`).fill(String(qty));
  await page.getByRole('button', { name: `Add ${sku}` }).click();
  const drawer = page.getByRole('dialog').filter({ hasText: 'Add product' });
  await drawer
    .getByRole('textbox', { name: /^Price per pack type/ })
    .or(drawer.getByRole('spinbutton', { name: /^Price per pack type/ }))
    .first()
    .fill(String(price));
  await drawer.getByRole('button', { name: 'Apply' }).click();
  await expect(drawer).toBeHidden();
}

async function openReceiveDrawer(page: Page, main: Locator): Promise<Locator> {
  await main.getByRole('button', { name: 'Receive items' }).first().click();
  const drawer = page.getByRole('dialog').filter({ hasText: 'Receive items' });
  await expect(drawer.getByText(/Suggested|No putaway rule/).first()).toBeVisible({ timeout: 30_000 });
  return drawer;
}

test.describe('M05 purchase order acceptance', () => {
  test.describe.configure({ mode: 'serial' });
  const code = `KS-TEST-E2E-${Date.now().toString().slice(-6)}`;
  let poUrl = '';

  test('create wizard: duplicate check, 2 lines, new vendor, success screen', async ({ adminPage: page }) => {
    test.setTimeout(LOAD_MS * 3);
    const main = page.locator('main');
    await page.goto('/receiving/new', { timeout: LOAD_MS });
    const codeBox = main.getByRole('textbox', { name: /^PO number/ });
    await expect(codeBox).toBeVisible({ timeout: LOAD_MS });

    await main.getByRole('combobox', { name: /^Warehouse/ }).click();
    await page.getByRole('option').filter({ hasText: /MLT1/ }).first().click();
    await main.getByRole('combobox', { name: /^Client/ }).click();
    await page.getByRole('option').filter({ hasText: CLIENT }).first().click();

    // Duplicate check against a PO that is known to exist on this DB.
    const existing = await page.request.get('/api/purchase-orders?pageSize=1', { timeout: LOAD_MS });
    const existingCode = ((await existing.json()).data?.[0]?.code as string | undefined) ?? 'KS-E2E-PO-1';
    await codeBox.fill(existingCode);
    await codeBox.blur();
    await expect(main.getByText(/already exists/).first()).toBeVisible();
    await codeBox.fill(code);
    await codeBox.blur();
    await expect(main.getByLabel('PO number is available')).toBeVisible();
    await nextButton(main).click();

    await expect(main.getByLabel('Search products')).toBeVisible();
    // Next stays disabled, with its reason, until a product is added.
    await expect(nextButton(main)).toBeDisabled();
    await expect(main.getByLabel('Add at least one product')).toBeVisible();
    await addLine(page, main, LOT_SKU, 10, 4.5);
    await addLine(page, main, PLAIN_SKU, 5, 3);
    await expect(main.getByText('60.00 USD').first()).toBeVisible();
    await nextButton(main).click();

    await main.getByRole('button', { name: 'Add new vendor' }).first().click();
    const vendor = page.getByRole('dialog').filter({ hasText: 'Create vendor' });
    await vendor.getByRole('button', { name: 'Create vendor' }).click();
    await expect(vendor.getByText('Vendor display name is required').first()).toBeVisible();
    const vendorName = `KS-TEST Vendor ${code.slice(-6)}`;
    await vendor.getByRole('textbox', { name: /^Display name/ }).fill(vendorName);
    await vendor.getByRole('textbox', { name: /^Vendor name/ }).fill(`${vendorName} LLC`);
    await vendor.getByRole('button', { name: 'Create vendor' }).click();
    await expect(vendor).toBeHidden();
    await expect(main.getByRole('radio', { name: `Select ${vendorName}` })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await nextButton(main).click();
    await nextButton(main).click();

    await expect(main.getByText('Shipping address').first()).toBeVisible();
    await main.getByRole('button', { name: 'Confirm purchase order' }).click();
    await expect(main.getByText('Create another purchase order').first()).toBeVisible({ timeout: 30_000 });
    poUrl = (await main.getByRole('link', { name: code }).getAttribute('href')) ?? '';
    expect(poUrl).toMatch(/^\/receiving\/.+/);

    await main.getByText('Go to the purchase order list').first().click();
    const row = main.locator('tbody tr').filter({ hasText: code }).first();
    await expect(row).toContainText('Pending', { timeout: LOAD_MS });
    await expect(row).toContainText('60.00 USD');
  });

  test('partial receive: tracking guard, then 6 of 10 with lot and expiry → Started', async ({
    adminPage: page,
  }) => {
    test.setTimeout(LOAD_MS * 2);
    const main = page.locator('main');
    await page.goto(poUrl, { timeout: LOAD_MS });
    const drawer = await openReceiveDrawer(page, main);
    await drawer.getByRole('checkbox', { name: `Receive ${PLAIN_SKU}` }).click();
    const card = drawer.getByRole('region', { name: `Receive ${LOT_SKU}` });
    await card
      .getByRole('textbox', { name: /^Quantity/ })
      .or(card.getByRole('spinbutton', { name: /^Quantity/ }))
      .first()
      .fill('6');
    // Tracking guard: Receive stays disabled until the lot number is entered.
    await expect(page.getByRole('button', { name: 'Receive', exact: true })).toBeDisabled();

    await card.getByRole('textbox', { name: /^Lot batch number/ }).fill('L123');
    const expiry = card.getByRole('textbox', { name: /^Expiry date/ }).first();
    await expiry.fill(ymd(EXPIRY_DAYS));
    await expiry.blur();
    await page.getByRole('button', { name: 'Receive', exact: true }).click();
    await expect(drawer).toBeHidden({ timeout: 30_000 });
    await expect(main.getByText('Started').first()).toBeVisible({ timeout: 30_000 });
    await expect(main.getByText('6 / 15').first()).toBeVisible();
  });

  test('history: cancel the receipt, full receive, then cancel is blocked', async ({ adminPage: page }) => {
    test.setTimeout(LOAD_MS * 3);
    const main = page.locator('main');
    await page.goto(`/receiving/history?q=${encodeURIComponent(code)}&qm=eq`, { timeout: LOAD_MS });
    const row = main.locator('tbody tr').filter({ hasText: code }).first();
    await expect(row).toContainText('L123', { timeout: LOAD_MS });
    await row.getByRole('button', { name: 'Row actions' }).click();
    await page.getByRole('menuitem', { name: /^Cancel/ }).click();
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog')).last();
    await expect(confirm).toContainText('Are you sure you want to cancel the receiving?');
    await confirm.getByRole('button', { name: 'Yes' }).click();
    await expect(confirm).toBeHidden();

    await page.goto(poUrl, { timeout: LOAD_MS });
    await expect(main.getByText('0 / 15').first()).toBeVisible({ timeout: LOAD_MS });
    const drawer = await openReceiveDrawer(page, main);
    const card = drawer.getByRole('region', { name: `Receive ${LOT_SKU}` });
    await card.getByRole('textbox', { name: /^Lot batch number/ }).fill('L123');
    const expiry = card.getByRole('textbox', { name: /^Expiry date/ }).first();
    await expiry.fill(ymd(EXPIRY_DAYS));
    await expiry.blur();
    await page.getByRole('button', { name: 'Receive', exact: true }).click();
    await expect(drawer).toBeHidden({ timeout: 30_000 });
    await expect(main.getByText('Completed').first()).toBeVisible({ timeout: 30_000 });

    await page.goto(`/receiving/history?q=${encodeURIComponent(code)}&qm=eq`, { timeout: LOAD_MS });
    const live = main
      .locator('tbody tr')
      .filter({ hasText: code })
      .filter({ hasNotText: 'Cancelled' })
      .first();
    await expect(live).toBeVisible({ timeout: LOAD_MS });
    await live.getByRole('button', { name: 'Row actions' }).click();
    await expect(page.getByRole('menuitem', { name: /^Cancel/ })).toHaveAttribute('aria-disabled', 'true');
  });
});
