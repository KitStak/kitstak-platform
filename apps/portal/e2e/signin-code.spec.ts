import { expect, test, type Page } from '@playwright/test';
import { BASE_URL, CART_PULSE, emailsTo, newPerson, resetRateLimits, sql, trialAccount } from './support';

/**
 * Review round 3: signup and sign in have a second door that needs no password. "Email me a code
 * instead" mails the 6 digit code, and that one code is both the sign in and the proof of the
 * address. The raw endpoints stay closed: the only way in is through the form's server actions.
 */

/** The newest 6 digit code mailed to this address for the given purpose, read from the outbox table. */
async function newestCode(email: string, purpose: 'sign_in' | null, after: Date): Promise<string> {
  let code: string | null = null;
  await expect
    .poll(
      async () => {
        // The code is taken out of the stored payload once the email is sent. It is in the text.
        const rows = await sql<{ body_text: string | null }>(
          `SELECT body_text FROM core.billing_emails
            WHERE to_email = $1 AND template = 'verify_email' AND created_at > $2
              AND coalesce(payload->>'purpose', '') = $3
            ORDER BY created_at DESC LIMIT 1`,
          [email.toLowerCase(), after, purpose ?? ''],
        );
        code = /^\s*(\d{6})\s*$/m.exec(rows[0]?.body_text ?? '')?.[1] ?? null;
        return code;
      },
      { timeout: 30_000, message: `a code email for ${email}` },
    )
    .not.toBeNull();
  return code as unknown as string;
}

async function askForCode(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByTestId('login-email-code').click();
  await expect(page.getByTestId('login-code-form')).toBeVisible();
}

test.describe('sign in with an emailed code', () => {
  test('"Email me a code instead" on /login: the code signs the person in and proves the address', async ({ page, context }) => {
    // An account that never verified its address, so the code has that job too.
    const { person } = await trialAccount(page, 'codein', CART_PULSE, { verify: false });
    expect(await sql(`SELECT email_verified FROM core."user" WHERE email = $1`, [person.email])).toEqual([{ email_verified: false }]);
    await context.clearCookies();
    await resetRateLimits();

    const asked = new Date();
    await askForCode(page, person.email);
    await expect(page.getByTestId('login-code-form')).toContainText('a code is on its way');
    await expect(page.getByText('Enter the 6 digit code to sign in. No password needed.')).toBeVisible();
    const code = await newestCode(person.email, 'sign_in', asked);

    // The email says what the code is for.
    const mail = (await emailsTo(person.email, 'verify_email')).at(-1);
    expect(mail?.subject).toBe(`Your KitStak code: ${code}`);
    expect(mail?.body_text).toContain('Enter this code to sign in to KitStak.');

    // A wrong code is refused in plain words and the person can try again.
    const wrong = code === '000000' ? '000001' : '000000';
    await page.getByTestId('login-code').fill(wrong);
    await expect(page.getByText('That code is not right. Check it and try again.')).toBeVisible();

    // The right code signs in. No password was typed anywhere.
    await page.getByTestId('login-code').fill(code);
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
    const session = await page.request.get(`${BASE_URL}/api/auth/get-session`);
    expect(((await session.json()) as { user?: { email?: string } } | null)?.user?.email).toBe(person.email);
    // One code was both the sign in and the verification.
    expect(await sql(`SELECT email_verified FROM core."user" WHERE email = $1`, [person.email])).toEqual([{ email_verified: true }]);
    // A code works once.
    await context.clearCookies();
    await askForCode(page, person.email);
    await page.getByTestId('login-code').fill(code);
    await expect(page.getByText(/That code is not right|That code is too old/)).toBeVisible();
  });

  test('it keeps the page the person was going to, and "Use my password instead" goes back', async ({ page, context }) => {
    const { person } = await trialAccount(page, 'codenext', CART_PULSE);
    await context.clearCookies();
    await resetRateLimits();
    await page.goto('/billing?fix=payment');
    await page.waitForURL(/\/login\?next=%2Fbilling%3Ffix%3Dpayment/);
    await page.getByLabel('Work email').fill(person.email);
    const first = new Date();
    await page.getByTestId('login-email-code').click();
    await expect(page.getByTestId('login-code-form')).toBeVisible();
    await newestCode(person.email, 'sign_in', first);
    await page.getByTestId('login-use-password').click();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Work email')).toHaveValue(person.email);
    // Asking again mails a new code. The newest one is the one that works.
    const second = new Date();
    await page.getByTestId('login-email-code').click();
    await expect(page.getByTestId('login-code-form')).toBeVisible();
    await page.getByTestId('login-code').fill(await newestCode(person.email, 'sign_in', second));
    await page.waitForURL(/\/billing\?(.*&)?fix=payment/, { timeout: 60_000 });
    await expect(page.getByTestId('billing-home')).toBeVisible();
  });

  test('nothing says whether an address has an account, and a person with no credential gets no code', async ({ page, context }) => {
    await resetRateLimits();
    const stranger = `e2e-nobody-${Date.now().toString(36)}@kitstak-e2e.example`;
    const asked = new Date();
    await askForCode(page, stranger);
    // The same screen and the same words as for a real account.
    await expect(page.getByTestId('login-code-form')).toContainText('a code is on its way');
    await page.getByTestId('login-code').fill('123456');
    await expect(page.getByText('That code is not right. Check it and try again.')).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await sql(`SELECT 1 FROM core.billing_emails WHERE to_email = $1 AND created_at > $2`, [stranger, asked])).toHaveLength(0);
    expect(await sql(`SELECT 1 FROM core."user" WHERE email = $1`, [stranger])).toHaveLength(0);

    // A deactivated person: the credential row is gone (how every app switches a person off).
    const { person } = await trialAccount(page, 'codeoff', CART_PULSE);
    await context.clearCookies();
    await sql(`DELETE FROM core.account WHERE provider_id = 'credential' AND user_id = (SELECT id FROM core."user" WHERE email = $1)`, [person.email]);
    await resetRateLimits();
    const off = new Date();
    await askForCode(page, person.email);
    await page.waitForTimeout(1500);
    expect(await sql(`SELECT 1 FROM core.billing_emails WHERE to_email = $1 AND created_at > $2 AND payload->>'purpose' = 'sign_in'`, [person.email, off])).toHaveLength(0);
  });

  test('the raw endpoints stay closed: a code sign in only works through the form', async ({ page }) => {
    const headers = { 'content-type': 'application/json', origin: BASE_URL };
    const direct = await page.request.post(`${BASE_URL}/api/auth/sign-in/email-otp`, { headers, data: { email: 'maya@northwind-robotics.example', otp: '123456' } });
    expect(direct.status()).toBe(404);
    const send = await page.request.post(`${BASE_URL}/api/auth/email-otp/send-verification-otp`, { headers, data: { email: 'maya@northwind-robotics.example', type: 'sign-in' } });
    expect(send.status()).toBe(400);
    expect(((await send.json()) as { message?: string }).message).toBe('Sign in with your password.');
  });
});

