/**
 * Test fixtures for KitStak specs.
 *
 * - `authedTest`: fails fast with the global-setup login reason when no admin session exists,
 *   and collects page errors / console errors so each test can assert a clean console.
 * - `publicTest`: runs logged out.
 *
 * Locator helpers encode the selector contract documented in docs/QA.md (data-testid first,
 * accessible-role fallbacks second) so specs keep working while features evolve.
 */
import { existsSync, readFileSync } from 'node:fs';
import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { LOGGED_OUT_STATE, type AuthStatus } from './auth';
import { ADMIN_AUTH_STATUS } from './paths';

interface PageDiagnostics {
  readonly errors: string[];
}

function readAuthStatus(): AuthStatus | null {
  if (!existsSync(ADMIN_AUTH_STATUS)) return null;
  try {
    return JSON.parse(readFileSync(ADMIN_AUTH_STATUS, 'utf8')) as AuthStatus;
  } catch {
    return null;
  }
}

/** Console noise from dev tooling that is not an app defect. */
const IGNORED_CONSOLE = [/Download the React DevTools/i, /\[Fast Refresh\]/i, /\[HMR\]/i];

const withDiagnostics = base.extend<{ diagnostics: PageDiagnostics }>({
  diagnostics: async ({ page }, provide) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (!IGNORED_CONSOLE.some((pattern) => pattern.test(text))) errors.push(`console.error: ${text}`);
    });
    await provide({ errors });
  },
});

export const authedTest = withDiagnostics.extend({
  page: async ({ page }, provide) => {
    const status = readAuthStatus();
    if (status && !status.ok) {
      throw new Error(`No demo admin session (global setup): ${status.reason ?? 'unknown reason'}`);
    }
    await provide(page);
  },
});

/**
 * Logged-out tests. The storage state is overridden as a fixture rather than with a top-level
 * `publicTest.use()`: `use()` called while this module loads attaches to whichever spec file
 * imported it first, which silently logged out every `authedTest` in that file.
 */
export const publicTest = withDiagnostics.extend({
  storageState: async ({}, provide) => {
    await provide(LOGGED_OUT_STATE);
  },
});

export { expect };

/** The app shell root. */
export function appShell(page: Page): Locator {
  return page.getByTestId('app-shell').or(page.locator('[data-app-shell]')).first();
}

/** The left sidebar / workspace navigation. */
export function sidebar(page: Page): Locator {
  return page
    .getByTestId('app-sidebar')
    .or(page.getByRole('navigation', { name: /sidebar|workspace|primary|main/i }))
    .first();
}

/** Board links inside the sidebar. */
export function sidebarBoardLinks(page: Page): Locator {
  return sidebar(page).locator('[data-testid="sidebar-board-link"], a[href*="/boards/"]');
}

/** The main board surface (table/grid view). */
export function boardSurface(page: Page): Locator {
  return page.getByTestId('board-table').or(page.getByRole('grid')).or(page.getByRole('treegrid')).first();
}

/** Wait until no skeleton / busy markers remain (see docs/QA.md loading-state contract). */
export async function waitForSettled(page: Page, timeoutMs = 20_000): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('[data-skeleton], [aria-busy="true"]')).toHaveCount(0, { timeout: timeoutMs });
}
