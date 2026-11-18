#!/usr/bin/env node
/**
 * Drives the chart gallery (`/dev/charts`) in a real browser and checks the behavior that
 * screenshots cannot: hover tooltips, arrow key movement with spoken text, the table toggle,
 * the error retry, the "how we got this" popover, and no sideways scroll at 390, 768 and 1440.
 *
 *   node scripts/charts-check.mjs --base http://localhost:3500 --out /tmp/claude-0/shots/charts
 *
 * Reuses <out>/.session.json from `charts-shots.mjs` (run that first, or it signs in itself).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const name of ['playwright', '@playwright/test', '/opt/node-tools/node_modules/playwright']) {
    try {
      return require(name);
    } catch {
      // try the next one
    }
  }
  throw new Error('Playwright is not installed.');
}

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const base = arg('--base', 'http://localhost:3500').replace(/\/+$/, '');
const out = arg('--out', '/tmp/claude-0/shots/charts');
const sessionFile = path.join(out, '.session.json');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}\n`);
};

async function open(browser, width, theme = 'light') {
  fs.mkdirSync(out, { recursive: true });
  const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme, storageState: fs.existsSync(sessionFile) ? sessionFile : undefined });
  await context.addCookies([{ name: 'kitstak-theme', value: theme, domain: new URL(base).hostname, path: '/' }]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text().slice(0, 200)));
  await page.goto(`${base}/dev/charts`, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!page.url().includes('/dev/charts')) {
    const signIn = await context.request.post(`${base}/api/auth/sign-in/email`, { data: { email: 'admin@kitstak.io', password: 'KitStak-Demo-2026!', rememberMe: true }, headers: { origin: base, 'content-type': 'application/json' } });
    if (!signIn.ok()) throw new Error(`Sign in failed (${signIn.status()})`);
    await context.storageState({ path: sessionFile });
    await page.goto(`${base}/dev/charts`, { waitUntil: 'networkidle', timeout: 90_000 });
  }
  await page.waitForSelector('[data-gallery] svg[role="group"]');
  await page.waitForTimeout(500);
  return { context, page, errors };
}

const exact = (text) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
const figure = (page, title) => page.locator('figure.pulse-chart', { has: page.locator('figcaption > span:first-child', { hasText: exact(title) }) }).first();

async function main() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    // --- layout at three widths, both themes ---
    for (const width of [390, 768, 1440]) {
      const { context, page, errors } = await open(browser, width, width === 768 ? 'dark' : 'light');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`no sideways page scroll at ${width}`, overflow <= 1, `${overflow}px`);
      const spill = await page.$$eval('[data-gallery] figure.pulse-chart, [data-gallery] .pulse-chart[role="img"]', (nodes) =>
        nodes.filter((node) => {
          const tile = node.closest('.rounded-lg');
          if (!tile) return false;
          return node.getBoundingClientRect().right > tile.getBoundingClientRect().right + 1 || node.getBoundingClientRect().left < tile.getBoundingClientRect().left - 1;
        }).length,
      );
      check(`no chart wider than its card at ${width}`, spill === 0, `${spill} spill`);
      const clipped = await page.$$eval('[data-gallery] svg[role="group"] text', (nodes) =>
        nodes.filter((node) => {
          const svg = node.ownerSVGElement.getBoundingClientRect();
          const box = node.getBoundingClientRect();
          return box.width > 0 && (box.left < svg.left - 14 || box.right > svg.right + 14);
        }).map((node) => node.textContent),
      );
      check(`no axis text cut off at ${width}`, clipped.length === 0, clipped.slice(0, 5).join(' | '));
      const count = await page.locator('[data-gallery] svg[role="group"]').count();
      check(`charts drew at ${width}`, count >= 25, `${count} charts`);
      check(`no console or page errors at ${width}`, errors.length === 0, errors.slice(0, 2).join(' | '));
      if (width === 768) await page.locator('[data-gallery="combo"]').screenshot({ path: path.join(out, 'combo-768-dark.png') });
      await context.close();
    }

    const { context, page, errors } = await open(browser, 1440);

    // --- hover tooltip on a line chart lists every series ---
    const line = figure(page, 'Revenue, cost and profit by day');
    const lineSvg = line.locator('svg[role="group"]');
    await lineSvg.scrollIntoViewIfNeeded();
    const box = await lineSvg.boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
    const tip = line.locator('.pc-tip');
    await tip.waitFor({ timeout: 3000 });
    const tipText = await tip.innerText();
    check('line hover shows a tooltip with all series and the target', ['Revenue', 'Cost', 'Profit', 'Profit target', '2026'].every((word) => tipText.includes(word)), tipText.replace(/\s+/g, ' '));
    await line.screenshot({ path: path.join(out, 'hover-line.png') });
    await page.mouse.move(box.x + box.width * 0.95, box.y + box.height * 0.4);
    await page.waitForTimeout(150);
    const tipBox = await tip.boundingBox();
    check('tooltip flips to stay inside the chart near the right edge', tipBox.x + tipBox.width <= box.x + box.width + 2, `${Math.round(tipBox.x + tipBox.width)} vs ${Math.round(box.x + box.width)}`);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(150);
    check('tooltip leaves with the pointer', (await line.locator('.pc-tip').count()) === 0);

    // --- keyboard: focus, arrows, live text, escape ---
    await lineSvg.focus();
    await page.waitForTimeout(100);
    const live = line.locator('[aria-live="polite"]');
    const first = await live.innerText();
    check('focus lands on the newest point and reads it out', first.includes('Nov 17, 2026') && first.includes('Revenue'), first);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    const moved = await live.innerText();
    check('arrow keys move between points', moved.includes('Nov 15, 2026'), moved);
    await page.keyboard.press('Home');
    check('Home jumps to the first point', (await live.innerText()).includes('Oct 19, 2026'));
    const outline = await lineSvg.evaluate((node) => getComputedStyle(node).outlineStyle);
    check('focused chart has a visible focus ring', outline !== 'none', outline);
    await page.keyboard.press('Escape');
    check('Escape clears the tooltip', (await line.locator('.pc-tip').count()) === 0);

    // --- bars: hover and keyboard ---
    const bars = figure(page, 'Profit by job');
    const barSvg = bars.locator('svg[role="group"]');
    await barSvg.scrollIntoViewIfNeeded();
    await barSvg.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const barLive = await bars.locator('[aria-live="polite"]').innerText();
    check('bar chart keyboard reads a loss with its sign', barLive.includes('J-1044') && barLive.includes('-$3,100'), barLive);
    await bars.screenshot({ path: path.join(out, 'focus-bar.png') });

    const hbar = figure(page, 'Margin by client');
    const hSvg = hbar.locator('svg[role="group"]');
    await hSvg.scrollIntoViewIfNeeded();
    const hBox = await hSvg.boundingBox();
    await page.mouse.move(hBox.x + hBox.width * 0.5, hBox.y + 36);
    await hbar.locator('.pc-tip').waitFor({ timeout: 3000 });
    const hTip = await hbar.locator('.pc-tip').innerText();
    check('horizontal bar hover shows the full name and the target', hTip.includes('Northwind Robotics') && hTip.includes('34.1%') && hTip.includes('Target'), hTip.replace(/\s+/g, ' '));

    // --- waterfall tooltip and table toggle ---
    const fall = figure(page, 'Why profit changed');
    const fallSvg = fall.locator('svg[role="group"]');
    await fallSvg.scrollIntoViewIfNeeded();
    await fallSvg.focus();
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowRight');
    const fallLive = await fall.locator('[aria-live="polite"]').innerText();
    check('waterfall reads the step, its change and the running total', fallLive.includes('Labor efficiency') && fallLive.includes('-$9,400') && fallLive.includes('Running total: $45,100'), fallLive);
    await fall.screenshot({ path: path.join(out, 'focus-waterfall.png') });
    const toggle = fall.getByRole('button', { name: 'Show table' });
    await toggle.focus();
    await page.keyboard.press('Enter');
    const table = fall.locator('table');
    check('Show table shows the same numbers as a table', (await table.isVisible()) && (await table.innerText()).includes('Actual profit') && (await fall.getByRole('button', { name: 'Hide table' }).getAttribute('aria-pressed')) === 'true');
    await fall.screenshot({ path: path.join(out, 'table-waterfall.png') });
    await fall.getByRole('button', { name: 'Hide table' }).click();
    check('Hide table hides it again', await table.evaluate((node) => node.parentElement.classList.contains('sr-only')));
    const hiddenRows = await figure(page, 'Units by week').locator('table tbody tr').count();
    check('every chart keeps a screen reader table', hiddenRows === 12, `${hiddenRows} rows`);

    // --- combo, pareto, donut, heatmap ---
    const combo = figure(page, 'Revenue and margin by month');
    const comboSvg = combo.locator('svg[role="group"]');
    await comboSvg.scrollIntoViewIfNeeded();
    const cBox = await comboSvg.boundingBox();
    await page.mouse.move(cBox.x + cBox.width * 0.5, cBox.y + cBox.height * 0.6);
    await combo.locator('.pc-tip').waitFor({ timeout: 3000 });
    const cTip = await combo.locator('.pc-tip').innerText();
    check('combo tooltip shows revenue and margin together', cTip.includes('Revenue') && cTip.includes('Margin') && cTip.includes('%') && cTip.includes('$'), cTip.replace(/\s+/g, ' '));
    await combo.screenshot({ path: path.join(out, 'hover-combo.png') });

    const donut = figure(page, 'Cost by kind');
    const donutSvg = donut.locator('svg[role="group"]');
    await donutSvg.scrollIntoViewIfNeeded();
    await donutSvg.focus();
    await page.keyboard.press('ArrowRight');
    const dLive = await donut.locator('[aria-live="polite"]').innerText();
    check('donut keyboard reads a slice with its share', dLive.includes('Material') && dLive.includes('29%'), dLive);
    await donut.screenshot({ path: path.join(out, 'focus-donut.png') });

    const heat = figure(page, 'Units by day');
    const heatSvg = heat.locator('svg[role="group"]');
    await heatSvg.scrollIntoViewIfNeeded();
    await heatSvg.focus();
    const h0 = await heat.locator('[aria-live="polite"]').innerText();
    await page.keyboard.press('ArrowLeft');
    const h1 = await heat.locator('[aria-live="polite"]').innerText();
    await page.keyboard.press('ArrowUp');
    const h2 = await heat.locator('[aria-live="polite"]').innerText();
    check('heatmap arrows move by week and by day', h0 !== h1 && h1 !== h2 && /\d{4}/.test(h2), `${h0} > ${h1} > ${h2}`);
    await heat.locator('rect[data-index]').nth(10).hover();
    await heat.locator('.pc-tip').waitFor({ timeout: 3000 });
    check('heatmap hover shows the day and its value', (await heat.locator('.pc-tip').innerText()).includes('Good units'));
    await heat.screenshot({ path: path.join(out, 'hover-heatmap.png') });

    // --- error retry and the "how we got this" slot ---
    const errorTile = page.locator('[data-gallery="states"] .rounded-lg', { hasText: 'We could not load this chart' }).first();
    await errorTile.scrollIntoViewIfNeeded();
    await errorTile.getByRole('button', { name: 'Try again' }).click();
    await errorTile.getByRole('button', { name: 'Try again' }).click();
    check('Try again calls onRetry', (await errorTile.innerText()).includes('Tried again 2 times.'));
    check('error state is an alert', (await errorTile.locator('[role="alert"]').count()) === 1);
    check('loading state says it is busy', (await page.locator('[data-gallery="states"] [role="status"][aria-busy="true"]').count()) >= 3);

    const explain = page.getByRole('button', { name: 'How we got this: Profit on jobs' });
    await explain.scrollIntoViewIfNeeded();
    await explain.focus();
    await page.keyboard.press('Enter');
    const pop = page.getByRole('dialog');
    await pop.waitFor({ timeout: 3000 });
    check('KpiTile explain slot opens from the keyboard', (await pop.innerText()).includes('Profit is revenue minus cost'));
    await page.locator('[data-gallery="stats"]').screenshot({ path: path.join(out, 'explain-popover.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check('Escape closes it and focus returns', await explain.evaluate((node) => node === document.activeElement));

    // --- a11y names ---
    const unnamed = await page.$$eval('[data-gallery] svg[role="group"]', (nodes) => nodes.filter((node) => !node.querySelector('title')?.textContent || !node.querySelector('desc')?.textContent).length);
    check('every interactive chart has a title and a desc', unnamed === 0, `${unnamed} without`);
    const images = await page.$$eval('[data-gallery] [role="img"]', (nodes) => nodes.filter((node) => !node.getAttribute('aria-label')).length);
    check('every image style chart has a label', images === 0, `${images} without`);
    check('no console or page errors during the run', errors.length === 0, errors.slice(0, 2).join(' | '));

    // --- reduced motion ---
    await context.close();
    const reduced = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', storageState: sessionFile });
    const rp = await reduced.newPage();
    await rp.goto(`${base}/dev/charts`, { waitUntil: 'networkidle' });
    await rp.waitForSelector('.pc-grow');
    const duration = await rp.$eval('.pc-grow', (node) => getComputedStyle(node).transitionDuration);
    check('reduced motion turns chart transitions off', duration.split(',').every((part) => parseFloat(part) < 0.001), duration);
    await reduced.close();
  } finally {
    await browser.close();
  }
  const failed = results.filter((result) => !result.ok);
  process.stdout.write(`\n${results.length - failed.length} of ${results.length} checks passed\n`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
