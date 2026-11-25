#!/usr/bin/env node
/**
 * End to end flows for Programs (docs/programs/SPEC.md 9.3), run against the dev servers with the
 * seeded Northwind data.
 *
 *   node scripts/e2e-programs.mjs                      # every flow
 *   node scripts/e2e-programs.mjs wizard log-output    # some flows
 *   node scripts/e2e-programs.mjs --base http://localhost:3400 --pulse http://localhost:3500 --crm http://localhost:3100
 *
 * Flows that write make their own program (key E + 4 letters, new every run), so the seeded GLOVE
 * numbers stay as the seed check printed them. Month close closes and reopens ECOMM's first month, which
 * leaves its money as it was. Floor today logs one row per program, so it runs last; reseed
 * (CRM, Projects, Pulse) before taking 9.4 screenshots again. Exits 1 when any flow fails.
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);

function loadPlaywright() {
  for (const name of ['playwright', '@playwright/test', '/opt/node-tools/node_modules/playwright']) {
    try {
      return require(name);
    } catch {
      // try next
    }
  }
  throw new Error('Playwright is not installed. Run `pnpm install` at the repo root.');
}

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};
const BASE = opt('base', process.env.PROJECTS_URL ?? 'http://localhost:3400').replace(/\/+$/, '');
const PULSE = opt('pulse', process.env.PULSE_URL ?? 'http://localhost:3500').replace(/\/+$/, '');
const CRM = opt('crm', process.env.CRM_URL ?? 'http://localhost:3100').replace(/\/+$/, '');
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/kitstak';
const OUT = opt('out', '/tmp/claude-0/e2e-programs');
const valueFlags = new Set(['--base', '--pulse', '--crm', '--out']);
const wanted = argv.filter((arg, index) => !arg.startsWith('--') && !valueFlags.has(argv[index - 1] ?? ''));
const PASSWORD = 'Northwind-Demo-2026!';
const MAYA = 'maya@northwind-robotics.example';

const sql = (query) => execSync(`psql "${DATABASE_URL}" -Atc ${JSON.stringify(query)}`).toString().trim();
const today = sql("select to_char((now() at time zone 'America/Chicago')::date, 'YYYY-MM-DD')");
const key = `E${Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('')}`;
const money = (cents) => `$${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

fs.mkdirSync(OUT, { recursive: true });
const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const results = [];

const signedIn = new Map();

/** A browser context signed in as `email` (one sign in per person and app; sign in is rate limited). */
async function session(email, base = BASE, viewport = { width: 1440, height: 900 }) {
  const id = `${email} ${base}`;
  if (!signedIn.has(id)) {
    const login = await browser.newContext();
    for (let attempt = 0; ; attempt += 1) {
      const res = await login.request.post(`${base}/api/auth/sign-in/email`, { data: { email, password: PASSWORD, rememberMe: true }, headers: { origin: base, 'content-type': 'application/json' } });
      if (res.ok()) break;
      if (res.status() !== 429 || attempt >= 5) throw new Error(`Sign in as ${email} at ${base} failed (${res.status()})`);
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
    signedIn.set(id, await login.storageState());
    await login.close();
  }
  return browser.newContext({ viewport, deviceScaleFactor: 1, storageState: signedIn.get(id) });
}

async function open(page, url) {
  await page.goto(url, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
}

async function flow(name, run, { who = MAYA, base = BASE } = {}) {
  if (wanted.length && !wanted.includes(name)) return;
  const started = Date.now();
  const context = await session(who, base);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await run(page, context);
    assert(errors.length === 0, `page errors: ${errors.slice(0, 2).join(' | ')}`);
    results.push({ name, ok: true, ms: Date.now() - started });
    process.stdout.write(`pass  ${name} (${Math.round((Date.now() - started) / 1000)}s)\n`);
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, error: error instanceof Error ? error.message.split('\n')[0] : String(error) });
    process.stdout.write(`FAIL  ${name}: ${results.at(-1).error}\n`);
    await page.screenshot({ path: `${OUT}/${name}-fail.png` }).catch(() => undefined);
  }
  await context.close();
}

const buildsOf = (programKey, date = null) =>
  Number(sql(`select count(*) from pm.builds b join pm.tasks t on t.id = b.task_id and t.deleted_at is null join pm.projects p on p.id = b.container_id where p.key = '${programKey}'${date ? ` and b.build_date = '${date}'` : ''}`));

