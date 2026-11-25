import { expect, test } from '@playwright/test';
import { CART_PULSE, codeFromOutbox, handoffLink, newPerson, signUp, sql } from './support';

test.describe('verify your email with a 6 digit code', () => {
  test('a wrong code says so, the right code from the outbox works, and the banner goes away', async ({ page }) => {
    const person = newPerson('verify');
    await signUp(page, person, { link: handoffLink(CART_PULSE) });
    await page.getByTestId('plan-submit').click();
    await page.waitForURL((url) => url.pathname === '/verify-email', { timeout: 90_000 });
    await expect(page.getByText(person.email).first()).toBeVisible();
    await expect(page.getByText('It works for 10 minutes.').first()).toBeVisible();

    // The code field is one field that a phone can fill from the message.
    const field = page.getByTestId('verify-code');
    await expect(field).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(field).toHaveAttribute('inputmode', 'numeric');

    // A wrong code: a plain message, still on the page.
    const code = await codeFromOutbox(page, person.email);
    const wrong = code === '000000' ? '111111' : '000000';
    await field.fill(wrong);
    await expect(page.getByText('That code is not right. Check it and try again.')).toBeVisible({ timeout: 30_000 });
    expect(page.url()).toContain('/verify-email');

    // In test mode the screen points at the outbox.
    await expect(page.getByRole('link', { name: /outbox/i })).toHaveAttribute('href', /\/dev\/outbox/);

    // Pasting the code with spaces works, and the form sends itself.
    await field.fill('');
    await field.focus();
    await page.evaluate((text) => navigator.clipboard?.writeText(text).catch(() => undefined), `${code.slice(0, 3)} ${code.slice(3)}`);
    await field.fill(`${code.slice(0, 3)} ${code.slice(3)}`);
    await page.waitForURL((url) => url.pathname === '/welcome', { timeout: 90_000 });

    const rows = await sql<{ email_verified: boolean }>(`SELECT email_verified FROM core."user" WHERE email = $1`, [person.email]);
    expect(rows[0]?.email_verified).toBe(true);
    await page.goto('/billing');
    await expect(page.getByTestId('billing-home')).toBeVisible();
    await expect(page.getByTestId('verify-email-notice')).toHaveCount(0);

    // The code is wiped from the outbox table once the email has gone out.
    const stored = await sql<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM core.billing_emails WHERE to_email = $1 AND template = 'verify_email' AND status = 'sent'`,
      [person.email],
    );
    expect(stored.length).toBeGreaterThan(0);
    for (const row of stored) expect(row.payload).not.toHaveProperty('code');
  });

  test('skipping never blocks the first session, and paying asks for the code first', async ({ page }) => {
    const person = newPerson('skip');
    await signUp(page, person, { link: handoffLink(CART_PULSE) });
    await page.getByTestId('plan-submit').click();
    await page.waitForURL((url) => url.pathname === '/verify-email', { timeout: 90_000 });
    await page.getByTestId('verify-skip').click();
    await page.waitForURL((url) => url.pathname === '/welcome', { timeout: 90_000 });

    // The shell keeps a quiet reminder with one button.
    await page.goto('/billing');
    await expect(page.getByTestId('verify-email-notice')).toContainText('Enter the 6 digit code we emailed you.');

    // Paying needs a verified address. The pay button is off, says why, and one link fixes it.
    await page.goto('/billing/checkout');
    await expect(page.getByTestId('review-pay')).toBeDisabled();
    await expect(page.getByText('Verify your email first. It takes one minute.').first()).toBeVisible();
    await page.getByRole('link', { name: /Enter code/ }).last().click();
    await page.waitForURL((url) => url.pathname === '/verify-email');
    expect(new URL(page.url()).searchParams.get('next')).toBe('/billing/checkout');
    const code = await codeFromOutbox(page, person.email);
    await page.getByTestId('verify-code').fill(code);
    // Straight back to where the person was going, and now the button works.
    await page.waitForURL((url) => url.pathname === '/billing/checkout', { timeout: 90_000 });
    await expect(page.getByTestId('review-pay')).toBeEnabled();
  });
});
