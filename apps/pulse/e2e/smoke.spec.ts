import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Smoke suite for the app frame: sign in, the navigation, every navigation page renders, the command
 * palette, search, device link pages and the health check. Runs against a dev or prod server:
 * `E2E_BASE_URL=http://localhost:3511 npx playwright test e2e/smoke.spec.ts`.
 * It reads only; nothing is created.
 */

const ORIGIN = () => process.env.E2E_AUTH_ORIGIN ?? process.env.E2E_BASE_URL ?? 'http://localhost:3500';

type Cookie = Awaited<ReturnType<import('@playwright/test').BrowserContext['cookies']>>[number];
let session: Cookie[] | null = null;

/**
 * Signs in once per worker through the auth API and reuses the session cookie: the auth server
 * rate limits sign-ins, and every team's suite shares it.
 */
async function signIn(page: Page) {
  // Optional: reuse a saved session (JSON cookie list) instead of signing in again.
  if (!session && process.env.E2E_COOKIES) session = JSON.parse(readFileSync(process.env.E2E_COOKIES, 'utf8')) as Cookie[];
  if (!session) {
    const response = await page.request.post('/api/auth/sign-in/email', {
      data: { email: 'admin@kitstak.io', password: 'KitStak-Demo-2026!' },
      headers: { origin: ORIGIN() },
    });
    expect(response.ok(), `sign in answered ${response.status()}`).toBeTruthy();
    session = await page.context().cookies();
    return;
  }
  await page.context().addCookies(session);
}

/** Pages that live in the More menu: it has to be opened before the link can be clicked. */
const MORE_PAGES = new Set(['nav-target-pace', 'nav-calculator', 'nav-goals', 'nav-import', 'nav-settings']);

const NAV_PAGES: readonly (readonly [testId: string, path: string, heading: string])[] = [
  ['nav-jobs', '/jobs', 'Jobs'],
  ['nav-log', '/log', 'Log work'],
  ['nav-profit', '/profit', 'Profit'],
  ['nav-labor', '/labor', 'Labor'],
  ['nav-alerts', '/alerts', 'Alerts'],
  ['nav-reports', '/reports', 'Reports'],
  ['nav-target-pace', '/target-pace', 'Target pace'],
  ['nav-calculator', '/calculator', 'Calculator'],
  ['nav-goals', '/goals', 'Goals'],
  ['nav-import', '/import', 'Import and export'],
  ['nav-settings', '/settings', 'Settings'],
];

test.describe('smoke', () => {
  test('sign in lands on Home with the shell', async ({ page }) => {
    await page.goto('/login?local=1');
    await page.locator('input[type="email"], input[name="email"]').first().fill('maya@northwind-robotics.example');
    await page.locator('input[type="password"]').fill('Northwind-Demo-2026!');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    await expect(page.getByTestId('topbar-search')).toBeVisible();
    await expect(page.getByTestId('top-nav')).toBeVisible();
  });

  test('signed out visitors are sent to sign in and come back to the page they wanted', async ({ page, baseURL }) => {
    await page.goto('/profit?by=client');
    // One front door (docs/billing/CONTRACTS.md, review round 4). With a Portal address set, this is
    // the Portal sign in and `next` is the full Pulse address. Run alone, it is Pulse's own page and
    // `next` is the path. Either way the person comes back to the page they wanted.
    await expect(page).toHaveURL(/\/login\?/);
    const landed = new URL(page.url());
    expect(landed.pathname).toBe('/login');
    const appOrigin = new URL(baseURL ?? 'http://localhost:3500').origin;
    expect(['/profit?by=client', `${appOrigin}/profit?by=client`]).toContain(landed.searchParams.get('next'));
  });

  test('device link pages need no sign in and show nothing for an unknown link', async ({ page }) => {
    await page.goto('/kiosk/t/not-a-real-link');
    await expect(page.getByTestId('kiosk')).toContainText('This tablet link is not active');
    await page.goto('/wall/t/not-a-real-link');
    await expect(page.getByTestId('wall')).toContainText('This wall link is not active');
  });

  test('health check answers without a session', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    expect(((await response.json()) as { database: string }).database).toBe('ok');
  });

  test.describe('signed in', () => {
    test.beforeEach(async ({ page }) => signIn(page));

    test('the top navigation has seven items and the More menu, and every page opens', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByTestId('nav-home')).toHaveAttribute('aria-current', 'page');
      // The More button toggles its menu, so only press it when the link is not on screen yet.
      const openMore = async (testId: string) => {
        if (!(await page.getByTestId(testId).isVisible())) await page.getByTestId('nav-more').click();
        await expect(page.getByTestId(testId)).toBeVisible();
      };
      for (const [testId, path, heading] of NAV_PAGES) {
        const inMore = MORE_PAGES.has(testId);
        if (inMore) await openMore(testId);
        await page.getByTestId(testId).click();
        await page.waitForURL((url) => url.pathname === path);
        await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
        if (inMore) await openMore(testId);
        await expect(page.getByTestId(testId)).toHaveAttribute('aria-current', 'page');
        if (inMore) {
          await page.keyboard.press('Escape');
          await expect(page.getByTestId(testId)).toBeHidden();
        }
      }
    });

    test('the command palette opens with the keyboard and goes to a page', async ({ page }) => {
      await page.goto('/');
      // The shortcut is registered on hydration: press until the palette answers.
      await expect(async () => {
        await page.keyboard.press('ControlOrMeta+k');
        await expect(page.getByTestId('palette-input')).toBeVisible({ timeout: 2000 });
      }).toPass();
      await page.getByTestId('palette-input').fill('target pace');
      await page.keyboard.press('Enter');
      await page.waitForURL((url) => url.pathname === '/target-pace');
    });

    test('g then j goes to Jobs, and l opens the log', async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('app-shell').click({ position: { x: 600, y: 300 } });
      await page.keyboard.press('g');
      await page.keyboard.press('j');
      await page.waitForURL((url) => url.pathname === '/jobs');
      await page.keyboard.press('l');
      await page.waitForURL((url) => url.pathname === '/log');
    });

    test('search finds pages, reports and data files', async ({ page }) => {
      await page.goto('/search?q=labor');
      await expect(page.getByTestId('search-hit').first()).toBeVisible();
      await page.goto('/search?q=zzzznothing');
      await expect(page.getByTestId('search-empty')).toBeVisible();
    });

    test('an unknown job and an unknown report answer 404 with a helpful page', async ({ page }) => {
      const job = await page.goto('/jobs/J-0000');
      expect(job?.status()).toBe(404);
      await expect(page.getByText('We could not find that')).toBeVisible();
      await expect(page.getByRole('link', { name: 'See all jobs' })).toBeVisible();
      const response = await page.goto('/reports/not-a-report');
      expect(response?.status()).toBe(404);
    });

    test('the app switcher lists Pulse as the current app', async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('app-switcher').click();
      await expect(page.getByTestId('app-switcher-pulse')).toHaveAttribute('aria-current', 'true');
    });

    test('me returns the Pulse role and money rights', async ({ page }) => {
      const response = await page.request.get('/api/v1/me');
      expect(response.status()).toBe(200);
      const body = (await response.json()) as { data: { pulseRole: string; seesMoney: boolean; modules: { pulse: boolean } } };
      // Admin through the WMS role before the seed runs; the seed makes the seed actor an explicit Pulse owner.
      expect(['owner', 'admin']).toContain(body.data.pulseRole);
      expect(body.data.seesMoney).toBe(true);
      expect(body.data.modules.pulse).toBe(true);
    });
  });
});