test.describe('signup with no password', () => {
  test('"Email me a code instead" on /signup makes the account, and the person signs in again with a code', async ({ page, context }) => {
    await resetRateLimits();
    const person = newPerson('nopass', 'Dana Whitlock');
    await page.goto('/signup');
    await expect(page.getByTestId('signup-form')).toBeVisible({ timeout: 90_000 });
    await expect.poll(() => new URL(page.url()).hash, { timeout: 30_000 }).toBe('');
    await page.getByTestId('signup-name').fill(person.name);
    await page.getByTestId('signup-email').fill(person.email);
    await page.getByTestId('signup-company').fill(person.company);

    // The link sits under the password field. Choosing it takes the password field away.
    await page.getByTestId('signup-email-code').click();
    await expect(page.getByTestId('signup-no-password')).toContainText('No password needed');
    await expect(page.getByTestId('signup-password')).toHaveCount(0);
    // And back again, so nobody is stuck with a choice.
    await page.getByTestId('signup-use-password').click();
    await expect(page.getByTestId('signup-password')).toBeVisible();
    await page.getByTestId('signup-email-code').click();

    await page.getByTestId('signup-submit').click();
    await page.waitForURL((url) => url.pathname === '/signup/plan', { timeout: 90_000 });
    expect(await sql(`SELECT 1 FROM core."user" WHERE email = $1`, [person.email])).toHaveLength(1);

    // Later, on any device: sign in with a code. No password exists that anyone knows.
    await context.clearCookies();
    await resetRateLimits();
    const asked = new Date();
    await askForCode(page, person.email);
    await page.getByTestId('login-code').fill(await newestCode(person.email, 'sign_in', asked));
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
    expect(await sql(`SELECT email_verified FROM core."user" WHERE email = $1`, [person.email])).toEqual([{ email_verified: true }]);
  });
});
