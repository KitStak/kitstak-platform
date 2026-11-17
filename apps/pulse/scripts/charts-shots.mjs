#!/usr/bin/env node
/**
 * Screenshots of the chart gallery (`/dev/charts`, dev servers only): one PNG for each gallery
 * section, in light and dark, at 1440 and 390 wide (or the widths you pass).
 *
 *   node scripts/charts-shots.mjs --base http://localhost:3500 --out /tmp/claude-0/shots/charts
 *   node scripts/charts-shots.mjs --widths 1440,768,390 --themes dark --sections bar,combo
 *   node scripts/charts-shots.mjs --hover     also shoots each chart with its tooltip open
 *
 * Signs in once and keeps the session in <out>/.session.json so repeat runs do not hit the
 * sign in rate limit. Files: <out>/<section>-<width>-<theme>.png.
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
  throw new Error('Playwright is not installed. Run `pnpm install` at the repo root.');
}

function parseArgs(argv) {
  const options = { base: process.env.SHOT_BASE_URL ?? 'http://localhost:3500', out: '/tmp/claude-0/shots/charts', user: 'admin@kitstak.io', password: 'KitStak-Demo-2026!', widths: [1440, 390], themes: ['light', 'dark'], sections: null, hover: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--base') options.base = next().replace(/\/+$/, '');
    else if (arg === '--out') options.out = next();
    else if (arg === '--user') options.user = next();
    else if (arg === '--password') options.password = next();
    else if (arg === '--widths') options.widths = next().split(',').map(Number);
    else if (arg === '--themes') options.themes = next().split(',');
    else if (arg === '--sections') options.sections = next().split(',');
    else if (arg === '--hover') options.hover = true;
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { chromium } = loadPlaywright();
  fs.mkdirSync(options.out, { recursive: true });
  const sessionFile = path.join(options.out, '.session.json');
  const host = new URL(options.base).hostname;
  const browser = await chromium.launch();
  const problems = [];
  try {
    for (const theme of options.themes) {
      for (const width of options.widths) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          deviceScaleFactor: 1,
          colorScheme: theme === 'dark' ? 'dark' : 'light',
          storageState: fs.existsSync(sessionFile) ? sessionFile : undefined,
        });
        await context.addCookies([{ name: 'kitstak-theme', value: theme, domain: host, path: '/' }]);
        const page = await context.newPage();
        page.on('pageerror', (error) => problems.push(`${theme} ${width}: ${error.message}`));
        page.on('console', (message) => {
          if (message.type() === 'error') problems.push(`${theme} ${width} console: ${message.text().slice(0, 300)}`);
        });
        let response = await page.goto(`${options.base}/dev/charts`, { waitUntil: 'networkidle', timeout: 90_000 });
        if (!page.url().includes('/dev/charts')) {
          const signIn = await context.request.post(`${options.base}/api/auth/sign-in/email`, {
            data: { email: options.user, password: options.password, rememberMe: true },
            headers: { origin: options.base, 'content-type': 'application/json' },
          });
          if (!signIn.ok()) throw new Error(`Sign in failed (${signIn.status()}): ${await signIn.text()}`);
          await context.storageState({ path: sessionFile });
          response = await page.goto(`${options.base}/dev/charts`, { waitUntil: 'networkidle', timeout: 90_000 });
        }
        if (!response || response.status() !== 200) throw new Error(`/dev/charts answered ${response?.status()}`);
        await page.waitForSelector('[data-gallery]');
        await page.waitForTimeout(700);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) problems.push(`${theme} ${width}: the page scrolls sideways by ${overflow}px`);
        const ids = await page.$$eval('[data-gallery]', (nodes) => nodes.map((node) => node.getAttribute('data-gallery')));
        for (const id of ids) {
          if (options.sections && !options.sections.includes(id)) continue;
          const section = page.locator(`[data-gallery="${id}"]`);
          await section.scrollIntoViewIfNeeded();
          const file = path.join(options.out, `${id}-${width}-${theme}.png`);
          await section.screenshot({ path: file });
          process.stdout.write(`${file}\n`);
          if (options.hover) {
            const charts = section.locator('svg[role="group"]');
            const count = await charts.count();
            for (let index = 0; index < count; index += 1) {
              const chart = charts.nth(index);
              await chart.scrollIntoViewIfNeeded();
              const box = await chart.boundingBox();
              if (!box) continue;
              await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.45);
              await page.waitForTimeout(150);
              const tile = chart.locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
              const hoverFile = path.join(options.out, `${id}-${width}-${theme}-hover-${index + 1}.png`);
              await tile.screenshot({ path: hoverFile });
              process.stdout.write(`${hoverFile}\n`);
            }
            await page.mouse.move(0, 0);
          }
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  if (problems.length) {
    process.stdout.write(`\nProblems:\n  ${[...new Set(problems)].join('\n  ')}\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
