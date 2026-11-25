/**
 * Shared helpers for the portal's signup and billing browser tests (docs/billing/TESTING.md).
 *
 * Every spec makes its own person and organization through the real screens, reads email from the
 * dev outbox, pays with the test gateway's cards and moves time with the test tools on billing
 * home. Nothing here writes plan state to the database: the database is only read, to prove what
 * the screens say, and the rate limit counters are cleared so many signups can run in a row.
 */
import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import pg from 'pg';
import { formatMoney, type PlanSelection } from '@kitstak/billing/catalog';
import { signupUrl, type HandoffIdentity, type SignupHandoff } from '@kitstak/billing/handoff';
import { quote } from '@kitstak/billing/quote';

export const BASE_URL = (process.env.E2E_BASE_URL ?? 'http://localhost:3300').replace(/\/+$/, '');
export const DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5544/kitstak';

/** The other apps, for the integration spec. Each is skipped when it does not answer. */
export const APP_URLS = {
  crm: (process.env.E2E_CRM_URL ?? 'http://localhost:3100').replace(/\/+$/, ''),
  wms: (process.env.E2E_WMS_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
  projects: (process.env.E2E_PROJECTS_URL ?? 'http://localhost:3400').replace(/\/+$/, ''),
  pulse: (process.env.E2E_PULSE_URL ?? 'http://localhost:3500').replace(/\/+$/, ''),
} as const;

/* ===== database (read only, plus the rate limit counters) ===== */

let pool: pg.Pool | null = null;

/**
 * The suite clears rate limit counters and makes test organizations. That is only ever right for a
 * database on this machine, so any other host is refused, with no switch to turn the check off.
 */
function assertLocalDatabase(): void {
  let host = '';
  try {
    host = new URL(DATABASE_URL).hostname;
  } catch {
    host = '';
  }
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw new Error(`The browser tests only run against a local database. E2E_DATABASE_URL points at "${host || 'an unreadable address'}".`);
  }
}

function db(): pg.Pool {
  if (!pool) {
    assertLocalDatabase();
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2, allowExitOnIdle: true });
  }
  return pool;
}

export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: readonly unknown[] = []): Promise<T[]> {
  const result = await db().query<T>(text, params as unknown[]);
  return result.rows;
}

/** Signup allows 5 tries per 10 minutes per address. The suite makes more accounts than that. */
export async function resetRateLimits(): Promise<void> {
  await sql(`DELETE FROM core.rate_limit`);
}

export async function orgIdOf(email: string): Promise<string> {
  const rows = await sql<{ id: string }>(
    `SELECT m.organization_id AS id FROM core.member m JOIN core."user" u ON u.id = m.user_id WHERE u.email = $1 ORDER BY m.created_at LIMIT 1`,
    [email.toLowerCase()],
  );
  if (!rows[0]) throw new Error(`No organization for ${email}.`);
  return rows[0].id;
}

export interface EntitlementRow {
  module: string;
  status: string;
  source: string;
  current_period_end: Date | null;
}

export async function entitlementsOf(orgId: string): Promise<EntitlementRow[]> {
  return sql<EntitlementRow>(
    `SELECT module, status, source, current_period_end FROM core.entitlements WHERE org_id = $1 ORDER BY module`,
    [orgId],
  );
}

export async function emailsTo(email: string, template?: string): Promise<{ template: string; subject: string | null; status: string; body_text: string | null }[]> {
  return sql(
    `SELECT template, subject, status, body_text FROM core.billing_emails
      WHERE to_email = $1 AND ($2::text IS NULL OR template = $2) ORDER BY created_at`,
    [email.toLowerCase(), template ?? null],
  );
}

/* ===== people and carts ===== */

export interface Person {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly company: string;
}

let personCounter = 0;

/** A new person with an address nobody else uses. The password passes the shared policy. */
export function newPerson(label: string, name = 'Maya Chen'): Person {
  personCounter += 1;
  const tag = `${Date.now().toString(36)}${personCounter}${Math.random().toString(36).slice(2, 6)}`;
  return {
    name,
    email: `e2e-${label}-${tag}@kitstak-e2e.example`,
    password: `Harbor-Lantern-${tag}-42!`,
    company: `E2E ${label} ${tag.slice(-5)}`,
  };
}

