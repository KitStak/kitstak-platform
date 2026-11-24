import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  APP_URLS,
  CART_CRM_2,
  CART_CRM_WMS,
  CART_PULSE,
  appIsUp,
  expectPhase,
  holdDevReloads,
  inviteLinkFor,
  invitePerson,
  joinFromInvite,
  newPerson,
  openBilling,
  paidAccount,
  resetRateLimits,
  runTestTool,
  setStepper,
  skipDays,
  trialAccount,
} from './support';

/**
 * Review round 4, the screens. Each test is one thing a reviewer saw go wrong:
 *   - the signup password area: the error sits right under the field, the code choice is a quiet
 *     row of its own, and a password built on the company name says so,
 *   - the confirm panel of a plan change gives focus back to "Review change",
 *   - a paid plan with every app off points at "cancel your plan" instead of a dead button,
 *   - the invoices table at 768 px, the setup guide on a phone, one select style, one no
 *     organization screen, and a banner that names who can pay when the viewer cannot.
 */

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } as const;

/** The element that has focus, by test id or by its first words. */
async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return 'BODY';
    return element.dataset.testid ?? (element.innerText || element.tagName).trim().slice(0, 40);
  });
}

/** Text on the page that the focus ring of the focused element runs through. Empty when it touches none. */
async function textUnderFocusRing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const reach = (Number.parseFloat(style.outlineOffset) || 0) + (Number.parseFloat(style.outlineWidth) || 0);
    const ring = { top: rect.top - reach, bottom: rect.bottom + reach, left: rect.left - reach, right: rect.right + reach };
    const hits: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent?.trim() || element.contains(node)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (box.width > 0 && box.height > 0 && box.left < ring.right && box.right > ring.left && box.top < ring.bottom && box.bottom > ring.top) {
          hits.push(node.textContent.trim().slice(0, 40));
        }
      }
    }
    return hits;
  });
}

/** How many lines the text of an element takes on screen. */
async function linesOf(locator: Locator): Promise<number> {
  return locator.first().evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const tops = new Set<number>();
    for (const box of range.getClientRects()) if (box.width > 0) tops.add(Math.round(box.top));
    return tops.size;
  });
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.first().boundingBox();
  if (!found) throw new Error('The element is not on the page.');
  return found;
}

