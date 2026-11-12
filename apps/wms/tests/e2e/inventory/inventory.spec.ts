/**
 * M06 inventory — e2e happy paths and guard paths against the shared dev app.
 * Every mutation is reverted at the end of its test so the shared DB keeps its totals.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '../fixtures/auth';
import { expectNoA11yViolations } from '../fixtures/a11y';
import { e2eBaseUrl } from '../fixtures/roles';

const base = e2eBaseUrl();
const SKU = process.env.E2E_INVENTORY_SKU ?? 'APX-TEE-BLK-M';
const LOCATION = process.env.E2E_INVENTORY_LOCATION ?? 'E-01-01-2';
const ROW_URL = `/inventory/by-location?q=${SKU}&qm=eq&f.location=eq:${LOCATION}`;

// The shared dev server compiles routes on first hit and serves many agents; 10s API timeouts flake.
test.use({ actionTimeout: 45_000 });

interface Bucket {
  id: string;
  version: number;
  totalQty: number;
  sku: string;
  location: string;
  lpNumber: string | null;
  damageReason: string | null;
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
    headers: { Origin: base },
    data: {
      mode: 'adjust',
      qty,
      reasonId: (
        reasons.adjustmentReasons.find((r: { direction: string }) => r.direction === 'both') ??
        reasons.adjustmentReasons[0]
      ).id,
      note: 'KS-TEST e2e restore',
      version: b.version,
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

/**
 * Other agents edit files on the shared dev server; a Turbopack "restart" HMR message full-reloads
 * the page mid-drawer. Keep the socket (the dev client needs it to hydrate) but drop reload messages.
 */
async function holdHmrReloads(page: Page): Promise<void> {
  await page.routeWebSocket(/hmr/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      if (!/"type":"(restart|reloadPage|serverComponentChanges)"/.test(String(m))) ws.send(m);
    });
  });
}

interface LedgerRow {
  type: string;
  sourceLocation: string | null;
  targetLocation: string | null;
  sourceLp: string | null;
  targetLp: string | null;
  uomQty: number;
  at: string;
}
type LocRow = Bucket & {
  locationId: string;
  lpId: string | null;
  status: string;
  warehouseId: string;
  clientId: string;
  productId: string;
  packType: string;
};

async function latestMovement(request: APIRequestContext, sku: string): Promise<LedgerRow | undefined> {
  const res = await request.get(
    `${base}/api/reports/transaction-history?f.sku=eq:${encodeURIComponent(sku)}&f.type=in:Inventory%20Movement&pageSize=5`,
  );
  return ((await res.json()).data as LedgerRow[])[0];
}

async function rowsAt(request: APIRequestContext, location: string): Promise<LocRow[]> {
  return (
    await (
      await request.get(`${base}/api/inventory/by-location?f.location=eq:${encodeURIComponent(location)}`)
    ).json()
  ).data;
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_SHOTS_DIR;
  await page.screenshot({ path: dir ? `${dir}/${name}.png` : test.info().outputPath(`${name}.png`) });
}

async function waitForRows(page: Page): Promise<void> {
  await expect(page.getByRole('row').nth(1)).toBeVisible({ timeout: 60_000 });
  await expect(
    page
      .locator('[data-status]')
      .first()
      .or(page.getByText(/No inventory/)),
  ).toBeVisible({ timeout: 60_000 });
}

