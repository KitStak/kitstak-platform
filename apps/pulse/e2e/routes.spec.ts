import { expect, test, type Page } from '@playwright/test';
import { apiData, open, signIn, watchPage, type Login } from './support';

/**
 * Smoke for every route in the app, for both demo workspaces. Each page must answer 200, carry
 * its own title ("<Page> · KitStak Pulse"), show a heading, and finish loading with no script
 * error, no console error and no failed request. Read only: nothing is created.
 *   E2E_BASE_URL=http://localhost:3500 npx playwright test e2e/routes.spec.ts
 */

const STATIC: readonly (readonly [path: string, title: string])[] = [
  ['/', 'Home'],
  ['/welcome', 'Getting started'],
  ['/jobs', 'Jobs'],
  ['/jobs?tab=all', 'Jobs'],
  ['/jobs?tab=completed', 'Jobs'],
  ['/jobs?tab=planned', 'Jobs'],
  ['/jobs/new', 'New job'],
  ['/log', 'Log work'],
  ['/log/bulk', 'Log many days'],
  ['/log/review', 'Review the day'],
  ['/log/entries', 'All entries'],
  ['/labor', 'Labor'],
  ['/labor?tab=time', 'Labor'],
  ['/labor?tab=cost', 'Labor'],
  ['/target-pace', 'Target pace'],
  ['/profit', 'Profit'],
  ['/profit?by=client', 'Profit'],
  ['/profit?by=type', 'Profit'],
  ['/profit?by=service', 'Profit'],
  ['/profit?by=site', 'Profit'],
  ['/profit?by=month', 'Profit'],
  ['/profit?by=week', 'Profit'],
  ['/profit?by=day', 'Profit'],
  ['/services', 'Extra services'],
  ['/reports', 'Reports'],
  ['/reports?tab=scheduled', 'Reports'],
  ['/calculator', 'Calculator'],
  ['/goals', 'Goals'],
  ['/alerts', 'Alerts'],
  ['/alerts?tab=snoozed', 'Alerts'],
  ['/alerts/rules', 'Alert rules'],
  ['/import', 'Import'],
  ['/import/new', 'New import'],
  ['/import/new?stream=production', 'New import'],
  ['/export', 'Export'],
  ['/settings', 'Settings'],
  ['/settings?section=people', 'Settings'],
  ['/settings?section=math', 'Settings'],
  ['/settings/close', 'Month close'],
  ['/settings/apps', 'Connected apps'],
  ['/settings/audit', 'Audit log'],
  ['/search?q=labor', 'Search'],
];

const JOB_TABS: readonly (readonly [suffix: string, title: string])[] = [
  ['', 'Job'],
  ['/plan', 'Plan vs actual'],
  ['/work', 'Work log'],
  ['/materials', 'Materials'],
  ['/money-in', 'Money in'],
  ['/activity', 'Activity'],
];

async function check(page: Page, watch: ReturnType<typeof watchPage>, url: string, title: string | RegExp) {
  watch.reset();
  const status = await open(page, url);
  expect(status, `${url} status`).toBe(200);
  await expect(page, `${url} title`).toHaveTitle(typeof title === 'string' ? `${title} · KitStak Pulse` : title);
  await expect(page.locator('h1').first(), `${url} heading`).toBeVisible();
  await expect(page.getByText(/Something went wrong|We could not find/i), `${url} error text`).toHaveCount(0);
  expect(watch.problems, `${url} problems`).toEqual([]);
}

for (const who of ['admin', 'maya'] as const satisfies readonly Login[]) {
  test.describe(`routes as ${who}`, () => {
    test.beforeEach(async ({ page }) => signIn(page, who));

    test('every top level page, tab and settings page renders clean', async ({ page }) => {
      test.setTimeout(600_000);
      const watch = watchPage(page);
      for (const [url, title] of STATIC) await test.step(url, () => check(page, watch, url, title));
    });

    test('a job and every tab, a client, an extra service and every report render clean', async ({ page }) => {
      test.setTimeout(600_000);
      const watch = watchPage(page);
      const jobs = await apiData<{ number: string }[]>(page, 'jobs?tab=open&limit=3');
      expect(jobs.length, 'the demo has open jobs').toBeGreaterThan(0);
      // The tab title leads with the job number, so several open jobs can be told apart.
      for (const [suffix, title] of JOB_TABS) await test.step(`/jobs/:ref${suffix}`, () => check(page, watch, `/jobs/${jobs[0]!.number}${suffix}`, title === 'Job' ? jobs[0]!.number : `${jobs[0]!.number} · ${title}`));
      const clients = await apiData<{ id: string }[]>(page, 'clients');
      await test.step('/clients/:id', () => check(page, watch, `/clients/${clients[0]!.id}`, 'Client'));
      const services = await apiData<{ id: string }[]>(page, 'services');
      await test.step('/services/:id', () => check(page, watch, `/services/${services[0]!.id}`, 'Extra service'));
      // Every report in the library, by its link on the Reports page.
      await open(page, '/reports');
      const slugs = await page.locator('a[href^="/reports/"]').evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute('href') ?? ''))]);
      expect(slugs.length, 'report links on the Reports page').toBeGreaterThanOrEqual(19);
      for (const href of slugs) await test.step(href, () => check(page, watch, href, / · KitStak Pulse$/));
    });

    test('the wall display and deep links from sibling apps', async ({ page }) => {
      const watch = watchPage(page);
      expect(await open(page, '/wall')).toBe(200);
      await expect(page).toHaveTitle('Wall display · KitStak Pulse');
      await expect(page.getByTestId('wall')).toBeVisible();
      expect(watch.problems).toEqual([]);
      // A link for a record with no job yet opens a new job, already filled in.
      await open(page, '/jobs/by-link?type=crm_deal&id=00000000-0000-4000-8000-000000000000');
      await expect(page).toHaveURL(/\/jobs\/new/);
      const clients = await apiData<{ id: string }[]>(page, 'clients');
      await open(page, `/clients/by-link?client=${clients[0]!.id}`);
      await expect(page).toHaveURL(new RegExp(`/clients/${clients[0]!.id}`));
    });
  });
}

test.describe('routes with no sign in', () => {
  test('sign in, forgot password, floor tablet and wall TV pages render clean', async ({ page }) => {
    const watch = watchPage(page);
    expect(await open(page, '/login')).toBe(200);
    await expect(page).toHaveTitle(/KitStak Pulse/);
    expect(watch.problems, '/login').toEqual([]);
    // Password reset is one shared KitStak flow: Pulse sends people to it and never renders its own.
    const reset = await page.request.get('/forgot-password', { maxRedirects: 0 });
    expect(reset.status()).toBe(307);
    expect(reset.headers().location).toMatch(/\/forgot-password$/);
    await open(page, '/kiosk/t/not-a-real-link');
    await expect(page.getByTestId('kiosk')).toContainText('This tablet link is not active');
    await open(page, '/wall/t/not-a-real-link');
    await expect(page.getByTestId('wall')).toContainText('This wall link is not active');
  });

  test('pages that do not exist answer 404', async ({ page }) => {
    await signIn(page, 'admin');
    for (const url of ['/nope', '/jobs/J-0000', '/reports/not-a-report', '/clients/00000000-0000-4000-8000-000000000000', '/services/00000000-0000-4000-8000-000000000000', '/import/00000000-0000-4000-8000-000000000000']) {
      const response = await page.goto(url);
      expect(response?.status(), url).toBe(404);
    }
  });
});
