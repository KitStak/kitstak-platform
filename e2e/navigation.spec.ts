/**
 * Every shell destination resolves to a real page (no framework 404), renders inside the app
 * shell and logs no console errors. Also covers public legal pages and the phone-width drawer.
 */
import type { Page } from '@playwright/test';
import { appShell, authedTest, expect, publicTest, waitForSettled, openWorkspacesMenu } from './support/fixtures';

async function orgBase(page: Page): Promise<string> {
  await page.goto('/');
  await expect(appShell(page)).toBeVisible();
  const { pathname } = new URL(page.url());
  const slug = pathname.split('/').filter(Boolean)[0];
  expect(slug, 'org slug after redirect').toBeTruthy();
  return `/${slug}`;
}

const DESTINATIONS: readonly { path: string; heading: RegExp }[] = [
  { path: '/my-work', heading: /my work/i },
  { path: '/inbox', heading: /inbox/i },
  { path: '/inbox?tab=notifications', heading: /inbox/i },
  { path: '/import', heading: /import data/i },
  { path: '/admin', heading: /administration/i },
  { path: '/admin/members', heading: /members/i },
  { path: '/settings/profile', heading: /my profile/i },
  { path: '/trash', heading: /trash/i },
];

authedTest.describe('shell destinations', () => {
  for (const destination of DESTINATIONS) {
    authedTest(`${destination.path} renders inside the shell`, async ({ page, diagnostics }) => {
      const base = await orgBase(page);
      const response = await page.goto(`${base}${destination.path}`);
      expect(response?.status(), `GET ${destination.path}`).toBeLessThan(400);
      await expect(appShell(page)).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(destination.heading);
      await waitForSettled(page);
      expect(diagnostics.errors, `console errors on ${destination.path}`).toEqual([]);
    });
  }

  authedTest('workspace and dashboard links from the Workspaces menu open real pages', async ({ page, diagnostics }) => {
    await orgBase(page);
    const menu = await openWorkspacesMenu(page);
    const dashboardLink = menu.locator('a[href*="/dashboards/"]').first();
    await expect(dashboardLink).toBeVisible({ timeout: 20_000 });
    await dashboardLink.click();
    await expect(page).toHaveURL(/\/dashboards\//);
    await waitForSettled(page);
    await expect(page.getByRole('heading', { level: 1 }).first()).not.toHaveText(/could not be found/i);
    expect(diagnostics.errors, 'console errors on dashboard').toEqual([]);
  });

  authedTest('unknown routes show the branded in-shell 404', async ({ page }) => {
    const base = await orgBase(page);
    await page.goto(`${base}/definitely-not-a-page`);
    await expect(appShell(page)).toBeVisible();
    await expect(page.getByText(/couldn't find that page/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /go home/i })).toHaveAttribute('href', base);
  });

  authedTest('phone width uses an off-canvas navigation drawer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await orgBase(page);
    await expect(page.getByTestId('app-sidebar')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = page.getByTestId('mobile-nav');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('link', { name: /my work/i })).toBeVisible();
    await drawer.getByRole('link', { name: /my work/i }).click();
    await expect(page).toHaveURL(/\/my-work/);
    await expect(drawer).toBeHidden();
  });
});

publicTest.describe('legal pages', () => {
  for (const path of ['/privacy', '/terms']) {
    publicTest(`${path} is public`, async ({ page, diagnostics }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBeLessThan(400);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(diagnostics.errors).toEqual([]);
    });
  }
});