test.describe('inventory pages', () => {
  test.describe.configure({ timeout: 180_000 });

  for (const path of ['/inventory', '/inventory/by-location', '/inventory/atp']) {
    test(`${path} renders without console errors and passes axe`, async ({ adminPage: page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await page.goto(path, { timeout: 120_000 });
      await expect(page.getByText(/^Total: \d/)).toBeVisible({ timeout: 90_000 });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // Shell / grid-header contrast is shared code: docs/requests/inventory.md REQ-3.
      await expectNoA11yViolations(page, { exclude: ['header', 'nav', 'thead'] });
      expect(errors.filter((e) => !/Download the React DevTools|HMR|Fast Refresh/.test(e))).toEqual([]);
    });
  }

  test('Total Inventory: SKU and Open SO links open pre-filtered lists in a new tab', async ({
    adminPage: page,
  }) => {
    await page.goto(`/inventory?q=${SKU}&qm=eq`, { timeout: 120_000 });
    const link = page.getByRole('link', { name: new RegExp(`Product ${SKU}`) }).first();
    await expect(link).toBeVisible({ timeout: 90_000 });
    await expect(link).toHaveAttribute('target', '_blank');
    expect(decodeURIComponent((await link.getAttribute('href')) ?? '')).toContain(
      `/products?f.sku=eq:${SKU}&f.clientId=in:`,
    );
    await expect(page.getByRole('cell', { name: /^All (Warehouses|\(\d+\))$/ }).first()).toBeVisible();
  });

  test('ATP defaults to every warehouse in scope and explains the formulas', async ({ adminPage: page }) => {
    await page.goto('/inventory/atp', { timeout: 120_000 });
    await expect(page.getByText(/Current ATP = Undamaged − Open SO/)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/^Total: [1-9]/)).toBeVisible({ timeout: 90_000 });
  });

  test('Allocated rows have no ⋯ menu and explain why', async ({ adminPage: page }) => {
    await page.goto('/inventory/by-location?f.status=nin:Stock', { timeout: 120_000 });
    await waitForRows(page);
    const lock = page.getByLabel(/stock belongs to an order in progress/).first();
    await expect(lock).toBeVisible();
    await lock.focus();
    await expect(page.getByRole('tooltip')).toContainText('only available on Stock rows');
  });

  test('Adjust: Save stays disabled until valid, then posts the delta', async ({ adminPage: page }) => {
    test.setTimeout(180_000);
    const start = await bucket(page.request);
    try {
      await page.goto(ROW_URL, { timeout: 120_000 });
      await waitForRows(page);
      await page
        .getByRole('button', { name: `Row actions for ${SKU} @ ${LOCATION}` })
        .first()
        .click();
      await page.getByRole('menuitem', { name: 'Adjust' }).click();
      const drawer = page.getByRole('dialog', { name: 'Adjust Inventory' });
      await expect(drawer).toBeVisible();
      await drawer.getByRole('button', { name: 'Save' }).click();
      await expect(drawer.getByText(/^Enter a (quantity|different quantity)/)).toBeVisible();
      await drawer.getByLabel('New Quantity').fill(String(start.totalQty - 2));
      await drawer.getByLabel('Adjustment reason').click();
      await page.getByRole('option', { name: 'Inventory quantity discrepancy' }).click();
      await drawer.getByRole('button', { name: 'Save' }).click();
      await expect(
        page.getByText(`${SKU} @ ${LOCATION}: ${start.totalQty} → ${start.totalQty - 2}`).first(),
      ).toBeVisible({ timeout: 30_000 });
      expect((await bucket(page.request)).totalQty).toBe(start.totalQty - 2);
    } finally {
      await restoreQty(page, start.totalQty);
    }
  });

  test('Transfer LP/Loc menu opens both drawers with Find', async ({ adminPage: page }) => {
    await page.goto('/inventory/by-location', { timeout: 120_000 });
    await waitForRows(page);
    for (const item of ['Transfer LP', 'Transfer Location']) {
      await page.getByRole('button', { name: 'Transfer LP/Loc' }).click();
      await page.getByRole('menuitem', { name: item, exact: true }).click();
      const drawer = page.getByRole('dialog', { name: item });
      await expect(drawer.getByRole('button', { name: 'Find' })).toBeVisible();
      // Find stays disabled (with its reason) until a source is picked.
      await expect(drawer.getByRole('button', { name: 'Find' })).toBeDisabled();
      await expect(drawer.getByLabel(/^Pick the source/).first()).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
    }
  });

  test('Change Attributes needs a selection, then opens the single-field drawer', async ({
    adminPage: page,
  }) => {
    await page.goto(ROW_URL, { timeout: 120_000 });
    await waitForRows(page);
    const trigger = page.getByRole('button', { name: 'Change Attributes' });
    await expect(trigger).toBeDisabled();
    await page.getByRole('row').nth(1).getByRole('checkbox').check();
    await expect(trigger).toBeEnabled();
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Change Lot/Batch Number' }).click();
    const drawer = page.getByRole('dialog', { name: 'Change Lot/Batch Number' });
    await expect(drawer.getByText(/lot\/batch numbers that you have selected will be updated/)).toBeVisible();
  });

  test('Add Inventory shows inline errors for missing fields', async ({ adminPage: page }) => {
    await page.goto('/inventory/by-location', { timeout: 120_000 });
    const add = page.getByRole('button', { name: 'Add Inventory' }).first();
    await expect(add).toBeEnabled({ timeout: 60_000 });
    await add.click();
    const drawer = page.getByRole('dialog', { name: 'Add Inventory' });
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer.getByText('Location is required')).toBeVisible();
    await expect(drawer.getByText('Quantity to Add is required')).toBeVisible();
  });

  test('viewer sees no mutation controls and the API refuses', async ({ viewerPage: page }) => {
    await page.goto('/inventory/by-location', { timeout: 120_000 });
    await expect(page.getByText(/^Total: /)).toBeVisible({ timeout: 90_000 });
    // Mutation controls the viewer cannot use are hidden, not shown disabled.
    await expect(page.getByRole('button', { name: 'Add Inventory' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Transfer LP/Loc' })).toHaveCount(0);
    const res = await page.request.post(`${base}/api/inventory/transfer-location`, {
      headers: { Origin: base },
      data: { fromLocationId: 'x', target: { kind: 'location', id: 'y' } },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe('inventory transfers', () => {
  test.describe.configure({ timeout: 180_000 });

  test('Transfer Product moves a partial quantity, merges into the target Stock row and posts an Inventory Movement', async ({
    adminPage: page,
  }) => {
    await holdHmrReloads(page);
    const start = await bucket(page.request);
    const TARGET = process.env.E2E_INVENTORY_TARGET ?? 'F-01-01-2';
    try {
      await page.goto(ROW_URL, { timeout: 120_000 });
      await waitForRows(page);
      await page
        .getByRole('button', { name: `Row actions for ${SKU} @ ${LOCATION}` })
        .first()
        .click();
      await page.getByRole('menuitem', { name: 'Transfer product' }).click();
      const drawer = page.getByRole('dialog', { name: 'Transfer Product' });
      await drawer.getByLabel('Transfer Product Quantity').fill('5');
      const target = drawer.getByRole('combobox').last();
      await target.click();
      await page.keyboard.type(TARGET);
      await page
        .getByRole('option', { name: new RegExp(TARGET) })
        .first()
        .click();
      const isTargetStock = (r: LocRow) =>
        r.sku === SKU && !r.lpNumber && !r.damageReason && r.status === 'Stock';
      const targetBefore = (await rowsAt(page.request, TARGET)).filter(isTargetStock);
      await drawer.getByRole('button', { name: 'Transfer', exact: true }).click();
      await expect(page.getByText('Transfer completed successfully').first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText(`5 × ${SKU}: ${LOCATION} → ${TARGET}`).first()).toBeVisible({
        timeout: 30_000,
      });
      await shot(page, 'transfer-product-toast');
      expect((await bucket(page.request)).totalQty).toBe(start.totalQty - 5);
      // Merge: the units land on the existing Stock row at the target; no second row appears.
      const targetAfter = (await rowsAt(page.request, TARGET)).filter(isTargetStock);
      if (targetBefore.length === 1) {
        expect(targetAfter.map((r) => r.id)).toEqual(targetBefore.map((r) => r.id));
        expect(targetAfter[0]?.totalQty).toBe((targetBefore[0]?.totalQty ?? 0) + 5);
      }
      expect(await latestMovement(page.request, SKU)).toMatchObject({
        type: 'Inventory Movement',
        sourceLocation: LOCATION,
        targetLocation: TARGET,
        uomQty: 5,
      });
    } finally {
      const moved = (
        (
          await (
            await page.request.get(`${base}/api/inventory/by-location?q=${SKU}&qm=eq&f.location=eq:${TARGET}`)
          ).json()
        ).data as Bucket[]
      ).find((r) => !r.lpNumber && !r.damageReason);
      const origin = await bucket(page.request);
      const missing = start.totalQty - origin.totalQty;
      if (moved && missing > 0) {
        const res = await page.request.post(`${base}/api/inventory/transfer-product`, {
          headers: { Origin: base },
          data: {
            inventoryId: moved.id,
            qty: missing,
            target: { kind: 'location', id: (origin as unknown as { locationId: string }).locationId },
            note: 'KS-TEST e2e restore',
          },
        });
        expect(res.ok(), await res.text()).toBe(true);
      }
    }
  });

  // Candidates (MLT1 seed): the first unlocked, unallocated source and the first empty, unblocked target win, so a
  // count plan another session opened on one of them does not fail the run. Env vars pin a single choice.
  const CANDIDATES = {
    location: {
      src: process.env.E2E_TRANSFER_LOCATION
        ? [process.env.E2E_TRANSFER_LOCATION]
        : ['B-01-03-2', 'A-01-05-1', 'B-02-02-2', 'A-03-03-1', 'A-03-02-1'],
      dst: process.env.E2E_TRANSFER_LOCATION_TARGET
        ? [process.env.E2E_TRANSFER_LOCATION_TARGET]
        : ['A-01-01-3', 'A-02-01-3', 'A-02-02-3', 'A-01-04-3', 'A-01-05-3'],
    },
    lp: {
      src: process.env.E2E_TRANSFER_LP
        ? [process.env.E2E_TRANSFER_LP]
        : ['PLT0000034', 'PLT0000027', 'PLT0000016', 'PLT0000002'],
      dst: process.env.E2E_TRANSFER_LP_TARGET
        ? [process.env.E2E_TRANSFER_LP_TARGET]
        : ['A-01-02-3', 'A-02-02-3', 'A-02-01-3', 'A-01-04-3'],
    },
  } as const;
  for (const kind of ['location', 'lp'] as const) {
    test(`Transfer ${kind === 'lp' ? 'LP' : 'Location'}: Find, move, toast and an Inventory Movement ledger row`, async ({
      adminPage: page,
    }) => {
      await holdHmrReloads(page);
      let SRC = '';
      let src: LocRow[] = [];
      for (const code of CANDIDATES[kind].src) {
        const rows = (
          (await (await page.request.get(`${base}/api/inventory/by-location?q=${code}&qm=eq`)).json())
            .data as (LocRow & { countLockPlan: string | null; allocatedQty: number })[]
        ).filter((r) => (kind === 'lp' ? r.lpNumber === code : r.location === code));
        if (rows.length > 0 && rows.every((r) => !r.countLockPlan && r.allocatedQty === 0)) {
          SRC = code;
          src = rows;
          break;
        }
      }
      test.skip(!SRC, 'No unlocked, unallocated source on this database');
      let DST = '';
      for (const code of CANDIDATES[kind].dst) {
        if ((await rowsAt(page.request, code)).length > 0) continue;
        const productIds = src.map((r) => r.productId).join(',');
        const opts = (
          await (
            await page.request.get(
              `${base}/api/inventory/destinations?kind=location&warehouseId=${src[0]!.warehouseId}&q=${code}&exact=1&productIds=${productIds}`,
            )
          ).json()
        ).data as { label: string; blocking: string | null }[];
        if (opts.some((o) => o.label === code && !o.blocking)) {
          DST = code;
          break;
        }
      }
      test.skip(!DST, 'No empty, unblocked target on this database');
      const origin = src[0]!;
      try {
        await page.goto('/inventory/by-location', { timeout: 120_000 });
        await page.getByRole('button', { name: /Transfer LP\/Loc/ }).click();
        await page
          .getByRole('menuitem', { name: kind === 'lp' ? /Transfer LP/ : /Transfer Location/ })
          .click();
        const drawer = page.getByRole('dialog', {
          name: kind === 'lp' ? 'Transfer LP' : 'Transfer Location',
        });
        const wh = drawer.locator('#tc-warehouse');
        if (!(await wh.inputValue()).includes('MLT1')) {
          await wh.click();
          await page.getByRole('option', { name: /MLT1/ }).first().click();
        }
        await drawer.locator('#tc-source').click();
        await page.keyboard.type(SRC);
        await page
          .getByRole('option', { name: new RegExp(SRC) })
          .first()
          .click();
        await drawer.getByRole('button', { name: 'Find' }).click();
        await expect(drawer.getByRole('region', { name: 'Contents' })).toBeVisible();
        // The destination picker ("Move to LP/Location") is labelled "Location"; never re-type into the source.
        const target = drawer.getByRole('combobox', { name: 'Location', exact: true }).last();
        await expect(target).toBeVisible();
        await target.click();
        await page.keyboard.type(DST);
        await page
          .getByRole('option', { name: new RegExp(DST) })
          .first()
          .click();
        await drawer.getByRole('button', { name: 'Transfer', exact: true }).click();
        await expect(page.getByText('Transfer completed successfully').first()).toBeVisible({
          timeout: 30_000,
        });
        await shot(page, `transfer-${kind}-toast`);
        expect((await rowsAt(page.request, DST)).map((r) => r.sku).sort()).toEqual(
          src.map((r) => r.sku).sort(),
        );
        const move = await latestMovement(page.request, origin.sku);
        expect(move).toMatchObject({
          type: 'Inventory Movement',
          sourceLocation: origin.location,
          targetLocation: DST,
        });
        if (kind === 'lp') expect(move?.targetLp).toBe(SRC);
      } finally {
        const dst = await rowsAt(page.request, DST);
        if (dst.length > 0) {
          const res = await page.request.post(
            `${base}/api/inventory/${kind === 'lp' ? 'transfer-lp' : 'transfer-location'}`,
            {
              headers: { Origin: base },
              data:
                kind === 'lp'
                  ? {
                      lpId: origin.lpId,
                      target: { kind: 'location', id: origin.locationId },
                      note: 'KS-TEST e2e restore',
                    }
                  : {
                      fromLocationId: dst[0]?.locationId,
                      target: { kind: 'location', id: origin.locationId },
                      note: 'KS-TEST e2e restore',
                    },
            },
          );
          expect(res.ok(), await res.text()).toBe(true);
        }
      }
    });
  }

  test('Adjust to 0: the (i) tip says it deletes the record, and it does', async ({ adminPage: page }) => {
    await holdHmrReloads(page);
    const LOC = process.env.E2E_ADJUST_ZERO_LOCATION ?? 'A-01-03-3';
    const ZERO_SKU = process.env.E2E_ADJUST_ZERO_SKU ?? 'VLT-STAND-LPT';
    test.skip((await rowsAt(page.request, LOC)).length > 0, `${LOC} is not empty on this database`);
    const ref = (
      (await (await page.request.get(`${base}/api/inventory/by-location?q=${ZERO_SKU}&qm=eq`)).json())
        .data as LocRow[]
    )[0];
    test.skip(!ref, `${ZERO_SKU} has no stock row to copy ids from`);
    const dest = (
      (
        await (
          await page.request.get(
            `${base}/api/inventory/destinations?kind=location&warehouseId=${ref!.warehouseId}&q=${LOC}&exact=1`,
          )
        ).json()
      ).data as { id: string; label: string }[]
    ).find((o) => o.label.startsWith(LOC));
    test.skip(!dest, `${LOC} is not a destination on this database`);
    const reasons = (await (await page.request.get(`${base}/api/inventory/reasons`)).json()).data as {
      adjustmentReasons: { id: string; direction: string }[];
    };
    const pick = (avoid: string) =>
      (reasons.adjustmentReasons.find((r) => r.direction === 'both') ??
        reasons.adjustmentReasons.find((r) => r.direction !== avoid) ??
        reasons.adjustmentReasons[0])!.id;
    const added = await page.request.post(`${base}/api/inventory/add`, {
      headers: { Origin: base },
      data: {
        warehouseId: ref!.warehouseId,
        clientId: ref!.clientId,
        productId: ref!.productId,
        packType: ref!.packType,
        locationId: dest!.id,
        qty: 1,
        reasonId: pick('decrease'),
        note: 'KS-TEST e2e adjust-to-zero',
      },
    });
    expect(added.ok(), await added.text()).toBe(true);
    try {
      await page.goto(`/inventory/by-location?q=${ZERO_SKU}&qm=eq&f.location=eq:${LOC}`, {
        timeout: 120_000,
      });
      await waitForRows(page);
      await page
        .getByRole('button', { name: `Row actions for ${ZERO_SKU} @ ${LOC}` })
        .first()
        .click();
      await page.getByRole('menuitem', { name: 'Adjust' }).click();
      const drawer = page.getByRole('dialog').filter({ hasText: 'New Quantity' });
      await drawer.getByRole('button', { name: 'More information' }).first().hover();
      await expect(
        page.getByText('Setting the quantity to 0 will delete this inventory record.').first(),
      ).toBeVisible();
      await page.mouse.move(0, 0);
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      await drawer.getByLabel('New Quantity').fill('0');
      await expect(drawer.getByText(/deletes the inventory record/i).first()).toBeVisible();
      await drawer.getByRole('combobox', { name: 'Adjustment reason' }).click();
      await page.getByRole('option').first().click();
      await drawer.getByRole('button', { name: /^Save/ }).click();
      // A delete-by-adjust asks for confirmation first ("Remove 1 Each?").
      await page.getByRole('button', { name: /^Yes, remove/ }).click();
      await expect(page.getByText(/empty record was removed/i).first()).toBeVisible({ timeout: 30_000 });
      expect((await rowsAt(page.request, LOC)).filter((r) => r.sku === ZERO_SKU)).toHaveLength(0);
    } finally {
      const left = (await rowsAt(page.request, LOC)).find((r) => r.sku === ZERO_SKU);
      if (left) {
        await page.request.post(`${base}/api/inventory/buckets/${left.id}/quantity`, {
          headers: { Origin: base },
          data: {
            mode: 'adjust',
            qty: 0,
            reasonId: pick('increase'),
            note: 'KS-TEST e2e cleanup',
            version: left.version,
          },
        });
      }
    }
  });
});
