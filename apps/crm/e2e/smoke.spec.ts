/**
 * Smoke flow: login page → sign in → app shell → sidebar boards → open a board.
 * Uses the selector contract from docs/QA.md (data-testid first, roles as fallback).
 */
import { loadCredentials } from './support/credentials';
import {
  appShell,
  authedTest,
  boardSurface,
  expect,
  publicTest,
  sidebar,
  sidebarBoardLinks,
  openCrmMenu,
  waitForSettled,
} from './support/fixtures';

const LOGIN_PATH = /\/login(\?|$)/;

publicTest.describe('logged out', () => {
  publicTest('login page renders an accessible sign-in form', async ({ page, diagnostics }) => {
    const response = await page.goto('/login?local=1');
    expect(response?.status(), 'GET /login status').toBeLessThan(400);

    await expect(page.getByLabel(/email/i).first()).toBeVisible();
    await expect(page.getByLabel(/^password/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^(sign in|log in|continue)/i }).first()).toBeEnabled();
    await expect(page).toHaveTitle(/kitstak/i);
    expect(diagnostics.errors, 'console errors on /login').toEqual([]);
  });

  publicTest('signing in with the demo admin lands in the app', async ({ page }) => {
    const credentials = loadCredentials();
    await page.goto('/login?local=1');
    await page.getByLabel(/email/i).first().fill(credentials.email);
    await page
      .getByLabel(/^password/i)
      .first()
      .fill(credentials.password);
    await page
      .getByRole('button', { name: /^(sign in|log in|continue)/i })
      .first()
      .click();

    await expect(page).not.toHaveURL(LOGIN_PATH, { timeout: 30_000 });
    await expect(appShell(page).or(sidebar(page)).first()).toBeVisible({ timeout: 30_000 });
  });

  publicTest('wrong password shows an inline error and stays on login', async ({ page }) => {
    const credentials = loadCredentials();
    await page.goto('/login?local=1');
    await page.getByLabel(/email/i).first().fill(credentials.email);
    await page
      .getByLabel(/^password/i)
      .first()
      .fill(`${credentials.password}-wrong`);
    await page
      .getByRole('button', { name: /^(sign in|log in|continue)/i })
      .first()
      .click();

    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page).toHaveURL(LOGIN_PATH);
  });
});

authedTest.describe('signed in', () => {
  authedTest('root redirects into the org and the app shell loads', async ({ page, diagnostics }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/[a-z0-9-]+(\/|$)/i);
    await expect(page).not.toHaveURL(LOGIN_PATH);
    await expect(appShell(page)).toBeVisible();
    await expect(sidebar(page)).toBeVisible();
    await waitForSettled(page);
    expect(diagnostics.errors, 'console errors in app shell').toEqual([]);
  });

  authedTest('navigation lists the seeded boards', async ({ page }) => {
    await page.goto('/');
    await expect(sidebar(page)).toBeVisible();
    await openCrmMenu(page);
    await expect(sidebarBoardLinks(page).first()).toBeVisible();
    // The CRM boards load after first paint; poll until the menu has rendered them.
    await expect
      .poll(async () => sidebarBoardLinks(page).count(), { message: 'seeded board count', timeout: 20_000 })
      .toBeGreaterThanOrEqual(3);
  });

  authedTest('opening a board shows its header and table', async ({ page, diagnostics }) => {
    await page.goto('/');
    await openCrmMenu(page);
    const firstBoard = sidebarBoardLinks(page).first();
    await expect(firstBoard).toBeVisible();
    const boardName = (await firstBoard.innerText()).trim().split('\n')[0];

    await firstBoard.click();
    await expect(page).toHaveURL(/\/boards\//);
    await waitForSettled(page);
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(boardName);
    await expect(boardSurface(page)).toBeVisible();
    expect(diagnostics.errors, 'console errors on board').toEqual([]);
  });
});