test.describe('review round 4: the signup password area', () => {
  test('the error sits under the field, the code choice is its own quiet row, and the company name is named', async ({ page }) => {
    await resetRateLimits();
    await page.goto('/signup');
    await expect(page.getByTestId('signup-form')).toBeVisible({ timeout: 90_000 });

    // Create account with nothing typed: every field says what it needs.
    await page.getByTestId('signup-submit').click();
    const error = page.getByTestId('password-error');
    await expect(error).toHaveText('Enter a password.');
    const field = await box(page.getByTestId('signup-password'));
    const line = await box(error);
    const rules = await box(page.getByTestId('password-rules'));
    const submit = await box(page.getByTestId('signup-submit'));
    const code = await box(page.getByTestId('signup-email-code'));
    // The order, top to bottom: field, its error, the rules, ..., the button, the code choice.
    expect(line.y, 'the error starts right under the field').toBeGreaterThanOrEqual(field.y + field.height);
    expect(line.y - (field.y + field.height), 'nothing sits between the field and its error').toBeLessThan(24);
    expect(rules.y).toBeGreaterThan(line.y);
    expect(code.y, 'the code choice is under the button, not inside the password field').toBeGreaterThan(submit.y + submit.height);
    // The field, its error and its rules belong together: no button or link sits between them.
    const between = await page.evaluate(
      ([top, bottom]) =>
        [...document.querySelectorAll('button, a[href]')]
          .filter((control) => {
            const rect = control.getBoundingClientRect();
            return rect.height > 0 && rect.top >= top! && rect.bottom <= bottom!;
          })
          .map((control) => (control.textContent ?? '').trim()),
      [field.y + field.height, rules.y + rules.height],
    );
    expect(between, 'no button or link between the password field and the end of its rules').toEqual([]);

    // The code choice reads as a link, is big enough to press, and its focus ring touches no other text.
    const codeLink = page.getByTestId('signup-email-code');
    await expect(codeLink).toHaveCSS('text-decoration-line', 'underline');
    expect(code.height).toBeGreaterThanOrEqual(44);
    await page.getByTestId('signup-submit').focus();
    await page.keyboard.press('Tab');
    expect(await focused(page)).toBe('signup-email-code');
    expect(await textUnderFocusRing(page)).toEqual([]);

    // A password built on the company name. The words in it do not go together, so "too easy to
    // guess" told nobody what to fix. The line names the cause.
    await page.getByTestId('signup-name').fill('Harper Lane');
    await page.getByTestId('signup-email').fill('harper@harbor-e2e.example');
    await page.getByTestId('signup-password').fill('Harbor-Lantern-77-quiet!');
    // The company is not typed yet: the password is good so far.
    await expect(page.getByTestId('password-warning')).toHaveCount(0);
    await expect(page.getByTestId('password-error')).toHaveCount(0);
    // The company is filled in after the password: the line appears at once, with no button pressed.
    await page.getByTestId('signup-company').fill('Harbor Supply Co');
    const warning = page.getByTestId('password-warning');
    await expect(warning).toHaveText('Do not use your company name in your password.');
    await expect(page.getByTestId('signup-form')).toContainText('Too weak');
    await expect(page.getByTestId('signup-form')).not.toContainText('too easy to guess');
    // It sits right under the field and its meter.
    const warned = await box(warning);
    const fieldNow = await box(page.getByTestId('signup-password'));
    expect(warned.y - (fieldNow.y + fieldNow.height)).toBeLessThan(40);

    // Pressing the button says the same sentence, in the same place, and focus goes to the field.
    await page.getByTestId('signup-submit').click();
    await expect(page.getByTestId('password-error')).toHaveText('Do not use your company name in your password.');
    await expect(page.getByTestId('signup-password')).toBeFocused();
    expect(new URL(page.url()).pathname).toBe('/signup');
    // The two passwords from the review, as typed.
    for (const [company, password] of [
      ['Harborline Freight', 'Harborline#2026!'],
      ['Harborline Freight', 'Harbor!line2026x'],
    ] as const) {
      await page.getByTestId('signup-company').fill(company);
      await page.getByTestId('signup-password').fill(password);
      await expect(page.locator('[data-testid=password-warning], [data-testid=password-error]')).toHaveText('Do not use your company name in your password.');
    }
    // Change the company: the line goes away, because it is no longer true.
    await page.getByTestId('signup-company').fill('Pine Ridge Outfitters');
    await expect(page.locator('[data-testid=password-warning], [data-testid=password-error]')).toHaveCount(0);

    // The code choice moves focus to what it changed, and the way back is there.
    await page.getByTestId('signup-email-code').click();
    await expect(page.getByTestId('signup-no-password')).toContainText('No password needed');
    await expect(page.getByTestId('signup-use-password')).toBeFocused();
    await expect(page.getByTestId('signup-email-code')).toHaveCount(0);
  });

  test('reset password uses the same order: the field, the red line, then the rules', async ({ page }) => {
    await page.goto('/reset-password');
    const password = page.getByLabel('New password');
    await expect(password).toBeVisible({ timeout: 90_000 });
    await password.fill('KitStak-Rocks-2026!');
    const warning = page.getByTestId('password-warning');
    await expect(warning).toHaveText('Do not use the word KitStak in your password.');
    const field = await box(password);
    const line = await box(warning);
    expect(line.y).toBeGreaterThan(field.y + field.height);
    expect(line.y - (field.y + field.height)).toBeLessThan(40);
    await page.getByRole('button', { name: 'Save new password' }).click();
    // With a missing email and code the password line is still the same sentence in the same place.
    await expect(page.locator('[data-testid=password-warning], [data-testid=password-error]')).toHaveText('Do not use the word KitStak in your password.');
  });
});

