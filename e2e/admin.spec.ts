/**
 * Admin center, profile settings and trash: main flows as the demo owner, plus RBAC checks as a
 * viewer (server 403s, page shows the admins-only notice). Every mutation is reverted.
 */
import { request as playwrightRequest, type Page } from '@playwright/test';
import { loadCredentials } from './support/credentials';
import { baseUrl } from './support/paths';
import { authedTest as test, expect, publicTest, waitForSettled } from './support/fixtures';

// Dev-mode first compiles of each admin route are slow on the shared server.
test.describe.configure({ timeout: Number(process.env.E2E_ADMIN_TIMEOUT_MS ?? 180_000) });

async function orgBase(page: Page): Promise<string> {
  // Resolve the org from the API instead of loading the home page (keeps the shared server cooler).
  const response = await page.request.get('/api/v1/me');
  expect(response.ok()).toBe(true);
  const me = (await response.json()) as { data: { organizations: { slug: string }[] } };
  const slug = me.data.organizations[0]?.slug;
  expect(slug).toBeTruthy();
  return `/${slug}`;
}

test.describe('admin center', () => {
  test('navigates every section from the sub-nav without console errors', async ({ page, diagnostics }) => {
    const base = await orgBase(page);
    await page.goto(`${base}/admin`);
    await expect(page.getByTestId('admin-center')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(/administration/i);
    await expect(page.getByTestId('admin-org-name')).toHaveValue(/.+/);
    const sections: [string, RegExp][] = [
      ['users', /^Users$/],
      ['teams', /^Teams$/],
      ['permissions', /^Permissions$/],
      ['security', /^Security$/],
      ['audit', /^Audit log$/],
      ['api', /^API$/],
      ['usage', /^Usage & billing$/],
    ];
    for (const [key, heading] of sections) {
      await page.getByTestId(`admin-nav-${key}`).filter({ visible: true }).click();
      await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible({ timeout: Number(process.env.E2E_ADMIN_STEP_MS ?? 45_000) });
      await expect(page.getByTestId(`admin-nav-${key}`).filter({ visible: true })).toHaveAttribute('aria-current', 'page');
    }
    await waitForSettled(page);
    expect(diagnostics.errors).toEqual([]);
  });

  test('users: search, filter, bulk selection and invite dialog', async ({ page, diagnostics }) => {
    const base = await orgBase(page);
    await page.goto(`${base}/admin/users`);
    const rows = page.getByTestId('users-row');
    await expect(rows.first()).toBeVisible();
    const total = await rows.count();
    expect(total).toBeGreaterThan(3);
    await page.getByTestId('users-search').fill('aisha');
    await expect(rows).toHaveCount(1);
    await page.getByTestId('users-search').fill('');
    await expect(rows).toHaveCount(total);

    await page.getByRole('checkbox', { name: /select aisha/i }).click();
    await expect(page.getByTestId('users-bulk-bar')).toContainText('1 selected');
    await page.getByRole('button', { name: 'Clear selection' }).click();
    await expect(page.getByTestId('users-bulk-bar')).toHaveCount(0);

    await page.getByTestId('users-invite').click();
    const dialog = page.getByTestId('invite-dialog');
    await expect(dialog).toBeVisible();
    await page.getByTestId('invite-emails').fill('one@northwind-robotics.example, bad-address');
    // Invalid entries are flagged live and block sending.
    await expect(page.getByTestId('invite-chip-invalid')).toContainText('bad-address');
    await expect(page.getByTestId('invite-submit')).toHaveText('Fix 1 address');
    await expect(page.getByTestId('invite-submit')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(diagnostics.errors).toEqual([]);
  });

  test('permissions: creation rule persists across reloads', async ({ page }) => {
    const base = await orgBase(page);
    const me = (await (await page.request.get('/api/v1/me')).json()) as { data: { organizations: { id: string }[] } };
    const headers = { 'x-org-id': me.data.organizations[0]?.id ?? '', origin: baseUrl() };
    const group = () => page.getByRole('radiogroup', { name: 'Who can create boards' });
    try {
      await page.goto(`${base}/admin/permissions`);
      const saved = page.waitForResponse((r) => r.url().includes('/api/v1/admin/policy') && r.request().method() === 'PATCH');
      await group().getByRole('radio', { name: /admins only/i }).click();
      const response = await saved;
      test.skip(response.status() === 429, 'shared demo user is rate limited right now');
      expect(response.status()).toBe(200);
      await expect(page.getByText('Creation rules updated').first()).toBeVisible();
      await page.reload();
      await expect(group().getByRole('radio', { name: /admins only/i })).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByTestId('permissions-matrix')).toContainText('Change organization settings');
    } finally {
      // Always restore the shared demo org (retry through rate limits).
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const response = await page.request.patch('/api/v1/admin/policy', { headers, data: { boardCreation: 'members' } });
        if (response.ok()) break;
        await page.waitForTimeout(2_000);
      }
    }
  });

  test('API tokens: shown once, then revoked; both events are audited', async ({ page }) => {
    const base = await orgBase(page);
    await page.goto(`${base}/admin/api`);
    const name = `E2E token ${Date.now()}`;
    await page.getByTestId('token-create-open').click();
    await page.getByTestId('token-name').fill(name);
    await page.getByTestId('token-create').click();
    await expect(page.getByTestId('token-value')).toHaveText(/^ks_live_/);
    await page.getByTestId('token-done').click();
    const row = page.getByTestId('token-row').filter({ hasText: name });
    await expect(row).toContainText('Active');
    await row.getByRole('button', { name: `Revoke ${name}` }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke token' }).click();
    // Revoked tokens are hidden by default, shown dimmed behind the toggle.
    await expect(row).toHaveCount(0);
    await page.getByTestId('tokens-show-inactive').click();
    await expect(row).toContainText('Revoked');
    await expect(row).toHaveAttribute('data-status', 'revoked');

    await page.goto(`${base}/admin/audit-log`);
    await page.getByTestId('audit-search').fill('api_token');
    await expect(page.getByTestId('audit-row').filter({ hasText: 'api_token.revoked' }).first()).toBeVisible();
    await expect(page.getByTestId('audit-row').filter({ hasText: 'api_token.created' }).first()).toBeVisible();
  });

  test('API tokens authenticate REST calls and stop working once revoked', async ({ page }) => {
    const me = (await (await page.request.get('/api/v1/me')).json()) as { data: { organizations: { id: string }[] } };
    const headers = { 'x-org-id': me.data.organizations[0]?.id ?? '', origin: baseUrl() };
    const created = await page.request.post('/api/v1/admin/api-tokens', {
      headers,
      data: { name: `E2E bearer ${Date.now()}`, scopes: ['boards:read'], expiresInDays: 30 },
    });
    test.skip(created.status() === 429, 'shared demo user is rate limited right now');
    expect(created.ok()).toBe(true);
    const token = ((await created.json()) as { data: { id: string; token: string } }).data;
    const bearer = await playwrightRequest.newContext({ baseURL: baseUrl() });
    try {
      const auth = { authorization: `Bearer ${token.token}` };
      expect((await bearer.get('/api/v1/boards', { headers: auth })).status()).toBe(200);
      // A scope the token lacks → 403; admin endpoints are out of scope too.
      expect((await bearer.get('/api/v1/admin/users', { headers: auth })).status()).toBe(403);
      const list = (await (await page.request.get('/api/v1/admin/api-tokens', { headers })).json()) as {
        data: { id: string; lastUsedAt: string | null }[];
      };
      expect(list.data.find((entry) => entry.id === token.id)?.lastUsedAt).not.toBeNull();
      expect((await page.request.delete(`/api/v1/admin/api-tokens/${token.id}`, { headers })).ok()).toBe(true);
      expect((await bearer.get('/api/v1/boards', { headers: auth })).status()).toBe(401);
    } finally {
      await page.request.delete(`/api/v1/admin/api-tokens/${token.id}`, { headers });
      await bearer.dispose();
    }
  });

  test('audit log shows readable targets and rejects impossible dates', async ({ page }) => {
    const base = await orgBase(page);
    const me = (await (await page.request.get('/api/v1/me')).json()) as { data: { organizations: { id: string }[] } };
    const headers = { 'x-org-id': me.data.organizations[0]?.id ?? '' };
    expect((await page.request.get('/api/v1/admin/audit?from=2026-13-45', { headers })).status()).toBe(422);
    await page.goto(`${base}/admin/audit-log`);
    const first = page.getByTestId('audit-row').first();
    await expect(first).toBeVisible();
    // Never a truncated 8-character id in the Target column.
    const targets = await page.getByTestId('audit-target').allInnerTexts();
    expect(targets.some((text) => /\b[0-9a-f]{8}\b/.test(text))).toBe(false);
    await first.getByRole('button', { name: 'Show details' }).click();
    await expect(page.getByTestId('audit-details')).toBeVisible();
    await expect(page.getByTestId('audit-raw')).toContainText('Raw payload');
    await page.getByTestId('audit-sort-time').click();
    await expect(page.getByTestId('audit-sort-time').locator('xpath=..')).toHaveAttribute('aria-sort', 'ascending');
  });

  test('users: pending invitations are listed by default and columns sort', async ({ page }) => {
    const base = await orgBase(page);
    await page.goto(`${base}/admin/users`);
    await expect(page.getByTestId('users-row').first()).toBeVisible();
    const invited = page.getByTestId('pending-invites');
    if ((await invited.count()) > 0) await expect(invited).toContainText('Pending invitations');
    await page.getByTestId('sort-name').click();
    await expect(page.getByTestId('sort-name').locator('xpath=..')).toHaveAttribute('aria-sort', 'descending');
  });

  test('audit log exports CSV', async ({ page }) => {
    const base = await orgBase(page);
    await page.goto(`${base}/admin/audit-log`);
    await expect(page.getByTestId('audit-row').first()).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByTestId('audit-export').click();
    expect((await download).suggestedFilename()).toMatch(/^kitstak-audit-log-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

test.describe('profile settings', () => {
  test('edits the title inline and persists it', async ({ page, diagnostics }) => {
    const base = await orgBase(page);
    const me = (await (await page.request.get('/api/v1/me')).json()) as { data: { organizations: { id: string }[] } };
    const headers = { 'x-org-id': me.data.organizations[0]?.id ?? '', origin: baseUrl() };
    const profile = (await (await page.request.get('/api/v1/profile', { headers })).json()) as { data: { user: { title: string | null } } };
    const original = profile.data.user.title;
    try {
      await page.goto(`${base}/settings/profile`);
      await expect(page.getByRole('heading', { level: 1 }).first()).toHaveText('My profile');
      const row = page.getByTestId('profile-title');
      await row.getByRole('button').click();
      await row.getByRole('textbox').fill('E2E Title');
      const saved = page.waitForResponse((r) => r.url().includes('/api/v1/profile') && r.request().method() === 'PATCH');
      await row.getByRole('textbox').press('Enter');
      expect((await saved).status()).toBe(200);
      await expect(row.getByRole('button')).toContainText('E2E Title');
      await page.reload();
      await expect(page.getByTestId('profile-title').getByRole('button')).toContainText('E2E Title');
      // Esc cancels without saving.
      await page.getByTestId('profile-title').getByRole('button').click();
      await page.getByTestId('profile-title').getByRole('textbox').fill('Not saved');
      await page.getByTestId('profile-title').getByRole('textbox').press('Escape');
      await expect(page.getByTestId('profile-title').getByRole('button')).toContainText('E2E Title');
      expect(diagnostics.errors).toEqual([]);
    } finally {
      // Restore through the API (retrying if the shared demo user is rate limited).
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const response = await page.request.patch('/api/v1/profile', { headers, data: { title: original } });
        if (response.ok()) break;
        await page.waitForTimeout(2_000);
      }
    }
  });

  test('tabs are deep-linkable and notification toggles persist', async ({ page }) => {
    const base = await orgBase(page);
    await page.goto(`${base}/settings/profile?tab=notifications`);
    const toggle = page.getByTestId('notif-due_date-email');
    await expect(toggle).toBeVisible();
    const before = await toggle.getAttribute('data-state');
    const flipped = before === 'checked' ? 'unchecked' : 'checked';
    const saved = page.waitForResponse((r) => r.url().includes('/api/v1/profile') && r.request().method() === 'PATCH');
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-state', flipped);
    expect((await saved).ok()).toBe(true);
    await page.reload();
    await expect(page.getByTestId('notif-due_date-email')).toHaveAttribute('data-state', flipped);
    await page.getByTestId('notif-due_date-email').click();
    await expect(page.getByTestId('notif-due_date-email')).toHaveAttribute('data-state', before ?? 'unchecked');
    // Unknown tabs fall back to Personal info and the URL is normalised.
    await page.goto(`${base}/settings/profile?tab=bogus`);
    await expect(page).not.toHaveURL(/tab=/);
    await expect(page.getByTestId('profile-personal')).toBeVisible();
    await page.getByTestId('profile-tab-security').click();
    await expect(page).toHaveURL(/tab=security/);
    await expect(page.getByTestId('my-sessions')).toBeVisible();
  });
});

test('trash page shows retention and filters', async ({ page, diagnostics }) => {
  const base = await orgBase(page);
  await page.goto(`${base}/trash`);
  await expect(page.getByRole('heading', { level: 1, name: 'Trash' })).toBeVisible();
  await expect(page.getByTestId('trash-retention')).toContainText('30 days');
  await waitForSettled(page);
  await page.getByTestId('trash-search').fill('zz-no-such-entry-zz');
  await expect(page.getByText(/nothing matches|trash is empty/i).first()).toBeVisible();
  expect(diagnostics.errors).toEqual([]);
});

publicTest('admin APIs require a session', async ({ request }) => {
  const response = await request.get('/api/v1/admin/users');
  expect(response.status()).toBe(401);
});

publicTest('a viewer gets 403 from admin APIs and the admins-only page', async ({ browser }) => {
  const credentials = loadCredentials();
  const api = await playwrightRequest.newContext({ baseURL: baseUrl(), extraHTTPHeaders: { origin: baseUrl() } });
  const signIn = await api.post('/api/auth/sign-in/email', {
    data: { email: 'aisha@northwind-robotics.example', password: credentials.password },
  });
  publicTest.skip(!signIn.ok(), `viewer sign-in unavailable (${signIn.status()})`);
  const me = (await (await api.get('/api/v1/me')).json()) as { data: { organizations: { id: string; slug: string }[] } };
  const org = me.data.organizations[0];
  expect(org).toBeTruthy();
  const headers = { 'x-org-id': org?.id ?? '' };
  expect((await api.get('/api/v1/admin/users', { headers })).status()).toBe(403);
  expect((await api.patch('/api/v1/admin/policy', { headers, data: { boardCreation: 'admins' } })).status()).toBe(403);
  expect((await api.get('/api/v1/admin/audit', { headers })).status()).toBe(403);
  // Their own profile still works.
  expect((await api.get('/api/v1/profile', { headers })).status()).toBe(200);
  // Better Auth's organization endpoint never leaks KitStak's private settings / member prefs,
  // and cannot overwrite them.
  const full = await api.get(`/api/auth/organization/get-full-organization?organizationId=${org?.id ?? ''}`);
  if (full.ok()) expect(await full.text()).not.toContain('kitstak');
  const overwrite = await api.post('/api/auth/organization/update', {
    data: { organizationId: org?.id, data: { metadata: { kitstak: {} } } },
  });
  expect(overwrite.ok()).toBe(false);
  // Trash: restore is disabled for viewers.
  const trash = (await (await api.get('/api/v1/trash', { headers })).json()) as { data: { canRestore: boolean }[] };
  expect(trash.data.every((entry) => entry.canRestore === false)).toBe(true);

  const context = await browser.newContext({ storageState: await api.storageState() });
  const page = await context.newPage();
  await page.goto(`/${org?.slug}/admin`);
  await expect(page.getByTestId('admin-forbidden')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Admins only' })).toBeVisible();
  await context.close();
  // End the viewer session so test runs don't pile up sessions in Admin → Security.
  await api.post('/api/auth/sign-out', { data: {} });
  await api.dispose();
});
