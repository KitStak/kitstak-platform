#!/usr/bin/env node
/**
 * Screenshot helper for teammates and QA.
 *
 *   node scripts/shot.mjs --base http://localhost:3501 / /jobs /log
 *   node scripts/shot.mjs --base http://localhost:3501 --theme dark --width 390 --out /tmp/claude-0/shots /profit
 *   node scripts/shot.mjs --base http://localhost:3501 --user maya@northwind-robotics.example --password Northwind-Demo-2026! /
 *
 * Signs in through POST /api/auth/sign-in/email (default admin@kitstak.io / KitStak-Demo-2026!),
 * then captures each path in light and dark (unless --theme picks one) at deviceScaleFactor 1.
 * Files: <out>/<name>-<theme>.png where name comes from the path ("/jobs/new" → "jobs-new").
 * Options: --full (full-page), --wait <ms> extra settle time, --prefix <text>, --click <selector>
 * (clicked before the capture, e.g. to open a menu).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function loadPlaywright() {
  const candidates = ['playwright', '@playwright/test', '/opt/node-tools/node_modules/playwright'];
  for (const name of candidates) {
    try {
      return require(name);
    } catch {
      // try next
    }
  }
  throw new Error('Playwright is not installed. Run `pnpm install` at the repo root.');
}

function parseArgs(argv) {
  const options = {
    base: process.env.SHOT_BASE_URL ?? 'http://localhost:3500',
    out: '/tmp/claude-0/shots',
    user: 'admin@kitstak.io',
    password: 'KitStak-Demo-2026!',
    themes: ['light', 'dark'],
    width: 1440,
    height: 900,
    full: false,
    wait: 600,
    prefix: '',
    click: null,
    paths: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '--base': options.base = next(); break;
      case '--out': options.out = next(); break;
      case '--user': options.user = next(); break;
      case '--password': options.password = next(); break;
      case '--theme': options.themes = [next()]; break;
      case '--width': options.width = Number(next()); break;
      case '--height': options.height = Number(next()); break;
      case '--full': options.full = true; break;
      case '--wait': options.wait = Number(next()); break;
      case '--prefix': options.prefix = next(); break;
      case '--click': options.click = next(); break;
      default: options.paths.push(arg);
    }
  }
  if (options.paths.length === 0) options.paths = ['/'];
  options.base = options.base.replace(/\/+$/, '');
  return options;
}

function fileName(prefix, route, theme) {
  const slug = route.replace(/^\/+/, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'home';
  return `${prefix ? `${prefix}-` : ''}${slug}-${theme}.png`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { chromium } = loadPlaywright();
  fs.mkdirSync(options.out, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const theme of options.themes) {
      const context = await browser.newContext({
        viewport: { width: options.width, height: options.height },
        deviceScaleFactor: 1,
        colorScheme: theme === 'dark' ? 'dark' : 'light',
      });
      const signIn = await context.request.post(`${options.base}/api/auth/sign-in/email`, {
        data: { email: options.user, password: options.password, rememberMe: true },
        headers: { origin: options.base, 'content-type': 'application/json' },
      });
      if (!signIn.ok()) throw new Error(`Sign-in failed (${signIn.status()}): ${await signIn.text()}`);
      const host = new URL(options.base).hostname;
      await context.addCookies([{ name: 'kitstak-theme', value: theme, domain: host, path: '/' }]);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      for (const route of options.paths) {
        const url = `${options.base}${route.startsWith('/') ? route : `/${route}`}`;
        const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 90_000 });
        await page.waitForTimeout(options.wait);
        if (options.click) {
          await page.click(options.click, { timeout: 10_000 });
          await page.waitForTimeout(400);
        }
        const file = path.join(options.out, fileName(options.prefix, route, theme));
        await page.screenshot({ path: file, fullPage: options.full });
        process.stdout.write(`${response?.status() ?? '???'} ${route} → ${file}\n`);
      }
      if (errors.length) process.stdout.write(`page errors (${theme}):\n  ${errors.join('\n  ')}\n`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