// 1. Wizard from scratch: Paste a list, a rate rule, card, weekday schedule, no links.
await flow('wizard', async (page) => {
  await open(page, `${BASE}/programs/new?mode=scratch`);
  await page.fill('[data-testid=program-name]', `Glove kitting ${key}`);
  await page.fill('[data-testid=program-key]', key);
  await page.click('[data-testid=wizard-next]');
  await page.waitForTimeout(600);
  await page.getByRole('radio', { name: 'Paste a list' }).click();
  await page.fill('[data-testid=paste-text]', ['S-BRN', 'S-YLW', 'M-BRN', 'M-YLW', 'L-BRN', 'L-YLW', 'XL-BRN', 'XL-YLW'].map((s) => `${key}-${s}`).join('\n'));
  await page.waitForTimeout(500);
  const names = page.locator('input[aria-label^="Name of attribute"]');
  const n = await names.count();
  if (n >= 2) {
    await names.nth(n - 2).fill('Size');
    await names.nth(n - 1).fill('Color');
  }
  await page.click('[data-testid=paste-use]');
  await page.waitForTimeout(800);
  await page.click('[data-testid=wizard-next]');
  await page.waitForTimeout(600);
  await page.locator('input[data-testid=line-per-unit-price]').fill('1.95');
  await page.mouse.click(5, 5);
  await page.click('[data-testid=wizard-next]');
  await page.waitForTimeout(800);
  await page.click('[data-testid=wizard-next]');
  await page.waitForTimeout(800);
  await page.click('[data-testid=create-program]');
  await page.waitForURL(new RegExp(`/programs/${key}`), { timeout: 60_000 });
  const toast = await page.getByText(new RegExp(`${key} is ready`)).first().textContent({ timeout: 15_000 });
  const made = buildsOf(key);
  const said = Number(/(\d+) builds? (were|was) planned/.exec(toast ?? '')?.[1] ?? 0);
  assert(made > 0 && said === made, `toast says ${said} builds, ${made} were made`);
  if (today === '2026-11-25') assert(made === 40, `expected 40 builds on 2026-11-25, got ${made}`);
});

// 2. Wizard from a won deal (Step 0 skipped): prefill, deal callout, Set prices later.
await flow('wizard-deal', async (page) => {
  const deal = sql("select i.id from crm.items i join crm.boards b on b.id = i.board_id join core.organization o on o.id = i.org_id where o.slug = 'northwind-robotics' and b.kind = 'deals' and i.name = 'Gripwell Safety Supply · Winter liner add on' limit 1");
  assert(deal, 'the Winter liner add on deal is not seeded');
  await open(page, `${BASE}/programs/new?mode=deal&crmItem=${deal}`);
  assert((await page.getByTestId('wizard-start').count()) === 0, 'Step 0 should be skipped for a deal');
  const from = page.getByText('Starting from a won deal').locator('..');
  await from.waitFor({ timeout: 15_000 });
  assert(/\$42,000/.test((await from.textContent()) ?? ''), 'the deal value shows on Basics');
  const dealKey = `D${key.slice(1)}`;
  await page.fill('[data-testid=program-key]', dealKey);
  await page.click('[data-testid=wizard-next]');
  await page.waitForTimeout(700);
  await page.getByRole('radio', { name: 'Paste a list' }).click();
  await page.fill('[data-testid=paste-text]', [`${dealKey}-S`, `${dealKey}-M`, `${dealKey}-L`].join('\n'));
  await page.waitForTimeout(500);
  await page.click('[data-testid=paste-use]');
  await page.waitForTimeout(700);
  await page.click('[data-testid=wizard-next]');
  await page.getByTestId('deal-callout').waitFor({ timeout: 15_000 });
  assert(/\$42,000/.test((await page.getByTestId('deal-callout').textContent()) ?? ''), 'the price step shows the deal value callout');
  await page.getByTestId('price-later').click();
  for (let step = 0; step < 4 && !(await page.getByTestId('create-program').count()); step += 1) {
    await page.click('[data-testid=wizard-next]');
    await page.waitForTimeout(700);
  }
  await page.click('[data-testid=create-program]');
  await page.waitForURL(new RegExp(`/programs/${dealKey}`), { timeout: 60_000 });
  await page.getByText(/price card/i).first().waitFor({ timeout: 15_000 });
  const edges = Number(sql(`select count(*) from core.record_links l join pm.projects p on p.id::text = l.from_id where p.key = '${dealKey}' and l.relation in ('created_from', 'belongs_to')`));
  assert(edges === 2, `the deal program has ${edges} of 2 CRM links`);
});

