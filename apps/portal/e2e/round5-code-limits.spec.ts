import { expect, request as playwrightRequest, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { BASE_URL, holdDevReloads, newPerson, resetRateLimits, sql, type Person } from './support';

/**
 * Review round 5: a stranger must never be able to lock the owner of a "no password" account out
 * by asking for email codes, or by guessing codes, in the owner's name. Before the fix 20 anonymous
 * requests used up one budget for the day, no code was mailed any more, and the screen still said
 * "a code is on its way".
 *
 * Now sends for one address are spaced and never walled for a day, the screen names the real wait,
 * and a browser that signed in to the account before has counters of its own
 * (packages/billing/src/server/code-limits.ts, apps/portal/src/server/known-device.ts).
 */

const JSON_HEADERS = { 'content-type': 'application/json', origin: BASE_URL };
const KNOWN_DEVICE_COOKIE = 'kitstak.known_device';
/** The longest wait the send limit may ever name (CODE_SEND_MAX_WAIT_SECONDS). */
const MAX_WAIT_SECONDS = 1800;

async function newestCode(email: string, kind: 'sign_in' | 'reset', after: Date): Promise<string> {
  let code: string | null = null;
  await expect
    .poll(
      async () => {
        const rows = await sql<{ body_text: string | null }>(
          `SELECT body_text FROM core.billing_emails
            WHERE to_email = $1 AND template = $2 AND created_at > $3 AND coalesce(payload->>'purpose', '') = $4
            ORDER BY created_at DESC LIMIT 1`,
          [email.toLowerCase(), kind === 'reset' ? 'reset_password' : 'verify_email', after, kind === 'sign_in' ? 'sign_in' : ''],
        );
        code = /^\s*(\d{6})\s*$/m.exec(rows[0]?.body_text ?? '')?.[1] ?? null;
        return code;
      },
      { timeout: 30_000, message: `a ${kind} code email for ${email}` },
    )
    .not.toBeNull();
  return code as unknown as string;
}

async function codeMailsSince(email: string, after: Date): Promise<number> {
  const rows = await sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM core.billing_emails WHERE to_email = $1 AND created_at > $2 AND template IN ('verify_email', 'reset_password')`,
    [email.toLowerCase(), after],
  );
  return rows[0]?.n ?? 0;
}

async function askForCode(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByTestId('login-email-code').click();
  await expect(page.getByTestId('login-code-form')).toBeVisible();
}

/** A verified account with no password row at all: what "Email me a code instead" leaves behind. */
async function codeOnlyAccount(label: string): Promise<Person> {
  const person = newPerson(label);
  await resetRateLimits();
  const api = await playwrightRequest.newContext();
  const made = await api.post(`${BASE_URL}/api/auth/sign-up/email`, {
    headers: JSON_HEADERS,
    data: { name: person.name, email: person.email, password: person.password },
  });
  expect(made.status()).toBe(200);
  await api.dispose();
  await sql(`UPDATE core."user" SET email_verified = true WHERE email = $1`, [person.email]);
  await sql(`DELETE FROM core.account WHERE user_id = (SELECT id FROM core."user" WHERE email = $1)`, [person.email]);
  await sql(`DELETE FROM core.session WHERE user_id = (SELECT id FROM core."user" WHERE email = $1)`, [person.email]);
  return person;
}

async function freshContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await holdDevReloads(context);
  return context;
}

async function signOut(context: BrowserContext): Promise<void> {
  await context.request.post(`${BASE_URL}/api/auth/sign-out`, { headers: JSON_HEADERS, data: {} });
}

test.describe('round 5: email codes can not be used to lock the owner out', () => {
  test('30 anonymous code requests and 31 wrong codes later, the owner still gets a code and signs in on a browser the account knows', async ({ browser }) => {
    test.setTimeout(420_000);
    const owner = await codeOnlyAccount('r5lock');
    const home = await freshContext(browser);
    const homePage = await home.newPage();

    // The owner signs in once with a code. From then on this browser is known to the account.
    await resetRateLimits();
    let asked = new Date();
    await askForCode(homePage, owner.email);
    await homePage.getByTestId('login-code').fill(await newestCode(owner.email, 'sign_in', asked));
    await homePage.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 });
    const cookie = (await home.cookies(BASE_URL)).find((entry) => entry.name === KNOWN_DEVICE_COOKIE);
    expect(cookie, 'the known device cookie is set at sign in').toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
    // A browser that was already signed in before this cookie existed gets it the next time its session is read.
    await home.clearCookies({ name: KNOWN_DEVICE_COOKIE });
    expect((await home.cookies(BASE_URL)).some((entry) => entry.name === KNOWN_DEVICE_COOKIE)).toBe(false);
    await home.request.get(`${BASE_URL}/api/auth/get-session`);
    expect((await home.cookies(BASE_URL)).some((entry) => entry.name === KNOWN_DEVICE_COOKIE)).toBe(true);
    await signOut(home);
    await resetRateLimits();

    // A stranger with no session asks for reset codes for the owner's address, 30 times, from 30 addresses.
    const attackStarted = new Date();
    const stranger = await playwrightRequest.newContext();
    const answers: number[] = [];
    let longestWait = 0;
    let lastBody: { code?: string; message?: string; retryAfterSeconds?: number } = {};
    for (let i = 0; i < 30; i += 1) {
      const response = await stranger.post(`${BASE_URL}/api/auth/email-otp/request-password-reset`, {
        headers: { ...JSON_HEADERS, 'x-forwarded-for': `10.77.${i}.9` },
        data: { email: owner.email },
      });
      answers.push(response.status());
      if (response.status() === 429) {
        lastBody = (await response.json()) as typeof lastBody;
        longestWait = Math.max(longestWait, lastBody.retryAfterSeconds ?? 0);
      }
    }
    await stranger.dispose();
    // Two go out at once, then the address is slowed down. Nothing ever says "tomorrow".
    expect(answers.filter((status) => status === 200)).toHaveLength(2);
    expect(answers.filter((status) => status === 429)).toHaveLength(28);
    expect(lastBody.code).toBe('CODE_SENT_RECENTLY');
    expect(lastBody.message).toMatch(/^We sent a code to this address a moment ago\. Use that one, or ask for a new one in \d+ (seconds?|minutes?)\.$/);
    expect(lastBody.message).not.toMatch(/tomorrow/i);
    expect(longestWait).toBeGreaterThan(0);
    expect(longestWait).toBeLessThanOrEqual(MAX_WAIT_SECONDS);
    // The owner's mailbox got 2 emails from this, not 20.
    await expect.poll(() => codeMailsSince(owner.email, attackStarted), { timeout: 20_000 }).toBe(2);
    // The old day counters are gone.
    expect(await sql(`SELECT key FROM core.rate_limit WHERE key LIKE 'billing:code-day:%' OR key LIKE 'billing:code:%'`)).toEqual([]);

    // The stranger also asks for sign in codes on the sign in page, and types 31 wrong codes.
    const other = await freshContext(browser);
    const otherPage = await other.newPage();
    await askForCode(otherPage, owner.email);
    await askForCode(otherPage, owner.email);
    await askForCode(otherPage, owner.email);
    // The third one in a row is slowed down, and the screen says so with the real wait.
    await expect(otherPage.getByTestId('login-code-form')).toContainText(/Use that one, or ask for a new one in \d+ (seconds?|minutes?)\./);
    for (let i = 0; i < 31; i += 1) {
      // A real stranger comes from many addresses. Here the count per calling address is cleared instead.
      await sql(`DELETE FROM core.rate_limit WHERE key LIKE 'billing:signup:signin-code:%'`);
      await otherPage.getByTestId('login-code').fill('');
      await otherPage.getByTestId('login-code').fill(String(100_000 + i));
      await expect(otherPage.locator('#login-code-error')).toBeVisible();
      await expect.poll(async () => (await sql<{ count: number }>(`SELECT count FROM core.rate_limit WHERE key = $1`, [`billing:code-signin-day:${owner.email}`]))[0]?.count ?? 0, { timeout: 20_000 }).toBeGreaterThanOrEqual(i + 1);
    }
    // For browsers nobody knows, the tries for this address are used up for today, and the screen says that.
    await expect(otherPage.locator('#login-code-error')).toContainText('Too many codes were tried for this address today.');
    await expect(otherPage.locator('#login-code-error')).toContainText('Use a browser you have signed in with before, or try again tomorrow.');

    // The owner, on the browser the account knows: a sign in code arrives at once and works.
    asked = new Date();
    await askForCode(homePage, owner.email);
    await expect(homePage.locator('#login-code-error')).toHaveCount(0);
    await homePage.getByTestId('login-code').fill(await newestCode(owner.email, 'sign_in', asked));
    await homePage.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 });
    const session = (await (await home.request.get(`${BASE_URL}/api/auth/get-session`)).json()) as { user?: { email?: string } } | null;
    expect(session?.user?.email).toBe(owner.email);
    await signOut(home);

    // "Forgot password" on that browser: a reset code arrives too, though the stranger asked 30 times.
    asked = new Date();
    await homePage.goto('/forgot-password');
    await homePage.getByLabel('Work email').fill(owner.email);
    await homePage.getByRole('button', { name: /send/i }).first().click();
    await homePage.waitForURL((url) => url.pathname.startsWith('/reset-password'), { timeout: 60_000 });
    expect(await newestCode(owner.email, 'reset', asked)).toMatch(/^\d{6}$/);

    await home.close();
    await other.close();
  });

  test('on a browser nobody knows, the owner is told the truth: the last code still works and when a new one can be sent', async ({ browser }) => {
    test.setTimeout(240_000);
    const owner = await codeOnlyAccount('r5wait');
    await resetRateLimits();

    // A stranger asks for sign in codes for the owner's address until the address is slowed down.
    const other = await freshContext(browser);
    const otherPage = await other.newPage();
    const attackStarted = new Date();
    await askForCode(otherPage, owner.email);
    await askForCode(otherPage, owner.email);
    await askForCode(otherPage, owner.email);
    await other.close();
    await expect.poll(() => codeMailsSince(owner.email, attackStarted), { timeout: 20_000 }).toBe(2);

    // The owner, on a new laptop. No new code goes out, and the screen does not pretend one did.
    const laptop = await freshContext(browser);
    const page = await laptop.newPage();
    const asked = new Date();
    await askForCode(page, owner.email);
    await expect(page.locator('#login-code-error')).toContainText(/We sent a code to this address a moment ago\. Use that one, or ask for a new one in (\d+ seconds?|1 minute)\./);
    await page.waitForTimeout(3_000);
    expect(await codeMailsSince(owner.email, asked)).toBe(0);
    // The code that is already in the mailbox signs the owner in.
    await page.getByTestId('login-code').fill(await newestCode(owner.email, 'sign_in', attackStarted));
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 });

    // The same sentence for an address with no account, so nothing is given away.
    await sql(`DELETE FROM core.rate_limit WHERE key LIKE 'billing:signup:signin-code-request:%'`);
    const nobody = newPerson('r5nobody').email;
    const third = await freshContext(browser);
    const thirdPage = await third.newPage();
    await askForCode(thirdPage, nobody);
    await askForCode(thirdPage, nobody);
    await askForCode(thirdPage, nobody);
    await expect(thirdPage.locator('#login-code-error')).toContainText(/We sent a code to this address a moment ago\. Use that one, or ask for a new one in (\d+ seconds?|1 minute)\./);
    expect(await codeMailsSince(nobody, attackStarted)).toBe(0);
    await third.close();
    await laptop.close();
  });
});
