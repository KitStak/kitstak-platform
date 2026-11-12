/**
 * Role-aware Playwright test fixtures.
 *
 *   import { test, expect } from "../fixtures/auth";
 *
 *   test("admin sees settings", async ({ adminPage }) => { ... });
 *   test("viewer is read-only", async ({ asRole }) => {
 *     const page = await asRole("viewer");
 *   });
 *
 * Each role page lives in its own browser context built from the storage state
 * the auth-setup project saved, so roles never share cookies. The default
 * `page` fixture is the admin unless a project overrides `storageState`.
 */
import fs from 'node:fs';
import { test as base, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { loginViaApi } from './login';
import { storageStatePath, type Role } from './roles';

export interface RoleFixtures {
  adminPage: Page;
  managerPage: Page;
  operatorPage: Page;
  viewerPage: Page;
  /** Opens a page logged in as `role`; contexts are closed after the test. */
  asRole: (role: Role) => Promise<Page>;
}

async function newRoleContext(browser: Browser, role: Role): Promise<BrowserContext> {
  const statePath = storageStatePath(role);
  if (fs.existsSync(statePath)) {
    return browser.newContext({ storageState: statePath });
  }
  // Setup project was skipped (e.g. --project filter): log in on demand.
  const context = await browser.newContext();
  await loginViaApi(context.request, role);
  return context;
}

function rolePageFixture(role: Role) {
  return async ({ browser }: { browser: Browser }, provide: (page: Page) => Promise<void>): Promise<void> => {
    const context = await newRoleContext(browser, role);
    try {
      await provide(await context.newPage());
    } finally {
      await context.close();
    }
  };
}

export const test = base.extend<RoleFixtures>({
  adminPage: rolePageFixture('admin'),
  managerPage: rolePageFixture('manager'),
  operatorPage: rolePageFixture('operator'),
  viewerPage: rolePageFixture('viewer'),
  asRole: async ({ browser }, provide) => {
    const contexts: BrowserContext[] = [];
    try {
      await provide(async (role: Role) => {
        const context = await newRoleContext(browser, role);
        contexts.push(context);
        return context.newPage();
      });
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  },
});

export { expect };