// 3. Planner: fill the week after next, create, Undo, create again.
await flow('planner', async (page) => {
  const from = sql("select to_char(date_trunc('week', (now() at time zone 'America/Chicago')::date + 14)::date, 'YYYY-MM-DD')");
  await open(page, `${BASE}/programs/${key}?plan=week&from=${from}`);
  await page.getByTestId('build-planner').waitFor({ timeout: 20_000 });
  const before = buildsOf(key);
  const fill = async (item) => {
    await page.getByTestId('planner-actions').click();
    await page.getByRole('menuitem', { name: new RegExp(item) }).click();
    await page.waitForTimeout(600);
  };
  const plan = async () => {
    // The week before (the schedule's builds) loads after the grid: wait for it before copying.
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(1500);
    // Copy last week, then Suggest from history; a brand new program has neither, so type a few cells too.
    await fill('Copy last week');
    await fill('Suggest from history');
    if (!(await page.getByTestId('planner-create').isEnabled())) {
      for (let i = 0; i < 3; i += 1) {
        await page.getByTestId('planner-cell').nth(i * 8).click();
        await page.keyboard.type('100');
        await page.keyboard.press('Enter');
      }
      await page.waitForTimeout(600);
    }
    // Copy and Suggest fill the grid from the server: wait until the Create label stops changing.
    let label = '';
    for (let i = 0; i < 20; i += 1) {
      const next = (await page.getByTestId('planner-create').textContent()) ?? '';
      if (next === label && next) break;
      label = next;
      await page.waitForTimeout(500);
    }
    await page.getByTestId('planner-create').click();
  };
  const settle = async (want, label) => {
    for (let i = 0; i < 40 && buildsOf(key) !== want; i += 1) await page.waitForTimeout(750);
    assert(buildsOf(key) === want, `${label}: ${buildsOf(key) - before} builds left over`);
  };
  await plan();
  for (let i = 0; i < 20 && buildsOf(key) === before; i += 1) await page.waitForTimeout(750);
  const made = buildsOf(key) - before;
  assert(made > 0, 'the planner made no builds');
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).or(page.getByRole('button', { name: 'Undo', exact: true })).first().click();
  await settle(before, 'Undo');
  await open(page, `${BASE}/programs/${key}?plan=week&from=${from}`);
  await page.getByTestId('build-planner').waitFor({ timeout: 20_000 });
  await plan();
  await settle(before + made, 'Create again');
});

// 4. Price card (before any output today, so the new version can replace the first one on its start day): three
//    variant rate changes make one pending draft; publish.
await flow('price-card', async (page) => {
  await open(page, `${BASE}/programs/${key}/variants`);
  for (const variant of ['XL-BRN', 'XL-YLW', 'L-BRN']) {
    const row = page.getByTestId('variant-row').filter({ hasText: variant }).first();
    await row.getByRole('button', { name: /^Actions for / }).click();
    await page.getByRole('menuitem', { name: 'Change rate' }).click();
    const dialog = page.getByTestId('change-rate-dialog');
    await dialog.locator('input').first().fill(variant.startsWith('XL') ? '2.20' : '2.05');
    await page.getByTestId('change-rate-save').click();
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    await page.waitForTimeout(800);
  }
  await page.getByTestId('pending-changes-bar').waitFor({ timeout: 10_000 });
  const drafts = Number(sql(`select count(*) from pm.price_card_versions v join pm.projects p on p.id = v.program_id where p.key = '${key}' and v.status = 'draft' and v.deleted_at is null`));
  assert(drafts === 1, `three rate changes made ${drafts} drafts`);
  await page.getByTestId('pending-changes-bar').getByRole('button', { name: 'Review and publish' }).click();
  await page.getByTestId('publish-version').waitFor({ timeout: 15_000 });
  await page.getByTestId('publish-version').click();
  await page.getByRole('button', { name: /^Publish/ }).last().click().catch(() => undefined);
  await page.waitForTimeout(2500);
  // Published the same day as v1 with no output yet, v2 replaces v1 (the same day fold); either way no draft is left.
  for (let i = 0; i < 20 && Number(sql(`select count(*) from pm.price_card_versions v join pm.projects p on p.id = v.program_id where p.key = '${key}' and v.status = 'draft' and v.deleted_at is null`)) > 0; i += 1) await page.waitForTimeout(750);
  const left = Number(sql(`select count(*) from pm.price_card_versions v join pm.projects p on p.id = v.program_id where p.key = '${key}' and v.status = 'draft' and v.deleted_at is null`));
  const newest = Number(sql(`select coalesce(max(v.number), 0) from pm.price_card_versions v join pm.projects p on p.id = v.program_id where p.key = '${key}' and v.status = 'published'`));
  assert(left === 0 && newest >= 2, `the draft was not published (drafts ${left}, newest v${newest})`);
  const rate = sql(`select max(l.unit_price)::text from pm.price_card_lines l join pm.price_card_versions v on v.id = l.version_id join pm.projects p on p.id = v.program_id where p.key = '${key}' and v.number = ${newest} and l.variant_id is not null`);
  assert(Number(rate) === 2.2, `the published card has the XL rate ${rate}`);
});