export const CART_CRM_WMS: PlanSelection = { products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'monthly' };
export const CART_PULSE: PlanSelection = { products: ['pulse'], seats: 1, warehouses: 1, interval: 'monthly' };
export const CART_CRM_2: PlanSelection = { products: ['crm'], seats: 2, warehouses: 1, interval: 'monthly' };

/** '$395.20': what every screen must show for a cart, worked out from the one catalog. */
export function totalOf(selection: PlanSelection): string {
  return formatMoney(quote(selection).totalCents);
}

/** The link the marketing site hands to the portal: the cart in the query, the identity after the #. */
export function handoffLink(selection: PlanSelection, identity?: HandoffIdentity, profile: SignupHandoff['profile'] = {}): string {
  const answered = Object.keys(profile).length > 0;
  const handoff: SignupHandoff = { selection, profile, source: answered ? 'wizard' : 'pricing' };
  return signupUrl(BASE_URL, handoff, identity);
}

/* ===== screens ===== */

/** Next dev compiles a route on first use. Give the first paint of every screen room for that. */
const SLOW = 90_000;

/**
 * Fills the four signup fields. When the link carried the name, email and company after the "#", the
 * form fills those itself a moment after it loads: wait for that instead of typing over it, or the
 * two writes can land in the same field.
 */
export async function fillSignup(page: Page, person: Person, options?: { prefilled?: boolean }): Promise<void> {
  const fields = [
    ['signup-name', person.name],
    ['signup-email', person.email],
    ['signup-company', person.company],
  ] as const;
  for (const [testId, value] of fields) {
    const field = page.getByTestId(testId);
    if (options?.prefilled) await expect(field).toHaveValue(value, { timeout: 30_000 });
    else await field.fill(value);
  }
  await page.getByTestId('signup-password').fill(person.password);
  for (const [testId, value] of fields) await expect(page.getByTestId(testId)).toHaveValue(value);
}

/** `/signup` to `/signup/plan` through the real form. */
export async function signUp(page: Page, person: Person, options?: { link?: string; prefilled?: boolean }): Promise<void> {
  // Signup allows 5 tries per 10 minutes from one address. The suite makes more accounts than that.
  await resetRateLimits();
  await page.goto(options?.link ?? '/signup');
  await expect(page.getByTestId('signup-form')).toBeVisible({ timeout: SLOW });
  // The form is ready for input once it has read the link (the "#" part is gone by then).
  await expect.poll(() => new URL(page.url()).hash, { timeout: 30_000 }).toBe('');
  await fillSignup(page, person, { prefilled: options?.prefilled });
  await page.getByTestId('signup-submit').click();
  await page.waitForURL((url) => url.pathname === '/signup/plan', { timeout: SLOW });
  await expect(page.getByTestId('plan-picker')).toBeVisible({ timeout: SLOW });
}

/** Sets the picker to a cart: the app switches, the two steppers and the period. */
export async function pickPlan(page: Page, selection: PlanSelection): Promise<void> {
  for (const id of ['crm', 'wms', 'projects', 'pulse'] as const) {
    const toggle = page.getByTestId(`plan-product-${id}`);
    const on = (await toggle.getAttribute('aria-checked')) === 'true';
    if (on !== selection.products.includes(id)) await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', String(selection.products.includes(id)));
  }
  if (selection.products.some((id) => id === 'crm' || id === 'projects')) await setStepper(page, 'plan-seats', selection.seats);
  if (selection.products.includes('wms')) await setStepper(page, 'plan-warehouses', selection.warehouses);
  await page.getByTestId(`plan-interval-${selection.interval}`).click();
}

export async function setStepper(page: Page, testId: string, value: number): Promise<void> {
  const field = page.getByTestId(testId);
  await expect(field).toBeVisible();
  await field.fill(String(value));
  await field.blur();
  await expect(field).toHaveValue(String(value));
}

