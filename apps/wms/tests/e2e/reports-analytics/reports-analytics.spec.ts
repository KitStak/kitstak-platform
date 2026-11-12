/**
 * M13 reports-analytics: e2e against the shared dev app (read-only, except one Excel export).
 *
 * - Dashboard: every Jobs and Progress drilldown opens a grid whose Total equals the number shown.
 * - Change Log deep link (search round-trips through the URL, and a Code cell opens its record).
 * - Export → Excel Export History Completed → Download 200 with the exported row count.
 * - Analytics app gate: menu + dashboards when active, the activation card when not.
 * - Every bar chart navigates when a bar is clicked.
 * - PO Receiving: the difference column equals Received UOM − PO UOM on every row.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/auth';
import { e2eBaseUrl } from '../fixtures/roles';

const base = e2eBaseUrl();
// The shared dev server compiles routes on first hit and serves many agents.
test.use({
  actionTimeout: 45_000,
  navigationTimeout: 120_000,
  // Optional: run against an already-installed Chromium when the bundled build is missing.
  ...(process.env.E2E_CHROMIUM_PATH
    ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } }
    : {}),
});
test.setTimeout(240_000);

async function api<T>(page: Page, path: string): Promise<{ data: T; meta?: { total?: number } }> {
  const res = await page.request.get(`${base}${path}`, { timeout: 120_000 });
  expect(res.status(), path).toBe(200);
  return res.json();
}

/** `/jobs?…` → `/api/jobs?…`; the page routes and list APIs share the grid grammar. */
const apiOf = (href: string): string => {
  const [path = '', qs = ''] = href.split('?');
  // The orders pages share one list API: /orders = backlog view, /orders/shipped = shipped view.
  // Task Details tabs share /api/tasks?kind=…
  const TASK_KIND: Record<string, string> = {
    '/tasks/order-operations': 'order',
    '/tasks/count': 'count',
    '/tasks/replenishment': 'replenishment',
  };
  const apiPath =
    path === '/orders/shipped'
      ? '/api/orders?view=shipped'
      : path === '/orders'
        ? '/api/orders?view=backlog'
        : TASK_KIND[path]
          ? `/api/tasks?kind=${TASK_KIND[path]}`
          : `/api${path}?`;
  const sep = apiPath.endsWith('?') ? '' : '&';
  return `${apiPath}${qs ? `${sep}${qs}&` : sep}pageSize=1`;
};

interface JobRow {
  name: string;
  jobQty: number;
  href: string;
}
interface Part {
  label: string;
  count: number;
  href?: string;
}
interface Dash {
  jobs: Record<'priority' | 'status' | 'type', JobRow[]>;
  progress: Record<'tasks' | 'lines' | 'ordersToday', { total: number; parts?: Part[] }>;
}

test.describe('dashboard drilldowns', () => {
  test('Jobs card rows open exactly the counted jobs, for one and several warehouses', async ({ page }) => {
    const me = await api<{ contextOptions: { warehouses: { id: string }[] } }>(page, '/api/me');
    const whs = me.data.contextOptions.warehouses.map((w) => w.id);
    for (const sel of [[], whs.slice(0, 2)]) {
      const d = (await api<Dash>(page, `/api/dashboard?wh=${sel.join(',')}`)).data;
      for (const tab of ['priority', 'status', 'type'] as const) {
        for (const row of d.jobs[tab]) {
          const res = await api<unknown[]>(page, apiOf(row.href));
          expect(res.meta?.total, `${tab} ${row.name} (${sel.length} wh)`).toBe(row.jobQty);
          if (sel.length > 1) expect(row.href).toContain('f.warehouse=in:');
        }
      }
      expect(d.jobs.status.map((r) => r.name)).not.toContain('Cancelled');
    }
  });

  test('Progress parts are disjoint and each linked part opens its count', async ({ page }) => {
    const d = (await api<Dash>(page, '/api/dashboard')).data;
    const due = d.progress.ordersToday;
    expect((due.parts ?? []).reduce((a, p) => a + p.count, 0)).toBe(due.total);
    const lines = d.progress.lines;
    expect((lines.parts ?? []).reduce((a, p) => a + p.count, 0)).toBe(lines.total);
    for (const p of [...(due.parts ?? []), ...(d.progress.tasks.parts ?? [])]) {
      if (!p.href) continue;
      const res = await api<unknown[]>(page, apiOf(p.href));
      expect(res.meta?.total, p.label).toBe(p.count);
    }
  });

  test('Jobs card labels what each tab counts', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('Progress for Today')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('jobs-scope')).toContainText('Open jobs');
    await page.getByLabel('Group jobs by').getByText('Status', { exact: true }).click();
    await expect(page.getByTestId('jobs-scope')).toContainText('completed today');
  });
});