// 5. Log output: O opens the dialog, scan two SKUs, fill all, add a row, close the day.
await flow('log-output', async (page) => {
  await open(page, `${BASE}/programs/${key}`);
  await page.keyboard.press('o');
  await page.getByTestId('log-output-dialog').waitFor({ timeout: 15_000 });
  const scan = page.getByTestId('log-scan');
  await scan.fill(`${key}-S-BRN`);
  await scan.press('Enter');
  await scan.fill(`${key}-S-YLW`);
  await scan.press('Enter');
  await page.getByTestId('log-fill-all').click();
  const rows = page.getByTestId('log-built');
  const count = await rows.count();
  assert(count >= 8, `log dialog shows ${count} rows`);
  await rows.nth(count - 1).fill('40');
  await rows.nth(count - 2).fill('70');
  await page.getByTestId('log-add-row').click();
  await page.getByRole('combobox', { name: 'Variant for the new row' }).click();
  await page.getByRole('option', { name: /Small Brown/ }).first().click();
  await page.getByRole('textbox', { name: 'Built for the new row' }).fill('5');
  await page.getByTestId('log-add-confirm').click();
  await page.getByTestId('log-new-row').first().waitFor({ timeout: 5_000 });
  await page.getByTestId('log-save-close').click();
  await page.getByTestId('close-day-list').waitFor({ timeout: 10_000 });
  const decisions = page.getByTestId('close-day-row');
  assert((await decisions.count()) >= 2, 'close the day lists the short builds');
  await decisions.nth(0).getByRole('radio', { name: 'Close short' }).click();
  await decisions.nth(0).getByTestId('close-short-reason').fill('Ran out of liners');
  await page.getByTestId('close-day-save').click();
  await page.getByRole('button', { name: 'Undo' }).first().waitFor({ timeout: 15_000 });
  const built = Number(sql(`select coalesce(sum(o.qty), 0) from pm.build_output o join pm.projects p on p.id = o.container_id where p.key = '${key}' and o.deleted_at is null and o.work_date = '${today}'`));
  assert(built > 0, 'no output saved');
  const moved = Number(sql(`select count(*) from pm.builds b join pm.projects p on p.id = b.container_id where p.key = '${key}' and b.split_from_id is not null`));
  assert(moved >= 1, 'Move the rest made no linked build');
  const summary = await (await page.request.get(`${BASE}/api/v1/programs/${key}/summary`)).json();
  const units = Number(summary?.data?.today?.builtUnits ?? summary?.today?.builtUnits ?? 0);
  assert(units === built, `Overview today ${units} vs saved ${built}`);
});

