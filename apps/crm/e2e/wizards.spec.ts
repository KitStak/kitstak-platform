/**
 * Wizards module: a brand-new user signs up (API), runs the /welcome onboarding, lands on the
 * new org home, then (one test per wizard, sharing that user's session) creates a board from
 * the template center, quick-creates a board, adds a workspace and folder, and invites
 * teammates. Everything happens inside the throwaway org so seeded demo data and ids used by
 * other specs are never touched. Serial: a slow navigation fails only its own test.
 *
 * Waits are deterministic (responses, visible state) with generous timeouts: the dev server is
 * shared by many agents and first compiles of a route can take a while.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import pg from 'pg';
import { expect, publicTest, waitForSettled } from './support/fixtures';

const SLOW = { timeout: 120_000 };
const STATE_PATH = '.qa/wizards-e2e-state.json';
const SLUG_PATH = '.qa/wizards-e2e-slug.txt';
/**
 * Org slug of the user signed up in the first test (serial mode keeps one worker). Saved with
 * the session so the signed-in tests can be re-run alone (`-g "signed in"`) after a flaky run.
 */
let slug = existsSync(SLUG_PATH) && existsSync(STATE_PATH) ? readFileSync(SLUG_PATH, 'utf8').trim() : '';

async function signUpFreshUser(page: Page, baseURL: string): Promise<void> {
  // Sign-up is rate limited (5 per 10 min per IP); wait out a 429 on a busy shared machine.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { status, email } = await trySignUp(page, baseURL);
    if (status < 400) {
      await markEmailVerified(email);
      return;
    }
    expect(status, `sign-up status ${status}`).toBe(429);
    await page.waitForTimeout(60_000);
  }
  throw new Error('sign-up kept returning 429');
}

/**
 * Inviting needs a verified email at every door, the CRM's too (billing review round 5: the CRM
 * dialog goes through the shared invite door). A person verifies with the emailed code in the
 * Portal. This spec runs the CRM alone, so one statement on the local test database stands in for
 * that step. Without it the wizard's invite step is refused with "Verify your email first."
 */
async function markEmailVerified(email: string): Promise<void> {
  const client = new pg.Client({
    connectionString: process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5544/kitstak',
  });
  await client.connect();
  try {
    await client.query(`UPDATE core."user" SET email_verified = true WHERE email = $1`, [email.toLowerCase()]);
  } finally {
    await client.end();
  }
}

async function trySignUp(page: Page, baseURL: string): Promise<{ status: number; email: string }> {
  const suffix = randomBytes(6).toString('hex');
  const email = `wizards-e2e-${suffix}@example.test`;
  const response = await page.request.post('/api/auth/sign-up/email', {
    timeout: 90_000,
    headers: { origin: baseURL, 'content-type': 'application/json' },
    data: {
      name: `Wizard Tester ${suffix}`,
      email,
      // Throwaway test password generated per run for a local dev account.
      password: `Kt-${randomBytes(12).toString('base64url')}9a`,
    },
  });
  return { status: response.status(), email };
}

/** Open the template center by deep link and wait for the gallery payload, not a fixed delay. */
async function openTemplateCenter(page: Page, slug: string, query = '') {
  const gallery = page.waitForResponse(
    (response) => response.url().includes('/api/v1/wizards/templates') && response.ok(),
    SLOW,
  );
  await page.goto(`/${slug}?wizard=templates${query}`, { timeout: 90_000 });
  await gallery.catch(() => undefined); // already cached in this session: nothing to wait for
}

/**
 * Let in-flight requests finish before reading console diagnostics. The pages the wizards land
 * on (org home, boards) belong to other modules and can keep skeletons up for a long time on
 * the shared dev server; that is not a wizards failure, so a slow settle is tolerated here.
 */
async function settleQuietly(page: Page): Promise<void> {
  await waitForSettled(page, 45_000).catch(() => undefined);
}

publicTest.describe.configure({ mode: 'serial' });