test.describe('reports', () => {
  test('Change Log search deep-links through the URL and a Code cell opens its record', async ({ page }) => {
    await page.goto('/reports/change-log?q=SO&qm=sw');
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 90_000 });
    await expect(page.getByPlaceholder(/Search by code/i)).toHaveValue('SO');
    const link = page.locator("tbody a[href^='/orders/']").first();
    const href = await link.getAttribute('href');
    expect(href).toBeTruthy();
    await link.click();
    await expect(page).toHaveURL(new RegExp(String(href).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  test('Export As Excel → Excel Export History Completed → Download 200', async ({ page }) => {
    const query = 'q=PO00224&qm=sw';
    const expected =
      (await api<unknown[]>(page, `/api/reports/po-receiving?${query}&pageSize=1`)).meta?.total ?? 0;
    const res = await page.request.post(`${base}/api/exports`, {
      headers: { Origin: base },
      data: { gridKey: 'report-po-receiving', query },
    });
    expect(res.status()).toBe(202);
    const task = (await res.json()).data as { id: string };
    let row: { status?: string; rowCount?: number; downloadHref?: string } | undefined;
    await expect
      .poll(
        async () => {
          const list = await api<Record<string, unknown>[]>(page, '/api/reports/export-history?pageSize=50');
          row = list.data.find((r) => r.id === task.id) as typeof row;
          return row?.status;
        },
        { timeout: 120_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toMatch(/completed/i);
    expect(row?.rowCount).toBe(expected);
    const file = await page.request.get(`${base}${row?.downloadHref}`);
    expect(file.status()).toBe(200);
    expect((await file.body()).byteLength).toBeGreaterThan(1000);
  });

  test('PO Receiving difference = Received UOM − PO UOM on every row', async ({ page }) => {
    const rows = (
      await api<
        {
          poQty: number;
          unitsPerPack: number;
          poUomQty: number;
          receivedUomQty: number;
          difference: number | null;
        }[]
      >(page, '/api/reports/po-receiving?pageSize=500')
    ).data;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.poUomQty).toBe(r.poQty * r.unitsPerPack);
      const diff = r.receivedUomQty - r.poUomQty;
      expect(r.difference).toBe(diff === 0 ? null : diff);
    }
  });

  test('a refetch masks the stale rows until the new page arrives', async ({ page }) => {
    await page.goto('/reports/change-log');
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 90_000 });
    const box = page.getByPlaceholder(/Search by code/i);
    await box.fill('SO01');
    await box.press('Enter');
    await expect(page.getByTestId('report-grid-frame'))
      .toHaveAttribute('aria-busy', 'true', { timeout: 5_000 })
      .catch(() => undefined);
    await expect(page.getByTestId('report-grid-frame')).not.toHaveAttribute('data-refreshing', 'true', {
      timeout: 90_000,
    });
  });
});

test.describe('analytics', () => {
  test('app gate: menus and dashboards when active, the activation card when not', async ({ page }) => {
    const me = await api<{ activeApps: string[] }>(page, '/api/me');
    const active = me.data.activeApps.includes('labor-analytics');
    await page.goto('/analytics/labor/average-task');
    if (active) {
      await expect(page.getByRole('heading', { name: 'Average Task Analysis' })).toBeVisible({
        timeout: 90_000,
      });
      await expect(page.getByTestId('activation-card')).toHaveCount(0);
    } else {
      await expect(page.getByTestId('activation-card')).toBeVisible({ timeout: 90_000 });
      await expect(page.getByTestId('activation-card').getByRole('link')).toHaveAttribute(
        'href',
        /\/settings\/apps/,
      );
    }
  });

  const BAR_PAGES = [
    '/analytics/labor/average-task',
    '/analytics/labor/associate-task',
    '/analytics/labor/receiving-performance',
    '/analytics/operational/fulfillment',
    '/analytics/operational/inbound-inventory',
    '/analytics/operational/productivity',
  ];
  for (const path of BAR_PAGES) {
    test(`clicking a bar navigates: ${path}`, async ({ page }) => {
      await page.goto(path);
      const charts = page.locator('section').filter({ has: page.locator('.recharts-bar-rectangle') });
      await expect(charts.first()).toBeVisible({ timeout: 90_000 });
      const n = await charts.count();
      for (let i = 0; i < n; i += 1) {
        if (i > 0) {
          await page.goto(path);
          await expect(charts.nth(i)).toBeVisible({ timeout: 90_000 });
        }
        const bar = charts.nth(i).locator('.recharts-bar-rectangle').first();
        await bar.scrollIntoViewIfNeeded();
        const box = await bar.boundingBox();
        if (!box) continue;
        const before = page.url();
        await page.mouse.move(box.x + box.width / 2, box.y + Math.max(box.height - 3, 1));
        await page.mouse.click(box.x + box.width / 2, box.y + Math.max(box.height - 3, 1));
        await page.waitForURL((u) => u.toString() !== before, { timeout: 30_000 });
        expect(page.url()).not.toContain('/analytics/');
      }
    });
  }

  test('Associate Analysis: picking an associate shows their detail', async ({ page }) => {
    await page.goto('/analytics/labor/associate');
    const picker = page.getByTestId('associate-picker');
    await expect(picker).toBeVisible({ timeout: 90_000 });
    await picker.selectOption({ index: 1 });
    await expect(page.getByTestId('associate-detail')).toBeVisible();
    await expect(
      page.getByTestId('associate-detail').getByRole('link', { name: /Open their tasks/ }),
    ).toHaveAttribute('href', /f\.executedBy=eq:/);
  });

  test('Receiving Performance per-associate links name the associate', async ({ page }) => {
    const d = await api<{ charts: { id: string; rows: { user: string; href: string }[] }[] }>(
      page,
      '/api/analytics/labor/receiving-performance',
    );
    const rows = d.data.charts.find((c) => c.id === 'per-user')?.rows ?? [];
    for (const r of rows) expect(decodeURIComponent(r.href)).toContain(r.user);
    expect(new Set(rows.map((r) => r.href)).size).toBe(rows.length);
  });
});