// 6. Month close: close ECOMM's first month (September on the seed), see the lock, reopen with a reason.
await flow('month-close', async (page) => {
  const month = sql("select to_char(p.start_date, 'YYYY-MM') from pm.projects p where p.key = 'ECOMM' and p.kind = 'program'");
  await open(page, `${BASE}/programs/ECOMM?close=${month}`);
  await page.getByTestId('close-sheet').waitFor({ timeout: 15_000 });
  await page.getByTestId('close-month-confirm').click();
  await page.getByRole('button', { name: /^Close/ }).last().click().catch(() => undefined);
  await page.waitForTimeout(2500);
  const closed = sql(`select count(*) from pm.program_closes c join pm.projects p on p.id = c.program_id where p.key = 'ECOMM' and c.month = '${month}-01' and c.reopened_at is null`);
  assert(Number(closed) === 1, `${month} did not close`);
  await page.getByText(/is closed/).first().waitFor({ timeout: 10_000 });
  await open(page, `${BASE}/programs/ECOMM?close=${month}`);
  await page.getByTestId('close-sheet').getByRole('button', { name: 'Reopen', exact: true }).click();
  await page.getByTestId('reopen-dialog').locator('textarea').fill('Brightcart sent late returns');
  await page.getByTestId('reopen-confirm').click();
  await page.waitForTimeout(2500);
  const open2 = sql(`select count(*) from pm.program_closes c join pm.projects p on p.id = c.program_id where p.key = 'ECOMM' and c.month = '${month}-01' and c.reopened_at is null`);
  assert(Number(open2) === 0, `${month} did not reopen`);
});

// 7. Kind isolation in the UI.
await flow('kind-isolation', async (page) => {
  await open(page, `${BASE}/projects`);
  const projects = await page.locator('main').innerText();
  for (const program of ['GLOVE', 'DUDE', 'MAHCO', 'ECOMM']) assert(!projects.includes(program), `${program} shows on Projects`);
  await open(page, `${BASE}/programs`);
  const programs = await page.locator('main').innerText();
  for (const program of ['Glove kitting', 'Grooming kits', 'Hardware packs', 'Order kitting']) assert(programs.includes(program), `${program} is missing on Programs`);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('glove');
  await page.waitForTimeout(1200);
  const palette = await page.getByRole('dialog').innerText();
  assert(!/Projects[\s\S]*GLOVE/.test(palette) || palette.includes('Programs'), 'the palette lists the program as a project');
  await page.keyboard.press('Escape');
  const fra = sql("select t.number from pm.tasks t join pm.projects p on p.id = t.project_id where p.key = 'FRA' and t.kind = 'build' order by t.number limit 1");
  await open(page, `${BASE}/p/FRA/board?task=FRA-${fra}`);
  await page.getByText('Not billed').first().waitFor({ timeout: 15_000 });
});

// 8. Pulse: J-1040 shows the program card, by variant, and the GLOVE month revenue.
await flow('pulse', async (page) => {
  const glove = await (await page.request.get(`${BASE}/api/v1/programs/GLOVE/summary`)).json();
  const total = (glove.data ?? glove).result.totalCents;
  const context = await session(MAYA, PULSE);
  const pulse = await context.newPage();
  // Pulse picks up program changes when its apps ask for the connection status (sync after the
  // response), so ask, wait for the change notes to be answered, then read the job.
  const pending = () => Number(sql("select count(*) from pulse.bridge_events e join core.organization o on o.id = e.org_id where o.slug = 'northwind-robotics' and e.kind = 'pm_program_changed' and e.processed_at is null"));
  for (let i = 0; i < 20 && pending() > 0; i += 1) {
    if (i % 5 === 0) await context.request.get(`${PULSE}/api/v1/integrations/status`).catch(() => undefined);
    await pulse.waitForTimeout(1500);
  }
  let text = '';
  for (let i = 0; i < 4; i += 1) {
    await open(pulse, `${PULSE}/jobs/J-1040`);
    text = await pulse.locator('main').innerText();
    if (text.includes(money(total))) break;
    await pulse.waitForTimeout(4000);
  }
  assert(/GLOVE/.test(text), 'the Program card is missing on J-1040');
  assert(/By variant/i.test(text), 'the By variant table is missing');
  assert(text.includes(money(total)), `J-1040 does not show ${money(total)}`);
  await context.close();
});

