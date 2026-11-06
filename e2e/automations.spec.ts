/**
 * Automations center: build a recipe with the sentence builder, toggle it, delete with Undo,
 * inspect run history, add + test + delete a webhook, and open the org usage page.
 */
import type { Page } from '@playwright/test';
import { appShell, authedTest, expect as baseExpect, waitForSettled } from './support/fixtures';

// The shared dev server is often busy (many agents); allow generous per-assertion timeouts.
const expect = baseExpect.configure({ timeout: 30_000 });

async function dealsAutomations(page: Page): Promise<{ base: string; url: string }> {
  await page.goto('/');
  await expect(appShell(page)).toBeVisible();
  const slug = new URL(page.url()).pathname.split('/').filter(Boolean)[0];
  const link = page.locator('a[href*="/boards/"]', { hasText: /^\s*Deals\s*$/ }).first();
  await expect(link).toBeVisible({ timeout: 20_000 });
  const href = (await link.getAttribute('href')) as string;
  return { base: `/${slug}`, url: `${href}/automations` };
}

authedTest.describe('automations center', () => {
  // Independent tests: one failure must not skip the rest.
  authedTest.describe.configure({ mode: 'default', timeout: 240_000 });

  async function openCenter(page: Page, url: string) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1, name: 'Automations' })).toBeVisible();
    await waitForSettled(page, 90_000);
    await expect(page.getByTestId('create-automation')).toBeEnabled();
  }

  authedTest('create a recipe, toggle it, delete with undo', async ({ page, diagnostics }) => {
    const { url } = await dealsAutomations(page);
    await openCenter(page, url);

    // Recipe: "When Stage changes to Lost, then move the deal to <group>".
    await page.getByRole('tab', { name: /^CRM/ }).click();
    await page.locator('[data-recipe-id="crm-lost"]').click();
    const builder = page.getByTestId('automation-builder');
    await expect(builder).toBeVisible();
    const submit = builder.getByTestId('automation-builder-submit');
    await expect(submit).toBeDisabled();
    await expect(builder.getByTestId('automation-builder-status')).toHaveText('1 field left to fill');

    // Stage and Lost were inferred; the group token is focused next and opens on Enter.
    const groupToken = builder.getByRole('button', { name: /^group: not set/ });
    await expect(groupToken).toBeFocused();
    await page.keyboard.press('Enter');
    await page.getByRole('option', { name: /Closed lost/ }).click();
    await expect(submit).toBeEnabled();
    // Everything set: focus moves to the create button, no token keeps a focus ring.
    await expect(submit).toBeFocused();
    await expect(builder.getByTestId('automation-sentence')).toHaveText(
      /When Stage changes to Lost, then move the deal to Closed lost/,
    );
    await submit.click();
    await expect(page.getByText('Automation created')).toBeVisible();
    await expect(page).toHaveURL(/tab=automations/);

    const row = page
      .getByTestId('automation-row')
      .filter({ hasText: 'When Stage changes to Lost, then move the deal to Closed lost' })
      .last();
    await expect(row).toBeVisible();

    // Toggle off (optimistic) and back on.
    const toggle = row.getByTestId('automation-toggle');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText('Automation turned off')).toBeVisible();

    // Delete is committed on the server at once; Undo restores it (still turned off).
    const id = await row.getAttribute('data-automation-id');
    const byId = page.locator(`[data-automation-id="${id}"]`);
    const deleted = () =>
      page.waitForResponse(
        (response) => response.request().method() === 'DELETE' && response.url().includes(`/automations/${id}`),
      );
    await row.getByRole('button', { name: /More actions/ }).click();
    let committed = deleted();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(byId).toHaveCount(0);
    expect((await committed).ok()).toBe(true);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Automation restored')).toBeVisible();
    await expect(byId).toHaveCount(1);
    await expect(byId.getByTestId('automation-toggle')).toHaveAttribute('aria-checked', 'false');

    // Delete again and reload immediately (inside the Undo window): it stays gone.
    await byId.getByRole('button', { name: /More actions/ }).click();
    committed = deleted();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(byId).toHaveCount(0);
    await committed;
    await page.reload();
    await waitForSettled(page, 90_000);
    await expect(page.getByTestId('automation-list').or(page.getByText('No automations yet'))).toBeVisible();
    await expect(byId).toHaveCount(0);
    const listed = await page.evaluate(async (automationId) => {
      const rows = Array.from(document.querySelectorAll('[data-automation-id]'));
      return rows.some((element) => element.getAttribute('data-automation-id') === automationId);
    }, id);
    expect(listed).toBe(false);
    // Message templates never show raw braces anywhere on the list.
    await expect(page.getByText(/\{(name|board)\}/)).toHaveCount(0);
    expect(diagnostics.errors, 'console errors').toEqual([]);
  });

  authedTest('custom builder validates incomplete tokens', async ({ page, diagnostics }) => {
    const { url } = await dealsAutomations(page);
    await openCenter(page, url);
    await page.getByTestId('create-automation').click();
    const builder = page.getByTestId('automation-builder');
    await builder.getByTestId('trigger-option').filter({ hasText: 'When an item is created' }).click();
    await expect(builder.getByTestId('automation-builder-status')).toHaveText('Add at least one action');
    await builder.getByRole('button', { name: 'Add an action' }).click();
    await page.getByRole('menuitem', { name: 'Archive the item' }).click();
    await expect(builder.getByTestId('automation-builder-status')).toHaveText('Ready to go');
    await expect(builder.getByTestId('automation-summary')).toHaveText(
      'When a deal is created, then archive the deal',
    );
    await builder.getByRole('button', { name: 'Add condition' }).click();
    await page.getByRole('menuitem', { name: 'Status is…' }).click();
    // The new condition's first token opens its picker automatically; Esc closes only the picker.
    const picker = page.getByRole('listbox', { name: 'Columns' });
    await expect(picker).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await expect(builder.getByTestId('automation-builder-submit')).toBeDisabled();
    // Unsaved work: closing asks first; Keep editing keeps the builder open.
    await page.keyboard.press('Escape');
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: 'Discard this automation?' }));
    await expect(confirm).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(builder).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(builder).toBeHidden();
    expect(diagnostics.errors, 'console errors').toEqual([]);
  });

  authedTest('run history opens a run in the drawer', async ({ page, diagnostics }) => {
    const { url } = await dealsAutomations(page);
    await openCenter(page, `${url}?tab=runs`);
    const firstRun = page.getByTestId('run-row').first();
    await expect(firstRun).toBeVisible({ timeout: 20_000 });
    await firstRun.click();
    const drawer = page.getByTestId('run-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('What it did')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    // Focus returns to the row that opened the drawer (WCAG 2.4.3).
    await expect(firstRun).toBeFocused();
    expect(diagnostics.errors, 'console errors').toEqual([]);
  });

  authedTest('add, test and delete a webhook', async ({ page, baseURL }) => {
    const { url } = await dealsAutomations(page);
    await openCenter(page, `${url}?tab=integrations`);
    await page.getByTestId('webhook-add').click();
    const dialog = page.getByTestId('webhook-create-dialog');
    await dialog.getByTestId('webhook-create-submit').click();
    await expect(dialog.getByRole('alert').first()).toBeVisible();
    await dialog.getByTestId('webhook-url').fill(`${baseURL ?? 'http://localhost:3100'}/api/v1/health?e2e=1`);
    await dialog.getByTestId('webhook-create-submit').click();
    const secretDialog = page.getByTestId('webhook-secret-dialog');
    await expect(secretDialog.getByTestId('webhook-secret')).toHaveText(/^whsec_/);
    await secretDialog.getByRole('button', { name: 'I’ve saved it' }).click();

    const row = page.getByTestId('webhook-row').filter({ hasText: 'e2e=1' }).last();
    await row.getByTestId('webhook-test').click();
    await expect(page.getByText(/Test delivered|Test delivery failed/)).toBeVisible({ timeout: 15_000 });
    await row.getByTestId('webhook-log').click();
    const log = page.getByTestId('webhook-deliveries');
    await expect(log.getByText('webhook.test').first()).toBeVisible();
    await page.keyboard.press('Escape');

    await row.getByRole('button', { name: 'More webhook actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete webhook' }).click();
    await expect(page.getByText('Webhook deleted')).toBeVisible();
    await expect(page.getByTestId('webhook-row').filter({ hasText: 'e2e=1' })).toHaveCount(0);
  });

  authedTest(
    'org automations page shows usage and automations across boards',
    async ({ page, diagnostics }) => {
      const { base } = await dealsAutomations(page);
      await page.goto(`${base}/automations`);
      await expect(page.getByRole('heading', { level: 1, name: 'Automations' })).toBeVisible();
      await expect(page.getByTestId('usage-meter')).toBeVisible();
      await expect(page.getByTestId('org-automation-row').first()).toBeVisible({ timeout: 20_000 });
      await waitForSettled(page, 90_000);
      expect(diagnostics.errors, 'console errors').toEqual([]);
    },
  );
});