/** The 6 digit code from the newest code email to this address, read from the dev outbox page. */
export async function codeFromOutbox(page: Page, email: string, template: 'verify_email' | 'reset_password' = 'verify_email'): Promise<string> {
  let code: string | null = null;
  await expect
    .poll(
      async () => {
        const list = await page.request.get(`/dev/outbox?to=${encodeURIComponent(email)}`);
        if (!list.ok()) return null;
        // Rows are newest first. Take the newest one of this kind and open it.
        const row = new RegExp(`data-template="${template}"[\\s\\S]*?outbox-open-([0-9a-f-]{36})`).exec(await list.text());
        if (!row) return null;
        const opened = await page.request.get(`/dev/outbox?to=${encodeURIComponent(email)}&open=${row[1]}`);
        if (!opened.ok()) return null;
        code = /data-testid="outbox-code"[^>]*>(\d{6})</.exec(await opened.text())?.[1] ?? null;
        return code;
      },
      { timeout: 30_000, message: `a ${template} email for ${email} in /dev/outbox` },
    )
    .not.toBeNull();
  return code as unknown as string;
}

/** Enters the emailed code on `/verify-email`. Ends where `next` points. */
export async function verifyEmail(page: Page, email: string, next = '/billing'): Promise<void> {
  if (new URL(page.url()).pathname !== '/verify-email') await page.goto(`/verify-email?next=${encodeURIComponent(next)}`);
  await expect(page.getByTestId('verify-code')).toBeVisible({ timeout: SLOW });
  const code = await codeFromOutbox(page, email);
  await page.getByTestId('verify-code').fill(code);
  // The form sends itself when 6 digits are in.
  await page.waitForURL((url) => !url.pathname.startsWith('/verify-email'), { timeout: SLOW });
}

export interface Account {
  readonly person: Person;
  readonly orgId: string;
}

/**
 * A new owner with a new organization in a free trial of `selection`, email verified, standing on
 * billing home. The short road every billing spec starts from.
 */
export async function trialAccount(page: Page, label: string, selection: PlanSelection, options?: { verify?: boolean }): Promise<Account> {
  const person = newPerson(label);
  await signUp(page, person, {
    link: handoffLink(selection, { name: person.name, email: person.email, company: person.company }),
    prefilled: true,
  });
  await page.getByTestId('plan-submit').click();
  await page.waitForURL((url) => url.pathname === '/verify-email' || url.pathname === '/welcome', { timeout: SLOW });
  if (options?.verify === false) {
    if (new URL(page.url()).pathname === '/verify-email') await page.getByTestId('verify-skip').click();
    await page.waitForURL((url) => url.pathname === '/welcome', { timeout: SLOW });
  } else if (new URL(page.url()).pathname === '/verify-email') {
    await verifyEmail(page, person.email, '/welcome');
  }
  const orgId = await orgIdOf(person.email);
  await openBilling(page);
  return { person, orgId };
}

/**
 * A new owner on a paid plan in good standing: the free trial is skipped to its end with the test
 * tools, then the plan is paid with a working card (or the card given), charged that day.
 */
export async function paidAccount(page: Page, label: string, selection: PlanSelection, card: CardOutcome = 'success'): Promise<Account> {
  const account = await trialAccount(page, label, selection);
  await runTestTool(page, 'shift-trial-end');
  await page.reload();
  await expectPhase(page, 'trial_ended');
  await payAndSucceed(page, card);
  await openBilling(page);
  await expectPhase(page, 'active');
  return account;
}

export interface InvoiceDbRow {
  id: string;
  number: string | null;
  status: string;
  billing_reason: string | null;
  total_cents: number;
  amount_paid_cents: number;
  amount_due_cents: number;
  lines: { description: string; amountCents: number; proration: boolean }[];
}

/** The organization's invoices, oldest first, as the gateway reported them. */
export async function invoicesOf(orgId: string): Promise<InvoiceDbRow[]> {
  return sql<InvoiceDbRow>(
    `SELECT id, number, status, billing_reason, total_cents, amount_paid_cents, amount_due_cents, lines
       FROM core.billing_invoices WHERE org_id = $1 ORDER BY issued_at, created_at`,
    [orgId],
  );
}

export async function auditOf(orgId: string): Promise<{ action: string; summary: string; actor_label: string }[]> {
  return sql(`SELECT action, summary, actor_label FROM core.billing_audit_log WHERE org_id = $1 ORDER BY created_at, id`, [orgId]);
}

/** '$14.50' to 1450. */
export function cents(money: string): number {
  const match = /(-?)\$([\d,]+)\.(\d{2})/.exec(money);
  if (!match) throw new Error(`Not a money text: ${money}`);
  const value = Number(match[2]!.replace(/,/g, '')) * 100 + Number(match[3]);
  return match[1] === '-' ? -value : value;
}