test.describe('review round 4: the plan picker on a paid plan', () => {
  test('the confirm panel gives focus back, "no apps" points at cancel, the Pulse note is one rule, and invoices keep one line', async ({ page }) => {
    test.setTimeout(420_000);
    await paidAccount(page, 'focusback', CART_CRM_2);

    await page.goto('/billing/plan');
    await expect(page.getByTestId('plan-picker')).toHaveAttribute('data-mode', 'change');
    await page.getByTestId('plan-seats-inc').click();
    const submit = page.getByTestId('plan-submit');
    const panel = page.getByTestId('change-preview');

    // Opened with the keyboard, closed with Esc.
    await submit.focus();
    await page.keyboard.press('Enter');
    await expect(panel).toBeVisible({ timeout: 60_000 });
    await expect(panel.getByRole('heading')).toBeFocused();
    // Focus stays inside the panel while it is open.
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid=change-preview]'))), 'focus is trapped in the panel').toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(submit, 'after Esc focus is back on "Review change"').toBeFocused();
    // A keyboard user sees where they are: the ring shows.
    expect(await submit.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
    // The next Tab goes on from the button, not from the logo at the top of the page.
    await page.keyboard.press('Shift+Tab');
    expect(await focused(page)).not.toBe('BODY');
    await submit.focus();

    // Opened with the mouse, closed with "Go back".
    await submit.click();
    await expect(panel).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Go back' }).click();
    await expect(panel).toBeHidden();
    await expect(submit, 'after "Go back" focus is back on "Review change"').toBeFocused();

    // Closed with the X.
    await submit.click();
    await expect(panel).toBeVisible({ timeout: 60_000 });
    await panel.getByRole('button', { name: 'Close' }).click();
    await expect(panel).toBeHidden();
    await expect(submit, 'after the X focus is back on "Review change"').toBeFocused();
    // Nothing was charged by opening and closing.
    await expect(page.getByTestId('plan-picker')).toContainText('Now: $58.00 per month');

    /* ----- every app off on a paid plan: the way to stop paying is to cancel ----- */
    await page.getByTestId('plan-product-crm').click();
    const hint = page.getByTestId('plan-submit-hint');
    await expect(hint).toHaveText('To stop paying for everything, cancel your plan.');
    await expect(page.getByText('Pick at least one app.')).toHaveCount(0);
    await page.getByTestId('plan-cancel-instead').click();
    await page.waitForURL(/\/billing\/cancel/);
    await expect(page.getByTestId('cancel-confirm')).toBeVisible({ timeout: 60_000 });

    /* ----- Pulse with more than 5 seats: one plain rule ----- */
    await page.goto('/billing/plan');
    await page.getByTestId('plan-product-pulse').click();
    await setStepper(page, 'plan-seats', 6);
    const note = page.getByTestId('plan-pulse-note');
    await expect(note).toHaveText('Pulse covers every seat in a plan with CRM or Projects. All 6 people can use it for the same flat price.');
    await expect(note).not.toContainText('talk to us');
    await expect(note).not.toContainText('made for teams of up to');

    /* ----- invoices at 768 px: the date, the number and the amount each stay on one line ----- */
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto('/billing/invoices');
    const row = page.locator('[data-testid^=invoice-row-]').first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    for (const cell of ['invoice-date', 'invoice-number', 'invoice-amount'] as const) {
      expect(await linesOf(row.getByTestId(cell)), `${cell} is one line at 768 px`).toBe(1);
    }
    await expect(row.getByTestId('invoice-number')).toHaveText(/^TEST-\d{4}$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll at 768 px').toBe(true);
    // The same at the first width that shows the table.
    await page.setViewportSize({ width: 640, height: 900 });
    for (const cell of ['invoice-date', 'invoice-number', 'invoice-amount'] as const) {
      expect(await linesOf(row.getByTestId(cell)), `${cell} is one line at 640 px`).toBe(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll at 640 px').toBe(true);
  });
});

test.describe('review round 4: the setup guide on a phone', () => {
  test('the fold row counts what the header counts, and the quiet links line up with the step titles', async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext(PHONE);
    const page = await context.newPage();
    await trialAccount(page, 'guidephone', CART_CRM_WMS);
    await page.goto('/?setup=1');
    const progress = page.getByTestId('setup-progress');
    await expect(progress).toBeVisible({ timeout: 90_000 });
    const [, done, total] = /(\d+) of (\d+) done/.exec((await progress.textContent()) ?? '') ?? [];
    expect(Number(total)).toBeGreaterThanOrEqual(3);
    expect(Number(done)).toBeLessThan(Number(total));

    // One fold row at first, in the header's own terms: 5 steps, one open, "the other 4".
    const toggle = page.getByTestId('setup-phone-toggle');
    await expect(toggle).toHaveText(`Show the other ${Number(total) - 1} steps`);
    await expect(page.getByTestId('setup-more-toggle')).toBeHidden();
    await expect(page.getByText(/Show all steps/)).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveText('Show only the next step');
    await expect(page.locator('[data-testid=setup-steps] > li:visible')).toHaveCount(Number(total));
    // The steps for later keep their own row and their own count.
    const more = page.getByTestId('setup-more-toggle');
    if ((await more.count()) > 0) {
      await expect(more).toBeVisible();
      await expect(more).toHaveText(/^Show \d+ more steps? for later$/);
    }

    // Every link and button of a step starts where the step title starts.
    /** Measures every visible step row that has a link. Returns how many rows were checked. */
    const expectLinksLineUp = async (onPage: Page, where: string): Promise<number> => {
      const rows = onPage.locator('[data-testid=setup-steps] > li:visible');
      let checked = 0;
      for (let index = 0; index < (await rows.count()); index += 1) {
        const lefts = await rows.nth(index).evaluate((element) => {
          const textLeft = (node: Element): number => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return Math.min(...[...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => rect.left));
          };
          const title = element.querySelector('p > span');
          const link = element.querySelector('a[href]');
          if (!title || !link) return null;
          // The open step has a filled button: its edge lines up with the title. A quiet link has no
          // edge to see, so its words line up with the title.
          const filled = element.getAttribute('aria-current') === 'step';
          return { title: textLeft(title), link: filled ? link.getBoundingClientRect().left : textLeft(link) };
        });
        if (!lefts) continue;
        expect(Math.abs(lefts.link - lefts.title), `${where}, row ${index + 1}: the link starts ${Math.round(lefts.link - lefts.title)} px from the title`).toBeLessThanOrEqual(2);
        checked += 1;
      }
      return checked;
    };
    expect(await expectLinksLineUp(page, 'touch phone'), 'at least two rows with a link were measured').toBeGreaterThanOrEqual(2);

    // A narrow window with a mouse (no touch): "Skip" is there for hover and keyboard, unseen until
    // then. It must not push the link to the right (this is where the 54 px came from).
    const narrow = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await context.storageState() });
    const narrowPage = await narrow.newPage();
    await narrowPage.goto('/?setup=1');
    await expect(narrowPage.getByTestId('setup-phone-toggle')).toBeVisible({ timeout: 90_000 });
    await narrowPage.getByTestId('setup-phone-toggle').click();
    expect(await expectLinksLineUp(narrowPage, 'narrow window with a mouse')).toBeGreaterThanOrEqual(2);
    // Organization settings shows the same guide, with every row open.
    await narrowPage.goto('/settings/organization');
    await expect(narrowPage.getByTestId('setup-steps')).toBeVisible({ timeout: 90_000 });
    expect(await expectLinksLineUp(narrowPage, 'Organization, narrow window')).toBeGreaterThanOrEqual(2);
    await narrow.close();
    await context.close();
  });
});