// 9. CRM: the Gripwell account Programs tab lists GLOVE with the same money and the deal line.
await flow('crm', async (page) => {
  const glove = await (await page.request.get(`${BASE}/api/v1/programs/GLOVE/summary`)).json();
  const total = (glove.data ?? glove).result.totalCents;
  const row = sql("select i.id || ' ' || i.board_id from crm.items i join crm.boards b on b.id = i.board_id join core.organization o on o.id = i.org_id where o.slug = 'northwind-robotics' and b.kind = 'accounts' and i.name = 'Gripwell Safety Supply'");
  const [item, board] = row.split(' ');
  const context = await session(MAYA, CRM);
  const crm = await context.newPage();
  await open(crm, `${CRM}/northwind-robotics/boards/${board}?item=${item}&itemTab=programs`);
  await crm.getByText('GLOVE').first().waitFor({ timeout: 30_000 });
  await crm.getByText(money(total)).first().waitFor({ timeout: 30_000 }).catch(() => undefined);
  const text = await crm.locator('body').innerText();
  assert(text.includes(money(total)), `the CRM panel does not show ${money(total)}`);
  await context.close();
});

// 10. Money hidden: Aisha (viewer) and Liam (no program role) see units only; exports refuse.
for (const who of ['aisha', 'liam']) {
  await flow(`money-hidden-${who}`, async (page) => {
    await open(page, `${BASE}/programs/GLOVE`);
    const overview = await page.locator('main').innerText();
    assert(!/\$\d/.test(overview), `${who} sees money on Overview`);
    await open(page, `${BASE}/programs/GLOVE/activity`);
    assert(!/\$\d/.test(await page.locator('main').innerText()), `${who} sees money in Activity`);
    for (const format of ['csv', 'pdf']) {
      const res = await page.request.get(`${BASE}/api/v1/programs/GLOVE/statement?month=2026-10&format=${format}`);
      assert(res.status() === 403, `${format} export returned ${res.status()} for ${who}`);
    }
  }, { who: `${who}@northwind-robotics.example` });
}

// 11. Floor today: one row per program inline, then Close the day for all.
await flow('floor-today', async (page) => {
  await open(page, `${BASE}/programs/today`);
  const programs = page.getByTestId('floor-program');
  const n = await programs.count();
  assert(n >= 3, `Floor today shows ${n} programs`);
  const before = Number(sql(`select coalesce(sum(o.qty), 0) from pm.build_output o join core.organization g on g.id = o.org_id where g.slug = 'northwind-robotics' and o.deleted_at is null and o.work_date = '${today}'`));
  let typed = 0;
  for (let i = 0; i < n; i += 1) {
    const cells = programs.nth(i).locator('input[data-testid=floor-cell], [data-testid=floor-cell] input');
    for (let c = (await cells.count()) - 1; c >= 0; c -= 1) {
      if ((await cells.nth(c).inputValue()) !== '') continue;
      await cells.nth(c).fill('10');
      await cells.nth(c).press('Enter');
      typed += 1;
      break;
    }
  }
  assert(typed >= 1, 'no open build to log on Floor today');
  const saved = () => Number(sql(`select coalesce(sum(o.qty), 0) from pm.build_output o join core.organization g on g.id = o.org_id where g.slug = 'northwind-robotics' and o.deleted_at is null and o.work_date = '${today}'`)) - before;
  for (let i = 0; i < 30 && saved() < typed * 10; i += 1) await page.waitForTimeout(500);
  assert(saved() === typed * 10, `Floor today saved ${saved()} units, want ${typed * 10}`);
  await page.getByTestId('floor-close-all-button').click();
  const dialog = page.getByTestId('floor-close-all');
  await dialog.waitFor({ timeout: 10_000 });
  // One build moves its rest to the next work day; the others stay open (each move is a split, which is slow on a busy dev server).
  const leave = dialog.getByRole('radio', { name: 'Leave open' });
  const rows = await leave.count();
  for (let i = 1; i < rows; i += 1) await leave.nth(i).click();
  const openBefore = Number(sql(`select count(*) from pm.builds b join core.organization g on g.id = b.org_id where g.slug = 'northwind-robotics' and b.split_from_id is not null`));
  await dialog.getByRole('button', { name: 'Close the day', exact: true }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 180_000 });
  const moved = Number(sql(`select count(*) from pm.builds b join core.organization g on g.id = b.org_id where g.slug = 'northwind-robotics' and b.split_from_id is not null`)) - openBefore;
  assert(rows === 0 || moved === 1, `Close the day for all moved ${moved} builds, want 1`);
});

await browser.close();
const failed = results.filter((r) => !r.ok);
process.stdout.write(`\n${results.length - failed.length} of ${results.length} flows passed (program ${key}).\n`);
if (failed.length) process.exit(1);