export async function openBilling(page: Page, query = ''): Promise<void> {
  await page.goto(`/billing${query}`);
  await expect(page.getByTestId('billing-home')).toBeVisible({ timeout: SLOW });
}

export async function expectPhase(page: Page, phase: string): Promise<void> {
  await expect(page.getByTestId('billing-phase')).toHaveAttribute('data-phase', phase, { timeout: 30_000 });
}

export const TEST_CARD = {
  success: '4242 4242 4242 4242',
  declined: '4000 0000 0000 0002',
  insufficient_funds: '4000 0000 0000 9995',
  requires_action: '4000 0027 6000 3184',
  fails_on_renewal: '4000 0000 0000 0341',
} as const;
export type CardOutcome = keyof typeof TEST_CARD;

/** From billing home or the picker to the test pay page, through the review step. */
export async function openTestCheckout(page: Page): Promise<void> {
  if (!page.url().includes('/billing/checkout')) await page.goto('/billing/checkout');
  await expect(page.getByTestId('review-pay')).toBeVisible({ timeout: SLOW });
  await page.getByTestId('review-pay').click();
  await page.waitForURL(/\/test-gateway\/checkout\//, { timeout: SLOW });
  await expect(page.getByTestId('test-checkout')).toBeVisible({ timeout: SLOW });
}

/** Picks one of the one tap test cards and presses pay. Does not wait for an outcome. */
export async function payWith(page: Page, outcome: CardOutcome): Promise<void> {
  await page.getByTestId(`test-card-chip-${outcome}`).click();
  await expect(page.getByTestId('test-card-number')).toHaveValue(TEST_CARD[outcome]);
  await page.getByTestId('test-pay').click();
}

/** Review, pay with a working card, land on the success page. */
export async function payAndSucceed(page: Page, outcome: CardOutcome = 'success'): Promise<void> {
  await openTestCheckout(page);
  await payWith(page, outcome);
  await page.waitForURL(/\/billing\/checkout\/success/, { timeout: SLOW });
  await expect(page.getByTestId('checkout-success')).toBeVisible({ timeout: 30_000 });
}

/** One of the test tools on billing home. Waits for its result line. */
export async function runTestTool(page: Page, tool: 'shift-1' | 'shift-7' | 'shift-14' | 'shift-30' | 'shift-trial-end' | 'run-due' | 'fail-next'): Promise<string> {
  if (!/\/billing(\?.*)?$/.test(page.url())) await openBilling(page);
  const button = page.getByTestId(`test-tool-${tool}`);
  await expect(button).toBeVisible({ timeout: SLOW });
  await button.click();
  const result = page.getByTestId('test-tools-result');
  await expect(result).toBeVisible({ timeout: 60_000 });
  // Done means the button is ready again, or gone: the "end of the trial" tool leaves the page with
  // the trial, and the page reloads right after the result shows.
  await expect(async () => {
    if ((await button.count()) > 0) await expect(button).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 60_000 });
  return (await result.textContent()) ?? '';
}

/** Moves the organization's clock forward by any number of days, with the 1, 7, 14 and 30 day tools. */
export async function skipDays(page: Page, days: number): Promise<void> {
  let left = days;
  for (const step of [30, 14, 7, 1] as const) {
    while (left >= step) {
      await runTestTool(page, `shift-${step}`);
      left -= step;
    }
  }
}

/**
 * Sends an invite from the portal's organization page. Returns the accept link from the invite
 * email, read from the outbox once the one minute job has delivered it.
 */
export async function invitePerson(page: Page, email: string, role: 'admin' | 'member' | 'viewer' = 'member'): Promise<void> {
  await page.goto('/settings/organization');
  const field = page.getByLabel('Email', { exact: true });
  await expect(field).toBeVisible({ timeout: SLOW });
  await field.fill(email);
  await page.getByLabel('Role', { exact: true }).selectOption(role);
  await page.getByRole('button', { name: 'Send invite' }).click();
}

export async function inviteLinkFor(page: Page, email: string): Promise<string> {
  let link: string | null = null;
  await expect
    .poll(
      async () => {
        await page.request.post('/api/billing/jobs/tick');
        const mail = await emailsTo(email, 'invitation');
        const body = mail[mail.length - 1]?.body_text ?? '';
        link = /https?:\/\/\S+\/invite\/\S+/.exec(body)?.[0] ?? null;
        return link;
      },
      { timeout: 30_000, message: `an invite email for ${email} in the outbox` },
    )
    .not.toBeNull();
  return link as unknown as string;
}

/** A new person opens an invite link and joins with a name and a password. Ends on the launcher. */
export async function joinFromInvite(page: Page, link: string, person: Person): Promise<void> {
  await resetRateLimits();
  await page.goto(link);
  await expect(page.getByTestId('invite-org-name')).toBeVisible({ timeout: SLOW });
  await page.getByTestId('invite-name').fill(person.name);
  await page.getByTestId('invite-password').fill(person.password);
  await page.getByTestId('invite-accept').click();
  await page.waitForURL((url) => !url.pathname.startsWith('/invite'), { timeout: SLOW });
}

export async function userIdOf(email: string): Promise<string> {
  const rows = await sql<{ id: string }>(`SELECT id FROM core."user" WHERE email = $1`, [email.toLowerCase()]);
  if (!rows[0]) throw new Error(`No user ${email}.`);
  return rows[0].id;
}

/** Verifies the signed in person's email with the code from the outbox, unless it already is. */
export async function ensureVerified(page: Page, email: string): Promise<void> {
  const rows = await sql<{ email_verified: boolean }>(`SELECT email_verified FROM core."user" WHERE email = $1`, [email.toLowerCase()]);
  if (rows[0]?.email_verified) return;
  await page.goto('/verify-email?next=/billing');
  await expect(page.getByTestId('verify-code')).toBeVisible({ timeout: SLOW });
  if ((await emailsTo(email, 'verify_email')).length === 0) await page.getByTestId('verify-resend').click();
  await verifyEmail(page, email, '/billing');
}

/** True when the page scrolls sideways, which no screen may do at 360 px. */
export async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

/** Money text of a test id, trimmed. */
export async function textOf(locator: Locator): Promise<string> {
  return ((await locator.first().textContent()) ?? '').replace(/\s+/g, ' ').trim();
}

let appsOpenInPortal: boolean | null = null;

/**
 * True when the Portal runs with the allow all switch on, so every app is open whatever the plan
 * says. The Portal then never says "view only" (review round 4), and the specs expect the words for
 * open apps instead. Read once per run, from billing home. Needs a signed in owner.
 */
export async function portalAppsOpen(page: Page): Promise<boolean> {
  if (appsOpenInPortal === null) appsOpenInPortal = await allowAllIsOn(page);
  return appsOpenInPortal;
}

/** Whether the portal runs with the allow all switch on. The launcher tile check is skipped when it is. */
export async function allowAllIsOn(page: Page): Promise<boolean> {
  if (process.env.E2E_ALLOW_ALL === '0') return false;
  if (process.env.E2E_ALLOW_ALL === '1') return true;
  // Billing home wears a "Dev override" badge while the switch is on. Needs a signed in owner.
  const response = await page.request.get('/billing');
  const html = response.ok() ? await response.text() : '';
  return /Dev override/.test(html);
}

/**
 * A dev server that has just compiled a route can tell an open page to reload many times a second,
 * so no click lands. This drops those reload orders on the dev socket and passes everything else.
 * (The same guard the Pulse browser suite uses.) Only needed for pages on other apps' dev servers.
 */
export async function holdDevReloads(context: BrowserContext): Promise<void> {
  const marked = context as BrowserContext & { __holdDevReloads?: boolean };
  if (marked.__holdDevReloads) return;
  marked.__holdDevReloads = true;
  await context.routeWebSocket(/\/_next\/(webpack-)?hmr/, (socket) => {
    const server = socket.connectToServer();
    const seen = new Set<string>();
    server.onMessage((message) => {
      const kind = /"type":"([^"]+)"/.exec(String(message))?.[1];
      if (kind === 'reloadPage' || kind === 'turbopack-message' || kind === 'serverComponentChanges') return;
      if (kind === 'built' || kind === 'building' || kind === 'sync') {
        if (seen.has(kind)) return;
        seen.add(kind);
      }
      socket.send(message);
    });
    socket.onMessage((message) => server.send(message));
  });
}

export async function appIsUp(page: Page, url: string): Promise<boolean> {
  try {
    const response = await page.request.get(url, { timeout: 15_000, maxRedirects: 0 });
    return response.status() < 500;
  } catch {
    return false;
  }
}