publicTest.describe('wizards', () => {
  publicTest.setTimeout(600_000);

  publicTest(
    'welcome onboarding lands on the new org home',
    async ({ page, context, baseURL, diagnostics }) => {
      await signUpFreshUser(page, baseURL ?? 'http://localhost:3100');
      {
        // The CRM's own setup. A plain /welcome points to the Portal when a Portal address is set.
        await page.goto('/welcome?local=1', { timeout: 90_000 });
        const flow = page.getByTestId('onboarding-flow');
        await expect(flow).toBeVisible(SLOW);
        await expect(page.getByTestId('onboarding-step-count')).toHaveText('Step 1 of 6');
        await expect(page.getByTestId('onboarding-org-input')).toHaveAttribute(
          'placeholder',
          'e.g. Acme Robotics',
        );
        const headingY = async () => {
          await page.evaluate(() =>
            Promise.all(document.getAnimations().map((animation) => animation.finished)),
          );
          return (await page.getByTestId('onboarding-heading').boundingBox())?.y ?? 0;
        };
        const firstHeadingY = await headingY();

        // Validation: Continue with an empty company name shows an inline error.
        await page.getByTestId('onboarding-next').click();
        await expect(page.getByRole('alert').filter({ hasText: /company or team name/i })).toBeVisible();

        await page.getByTestId('onboarding-org-input').fill('Wizard Test Co');
        await expect(page.getByTestId('onboarding-preview-company')).toHaveText('Wizard Test Co');
        await page
          .getByTestId('onboarding-roles')
          .getByRole('radio', { name: /account executive/i })
          .click();
        await page.keyboard.press('Enter');
        await expect(page.getByTestId('onboarding-step-count')).toHaveText('Step 2 of 6');
        // Top-anchored steps: the heading does not jump between steps.
        expect(Math.abs((await headingY()) - firstHeadingY)).toBeLessThan(2);

        // Team size: one 3-column grid (no orphaned last option), equal heights.
        const sizes = page.getByTestId('onboarding-team-size').getByRole('radio');
        await expect(sizes).toHaveCount(6);
        const tops = await sizes.evaluateAll((nodes) =>
          nodes.map((node) => Math.round(node.getBoundingClientRect().top)),
        );
        expect(new Set(tops).size).toBe(2);
        await page
          .getByTestId('onboarding-team-size')
          .getByRole('radio', { name: /6 to 20 people/ })
          .click();
        await page.screenshot({ path: '.qa/screens/wizr3-welcome-team-light.png' });
        await page.getByTestId('onboarding-next').click();
        await page
          .getByTestId('onboarding-manages')
          .getByRole('checkbox', { name: 'Deals & pipeline' })
          .click();
        await page
          .getByTestId('onboarding-manages')
          .getByRole('checkbox', { name: 'Quotes & proposals' })
          .click();
        await page.getByTestId('onboarding-next').click();

        // Back keeps answers.
        await expect(page.getByTestId('onboarding-step-count')).toHaveText('Step 4 of 6');
        await page.getByTestId('onboarding-back').click();
        await expect(
          page.getByTestId('onboarding-manages').getByRole('checkbox', { name: 'Deals & pipeline' }),
        ).toHaveAttribute('aria-checked', 'true');
        await page.getByTestId('onboarding-next').click();

        const starters = page.getByTestId('onboarding-starters');
        await expect(starters.getByRole('radio', { name: /pipeline essentials/i })).toHaveAttribute(
          'aria-checked',
          'true',
        );
        await expect(page.getByTestId('onboarding-board-list')).toContainText('Quotes & proposals');
        // One row: two thumbnails plus a "+N more boards" tile, no orphan on a second row.
        await expect(page.getByTestId('onboarding-starter-thumbnails').locator('li')).toHaveCount(3);
        await expect(page.getByTestId('onboarding-starter-more')).toBeVisible();
        expect(Math.abs((await headingY()) - firstHeadingY)).toBeLessThan(2);
        await page.screenshot({ path: '.qa/screens/wizr3-welcome-starter-light.png' });
        // Footer buttons line up with the content column.
        const footer = await page.getByTestId('onboarding-footer').boundingBox();
        const content = await starters.boundingBox();
        expect(Math.abs((footer?.x ?? 0) - (content?.x ?? 0))).toBeLessThan(10);
        await page.getByTestId('onboarding-next').click();

        const email = page.getByTestId('invite-email-input');
        await email.fill('not-an-email');
        await email.press('Enter');
        await expect(page.getByRole('alert').filter({ hasText: /valid email/i })).toBeVisible();
        await email.fill('ana@example.test, bo@example.test');
        await email.press('Enter');
        await expect(page.getByTestId('invitee-row')).toHaveCount(2);
        await page.getByTestId('onboarding-next').click();

        await expect(page.getByTestId('onboarding-done')).toBeVisible({ timeout: 300_000 });
        await expect(page.getByTestId('onboarding-done')).toContainText('2 invitations sent');
        const go = page.getByRole('button', { name: 'Go to my workspace' });
        await expect(go).toBeEnabled(SLOW);
        await go.click(SLOW);
        await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 90_000 });
      }

      slug = new URL(page.url()).pathname.split('/').filter(Boolean)[0] ?? '';
      expect(slug).toBeTruthy();
      mkdirSync('.qa', { recursive: true });
      await context.storageState({ path: STATE_PATH });
      writeFileSync(SLUG_PATH, slug);
      await settleQuietly(page);
      expect(diagnostics.errors).toEqual([]);
    },
  );

  publicTest.describe('signed in as the new owner', () => {
    publicTest.use({ storageState: async ({}, provide) => provide(STATE_PATH) });
    publicTest.beforeEach(() => {
      publicTest.skip(!slug, 'onboarding test did not finish');
    });
    publicTest.afterEach(async ({ page, diagnostics }) => {
      await settleQuietly(page);
      expect(diagnostics.errors).toEqual([]);
    });

    publicTest('template center: search, Esc steps back, create board', async ({ page }) => {
      {
        await openTemplateCenter(page, slug);
        await expect(page.getByTestId('template-grid')).toBeVisible(SLOW);
        const search = page.getByTestId('template-search');
        await search.fill('close probability');
        await expect(page.locator('[data-template-id="crm-deals"]')).toBeVisible();
        // Esc in a non-empty search clears it and keeps the center open.
        await search.press('Escape');
        await expect(search).toHaveValue('');
        await expect(page.getByTestId('template-center')).toBeVisible();

        await search.fill('recruit');
        const card = page.locator('[data-template-id="hr-recruiting"]');
        await expect(card).toBeVisible();
        await card.hover();
        await card.getByRole('button', { name: 'Preview', exact: true }).click();
        await expect(page.getByTestId('template-detail')).toBeVisible();
        await expect(page.getByTestId('template-preview-board')).toContainText('Riley Okafor');
        // Every group has rows and owners render as avatars, not empty glyphs.
        const groupCount = await page.getByTestId('preview-group-title').count();
        expect(await page.getByTestId('preview-row').count()).toBeGreaterThanOrEqual(groupCount * 2);
        // Esc on the detail goes back to the grid, not out of the modal.
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('template-grid')).toBeVisible();
        await card.hover();
        await card.getByRole('button', { name: 'Preview', exact: true }).click();
        await page.getByTestId('template-use').click();

        const name = page.getByTestId('board-name-input');
        await expect(name).toHaveValue('Recruiting pipeline');
        await name.fill('Q1 hiring');
        // Back to templates and in again keeps the typed name.
        await page.getByRole('button', { name: 'Back to templates' }).click();
        await expect(page.getByTestId('template-detail')).toBeVisible();
        await page.getByTestId('template-use').click();
        await expect(name).toHaveValue('Q1 hiring');

        await page
          .getByTestId('privacy-options')
          .getByRole('radio', { name: /private/i })
          .click();
        await page.getByTestId('create-board-submit').click();
        // The toast fires as soon as POST /boards resolves (no waiting on list refetches).
        await expect(page.getByText(/Sample candidates included/)).toBeVisible(SLOW);
        await page.waitForURL(/\/boards\//, SLOW);
        await expect(page.getByRole('heading', { level: 1, name: 'Q1 hiring' })).toBeVisible(SLOW);
      }
    });

    publicTest('deep links: params removed at once, unknown template explains itself', async ({ page }) => {
      await openTemplateCenter(page, slug, '&template=does-not-exist');
      await expect(page.getByTestId('template-center')).toBeVisible(SLOW);
      await expect(page.getByText('That template is no longer available')).toBeVisible(SLOW);
      expect(page.url()).not.toContain('wizard=');
      await page.reload({ timeout: 120_000 });
      await expect(page.getByTestId('app-shell')).toBeVisible(SLOW);
      await expect(page.getByTestId('template-center')).toBeHidden();
    });

    publicTest('quick create: no layout shift, Esc guard after a select, focus restore', async ({ page }) => {
      {
        await page.goto(`/${slug}?wizard=new-board`, { timeout: 120_000 });
        const setup = page.getByTestId('board-setup');
        await expect(setup).toBeVisible(SLOW);
        const dialog = page.getByTestId('create-board-wizard');
        // Measure after the entrance animation, while lists may still be loading.
        await dialog.evaluate((node) =>
          Promise.all(node.getAnimations().map((animation) => animation.finished)),
        );
        const topBefore = (await dialog.boundingBox())?.y ?? 0;
        await expect(page.getByTestId('sample-data-row').getByRole('switch')).toBeVisible(SLOW);
        const topAfter = (await dialog.boundingBox())?.y ?? 0;
        expect(Math.abs(topAfter - topBefore)).toBeLessThan(1);

        // Blank name explains itself instead of silently disabling.
        const name = page.getByTestId('board-name-input');
        await name.fill('');
        await page.getByTestId('create-board-submit').click();
        await expect(page.getByText('Give your board a name.')).toBeVisible();
        await name.fill('Lead list');

        await page.getByTestId('managing-chips').getByRole('radio', { name: 'Leads' }).click();
        await expect(page.getByTestId('mini-preview-add')).toHaveText(/New lead/);

        // Open the Workspace select, close it with Esc, then Esc again asks to discard.
        await setup.getByRole('combobox').first().click();
        await expect(page.getByRole('listbox')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('listbox')).toBeHidden();
        await expect(setup).toBeVisible();
        await page.keyboard.press('Escape');
        const confirm = page.getByRole('alertdialog', { name: /discard changes/i });
        await expect(confirm).toBeVisible();
        await expect(page.getByTestId('discard-scrim')).toBeVisible();

        // Keep editing returns focus into the wizard, not <body>.
        await confirm.getByRole('button', { name: 'Keep editing' }).click();
        await expect(confirm).toBeHidden();
        const focusInDialog = await page.evaluate(() =>
          Boolean(document.activeElement?.closest('[role="dialog"]')),
        );
        expect(focusInDialog).toBe(true);

        await page.keyboard.press('Escape');
        await page.getByTestId('discard-confirm-button').click();
        await expect(setup).toBeHidden();
        const focusTag = await page.evaluate(() => document.activeElement?.tagName ?? 'BODY');
        expect(focusTag).not.toBe('BODY');
      }
    });

    publicTest('add workspace', async ({ page }) => {
      {
        await page.goto(`/${slug}?wizard=workspace`, { timeout: 120_000 });
        const dialog = page.getByTestId('add-workspace-dialog');
        await expect(dialog).toBeVisible(SLOW);
        await dialog.getByTestId('workspace-name-input').fill('Partner team');
        await dialog.getByTestId('workspace-icons').getByRole('radio').nth(2).click();
        await dialog.getByRole('radio', { name: /closed/i }).click();
        await expect(dialog.getByTestId('workspace-icon-letter')).toHaveText('P');
        const created = page.waitForResponse(
          (response) =>
            response.url().endsWith('/api/v1/workspaces') && response.request().method() === 'POST',
          SLOW,
        );
        await dialog.getByTestId('workspace-create-submit').click();
        expect((await created).status()).toBe(201);
        await expect(page.getByText(/Workspace “Partner team” created/)).toBeVisible(SLOW);
        await expect(dialog).toBeHidden(SLOW);
        await page.waitForURL(/\/workspaces\//, SLOW);
      }
    });

    publicTest('add folder', async ({ page }) => {
      {
        await page.goto(`/${slug}?wizard=folder`, { timeout: 120_000 });
        const folder = page.getByTestId('add-folder-dialog');
        await expect(folder).toBeVisible(SLOW);
        // Blank name: an inline message, not a silently disabled button.
        await folder.getByTestId('folder-create-submit').click();
        await expect(folder.getByText('Give your folder a name.')).toBeVisible();
        await folder.getByTestId('folder-name-input').fill('Strategic accounts');
        await expect(folder.getByRole('combobox').last()).toBeVisible(SLOW); // location loaded
        await folder.getByTestId('folder-create-submit').click();
        await expect(folder).toBeHidden(SLOW);
        await expect(page.getByText(/Folder “Strategic accounts” created/)).toBeVisible();
      }
    });

    publicTest(
      'invite members, pending list, copied link opens the accept page',
      async ({ page, context, baseURL }) => {
        {
          await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
            origin: baseURL ?? 'http://localhost:3100',
          });
          await page.goto(`/${slug}?wizard=invite`, { timeout: 120_000 });
          const dialog = page.getByTestId('invite-dialog');
          await expect(dialog).toBeVisible(SLOW);
          const input = dialog.getByTestId('invite-email-input');
          await input.fill('Cara Diaz <cara@example.test>; dan@example.test');
          await input.press('Enter');
          await expect(dialog.getByTestId('invitee-row')).toHaveCount(2);
          await expect(dialog.getByTestId('invitee-name')).toHaveText('Cara Diaz');
          await expect(dialog.getByTestId('invite-role-hint')).toHaveText('Member: create and edit boards');
          // Your own address is flagged instead of becoming a chip.
          const me = await page.evaluate(async () => {
            const body = (await (await fetch('/api/v1/me')).json()) as {
              data?: { user?: { email?: string } };
              user?: { email?: string };
            };
            return body.data?.user?.email ?? body.user?.email ?? '';
          });
          expect(me).toContain('@');
          await input.fill(me);
          await input.press('Enter');
          await expect(dialog.getByRole('alert').filter({ hasText: /that’s you/i })).toBeVisible();
          await input.fill('');
          await expect(dialog.getByTestId('invitee-row')).toHaveCount(2);

          const sent = page.waitForResponse(
            (response) => response.url().includes('/api/v1/wizards/invitations'),
            SLOW,
          );
          await dialog.getByTestId('invite-send').click();
          expect((await sent).ok()).toBe(true);
          await expect(page.getByTestId('pending-tab')).toHaveAttribute('data-state', 'active', SLOW);
          await expect(dialog.getByTestId('pending-invitation')).toHaveCount(4, SLOW);
          await page.screenshot({ path: '.qa/screens/wizr3-invite-pending-light.png' });

          await dialog.getByRole('button', { name: /copy invite link for cara@example.test/i }).click();
          const link = await page.evaluate(() => navigator.clipboard.readText());
          // Billing review round 5: with a Portal address set, the copied link is the Portal's invite
          // page, where a person can prove the mailbox with an emailed code. It never carries the
          // proof itself. The CRM running alone still hands out its own accept page.
          expect(link).toMatch(/\/(welcome\/)?invite\/[0-9a-f-]{36}$/);
          expect(link).not.toContain('?');
          const invitationId = link.split('/').pop() ?? '';
          // An older copied link (the CRM's own page) still opens.
          await page.goto(`/welcome/invite/${invitationId}`, { timeout: 90_000 });
          // Signed in as the owner, not Cara: the page explains instead of 404-ing.
          await expect(page.getByTestId('invite-accept')).toHaveAttribute('data-state', 'mismatch', SLOW);
          await page.screenshot({ path: '.qa/screens/wizr3-invite-accept-mismatch.png' });
        }
      },
    );

    publicTest('invite dialog on a phone: email field keeps its height', async ({ page }) => {
      {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`/${slug}?wizard=invite`, { timeout: 120_000 });
        const input = page.getByTestId('invite-email-input');
        await expect(input).toBeVisible(SLOW);
        // Measure after the dialog's scale-in animation has settled.
        await page
          .getByTestId('invite-dialog')
          .evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished)));
        const box = await input.locator('xpath=..').boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
      }
    });
  });
});