test.describe('review round 4: people and roles', () => {
  test('one select style in the members card, and a removed member sees one screen that says so', async ({ browser, page }) => {
    test.setTimeout(420_000);
    const { person: owner } = await trialAccount(page, 'removed', CART_CRM_2);
    const casey = newPerson('casey', 'Casey Morgan');
    await invitePerson(page, casey.email, 'member');
    const link = await inviteLinkFor(page, casey.email);
    const caseyContext = await browser.newContext();
    const caseyPage = await caseyContext.newPage();
    await joinFromInvite(caseyPage, link, casey);

    // The role control of a member row is the design system select, like "Role" in the invite form.
    await page.goto('/settings/organization');
    const memberRole = page.getByTestId('member-role');
    const inviteRole = page.getByTestId('invite-role');
    await expect(memberRole).toBeVisible({ timeout: 90_000 });
    for (const property of ['appearance', 'font-size', 'height', 'border-top-left-radius', 'border-top-color', 'background-color', 'padding-left'] as const) {
      const [inRow, inForm] = await Promise.all([
        memberRole.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property),
        inviteRole.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property),
      ]);
      expect(inRow, `${property} of the role select in a member row`).toBe(inForm);
    }
    expect(await memberRole.evaluate((element) => getComputedStyle(element).appearance)).toBe('none');
    // The words are the same too: "Member", not "member".
    await expect(memberRole.locator('option:checked')).toHaveText('Member');
    // It still changes the role.
    await memberRole.selectOption('viewer');
    await expect(page.getByTestId('member-role').locator('option:checked')).toHaveText('Viewer', { timeout: 30_000 });

    // The owner removes Casey.
    await page.getByTestId('member-remove').click();
    await page.getByTestId('member-remove-confirm').click();
    await expect(page.getByTestId('member-removed')).toContainText('Casey Morgan was removed.', { timeout: 30_000 });

    // Casey opens the launcher, Billing and the signup steps. One screen, the same words everywhere,
    // and nothing greets them as if they were new.
    for (const path of ['/', '/billing', '/signup/company', '/welcome', '/billing/plan']) {
      await caseyPage.goto(path);
      const screen = caseyPage.getByTestId('no-org-former');
      await expect(screen, `${path} shows the one screen`).toBeVisible({ timeout: 90_000 });
      await expect(screen.getByRole('heading')).toHaveText('You are no longer in an organization');
      await expect(screen).toContainText('Your account still works, but you are not on a team right now.');
      await expect(screen).toContainText('Ask a teammate to invite you again. Or start your own organization below.');
      await expect(caseyPage.getByText('Good to meet you')).toHaveCount(0);
      await expect(caseyPage.getByText('Name your workspace')).toHaveCount(0);
      expect(new URL(caseyPage.url()).pathname, `${path} ends on the launcher`).toBe('/');
    }
    // What they can do is on the screen: start an organization of their own.
    await expect(caseyPage.getByLabel('Company or team')).toBeVisible();
    await expect(caseyPage.getByRole('button', { name: 'Create organization' })).toBeVisible();
    expect(owner.email).not.toBe(casey.email);
    await caseyContext.close();
  });

  test('an admin cannot pay: the banner names who can and has no pay button, in the Portal and in Pulse', async ({ browser, page }) => {
    test.setTimeout(600_000);
    await holdDevReloads(page.context());
    // The card pays the first charge and fails every renewal.
    const { person: owner } = await paidAccount(page, 'adminpay', CART_PULSE, 'fails_on_renewal');
    const admin = newPerson('adminview', 'Dana Ortiz');
    await invitePerson(page, admin.email, 'admin');
    const link = await inviteLinkFor(page, admin.email);
    const adminContext = await browser.newContext();
    await holdDevReloads(adminContext);
    const adminPage = await adminContext.newPage();
    await joinFromInvite(adminPage, link, admin);

    // The renewal fails: the 7 days with full access.
    await openBilling(page);
    await skipDays(page, 31);
    await runTestTool(page, 'run-due');
    await page.reload();
    await expectPhase(page, 'past_due');
    // The owner still gets the pay button.
    await expect(page.getByTestId('plan-notice-payment_failed')).toContainText('Update your card by');
    await expect(page.getByTestId('plan-notice-payment_failed').getByTestId('plan-notice-action')).toHaveText(/Update card/);

    await adminPage.goto('/billing');
    const failed = adminPage.getByTestId('plan-notice-payment_failed');
    await expect(failed).toBeVisible({ timeout: 90_000 });
    await expect(failed).toContainText(`Ask ${owner.name} to update the card by`);
    await expect(failed.getByTestId('plan-notice-action')).toHaveCount(0);
    await expect(adminPage.getByText('Only an owner or a billing manager can pay or change a paid plan.')).toBeVisible();

    // Not fixed in 7 days: view only. The admin is told who to ask, with no dead end button.
    await skipDays(page, 8);
    await runTestTool(page, 'run-due');
    await page.reload();
    await expectPhase(page, 'unpaid');
    // The sentence and the button of a person who can pay now use one name for the fix.
    const ownerUnpaid = page.getByTestId('plan-notice-unpaid');
    await expect(ownerUnpaid).toContainText(/Update your card to (turn them back on|keep your apps open)\./);
    await expect(ownerUnpaid).not.toContainText('Pay now');
    await expect(ownerUnpaid.getByTestId('plan-notice-action')).toHaveText(/Update card/);

    await adminPage.goto('/');
    const late = adminPage.getByTestId('plan-notice-unpaid');
    await expect(late).toBeVisible({ timeout: 90_000 });
    await expect(late).toContainText(`Ask ${owner.name} to update the card.`);
    await expect(late).not.toContainText('Pay now');
    await expect(late.getByTestId('plan-notice-action')).toHaveCount(0);

    // The same words in Pulse, and its view only dialog has no pay button either.
    if (await appIsUp(adminPage, `${APP_URLS.pulse}/login`)) {
      await expect(async () => {
        await adminPage.goto(`${APP_URLS.pulse}/`, { timeout: 120_000 });
        await expect(adminPage.getByTestId('plan-notice-unpaid')).toBeVisible({ timeout: 15_000 });
      }).toPass({ timeout: 150_000 });
      const inPulse = adminPage.getByTestId('plan-notice-unpaid');
      await expect(inPulse).toContainText(`Ask ${owner.name} to update the card.`);
      await expect(inPulse.getByTestId('plan-notice-action')).toHaveCount(0);
    } else {
      test.info().annotations.push({ type: 'skipped part', description: 'Pulse is not running: the admin banner was checked in the Portal only.' });
    }
    await adminContext.close();
  });
});
