#!/usr/bin/env node
/**
 * Screenshot helper for the signup and billing work. Signs in for real, then captures each
 * path in light and dark, at desktop and phone widths.
 *
 *   node deploy/dev/shot.mjs /billing
 *   node deploy/dev/shot.mjs --app crm /northwind-robotics
 *   node deploy/dev/shot.mjs --anon /signup /login
 *   node deploy/dev/shot.mjs --theme dark --size phone --full /billing
 *   node deploy/dev/shot.mjs --user admin@kitstak.io --password 'KitStak!demo2026' /
 *
 * Options
 *   --app <name>       portal (default), crm, wms, projects, pulse, web. Picks the port.
 *   --base <url>       use this origin instead of --app
 *   --user / --password  who signs in (default: Maya, owner of Northwind Robotics)
 *   --anon             do not sign in (public pages such as /signup)
 *   --theme <light|dark>   only one theme (default: both)
 *   --size <desktop|phone|tablet|WIDTHxHEIGHT>  repeatable (default: desktop and phone)
 *   --full             capture the whole page, not just the first screen
 *   --out <dir>        where files go (default: deploy/dev/.run/shots)
 *   --prefix <text>    put this in front of every file name
 *   --click <selector> click this before the capture (open a menu, a dialog)
 *   --wait <ms>        extra settle time after load (default 600)
 *   --reduced-motion   emulate prefers-reduced-motion: reduce
 *
 * Files are named <prefix->-<path>-<size>-<theme>.png. The script prints the HTTP status of
 * every page plus any browser console errors, and exits 1 when a page answers 500 or above.
 *
 * Sign in goes through POST /api/auth/sign-in/email on the same origin, so the cookie is the
 * real Better Auth session. It is saved in deploy/dev/.run/sessions and reused, because sign
 * in is rate limited. The theme is the `kitstak-theme` cookie that every app reads.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));

const PORTS = { portal: 3300, crm: 3100, wms: 3000, projects: 3400, pulse: 3500, web: 3600 };
const SIZES = {
  desktop: { width: 1440, height: 900, mobile: false },
  tablet: { width: 820, height: 1180, mobile: true },
  phone: { width: 390, height: 844, mobile: true },
};

function loadPlaywright() {
  for (const name of ['playwright', '@playwright/test', '/opt/node-tools/node_modules/playwright']) {
    try {
      return require(name);
    } catch {
      // try the next place
    }
  }
  throw new Error('Playwright was not found. It is preinstalled globally in the dev container.');
}

function parseSize(value) {
  if (SIZES[value]) return { name: value, ...SIZES[value] };
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match) throw new Error(`Unknown --size "${value}". Use desktop, phone, tablet or WIDTHxHEIGHT.`);
  const width = Number(match[1]);
  return { name: value, width, height: Number(match[2]), mobile: width < 700 };
}

function parseArgs(argv) {
  const options = {
    app: 'portal',
    base: null,
    out: path.join(HERE, '.run', 'shots'),
    user: 'maya@northwind-robotics.example',
    password: 'Northwind-Demo-2026!',
    anon: false,
    themes: ['light', 'dark'],
    sizes: [],
    full: false,
    wait: 600,
    prefix: '',
    click: null,
    reducedMotion: false,
    paths: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (argv[i] === undefined) throw new Error(`${arg} needs a value.`);
      return argv[i];
    };
    switch (arg) {
      case '--app': options.app = next(); break;
      case '--base': options.base = next(); break;
      case '--out': options.out = path.resolve(next()); break;
      case '--user': options.user = next(); break;
      case '--password': options.password = next(); break;
      case '--anon': options.anon = true; break;
      case '--theme': options.themes = [next()]; break;
      case '--size': options.sizes.push(parseSize(next())); break;
      case '--full': options.full = true; break;
      case '--wait': options.wait = Number(next()); break;
      case '--prefix': options.prefix = next(); break;
      case '--click': options.click = next(); break;
      case '--reduced-motion': options.reducedMotion = true; break;
      case '--help': case '-h':
        process.stdout.write(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*\n?/, '').replace(/^ \* ?/gm, ''));
        process.exit(0);
        break;
      default:
        if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}. Try --help.`);
        options.paths.push(arg);
    }
  }
  if (!options.base) {
    if (!PORTS[options.app]) throw new Error(`Unknown --app "${options.app}". Use one of: ${Object.keys(PORTS).join(', ')}.`);
    options.base = `http://localhost:${PORTS[options.app]}`;
  }
  options.base = options.base.replace(/\/+$/, '');
  if (options.sizes.length === 0) options.sizes = [parseSize('desktop'), parseSize('phone')];
  if (options.paths.length === 0) options.paths = ['/'];
  if (options.app === 'web') options.anon = true;
  return options;
}

function fileName(options, route, size, theme) {
  const slug = route.replace(/[?#].*$/, '').replace(/^\/+/, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'home';
  return `${options.prefix ? `${options.prefix}-` : ''}${slug}-${size.name}-${theme}.png`;
}

/**
 * Sign in once per user and origin, then reuse the saved cookies on later contexts and runs.
 * Sign in is limited to 10 tries a minute per address (packages/auth), so signing in for
 * every capture would trip the limit after a few runs.
 */
async function signIn(context, options) {
  const dir = path.join(HERE, '.run', 'sessions');
  const key = `${new URL(options.base).host}-${options.user}`.replace(/[^A-Za-z0-9.@-]+/g, '_');
  const file = path.join(dir, `${key}.json`);
  if (fs.existsSync(file)) {
    try {
      await context.addCookies(JSON.parse(fs.readFileSync(file, 'utf8')));
      const check = await context.request.get(`${options.base}/api/auth/get-session`);
      const body = check.ok() ? await check.json().catch(() => null) : null;
      if (body?.user?.email === options.user) return;
    } catch {
      // fall through to a fresh sign in
    }
    await context.clearCookies();
  }
  const response = await context.request.post(`${options.base}/api/auth/sign-in/email`, {
    data: { email: options.user, password: options.password, rememberMe: true },
    headers: { origin: options.base, 'content-type': 'application/json' },
  });
  if (!response.ok()) {
    const hint = response.status() === 429 ? ' Too many sign in tries. Wait a minute or run deploy/dev/rate-limit-reset.sh.' : '';
    throw new Error(`Sign in failed for ${options.user} (${response.status()}): ${await response.text()}${hint}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(await context.cookies()), { mode: 0o600 });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { chromium } = loadPlaywright();
  fs.mkdirSync(options.out, { recursive: true });
  const browser = await chromium.launch();
  let failed = false;
  try {
    for (const size of options.sizes) {
      for (const theme of options.themes) {
        const context = await browser.newContext({
          viewport: { width: size.width, height: size.height },
          deviceScaleFactor: 1,
          isMobile: size.mobile,
          hasTouch: size.mobile,
          colorScheme: theme === 'dark' ? 'dark' : 'light',
          reducedMotion: options.reducedMotion ? 'reduce' : 'no-preference',
        });
        if (!options.anon) await signIn(context, options);
        await context.addCookies([{ name: 'kitstak-theme', value: theme, domain: new URL(options.base).hostname, path: '/' }]);
        const page = await context.newPage();
        const problems = [];
        page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
        page.on('console', (message) => {
          if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
        });
        for (const route of options.paths) {
          const url = `${options.base}${route.startsWith('/') ? route : `/${route}`}`;
          const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 120_000 });
          // Hide the Next.js dev badge so it never covers the page in a capture.
          await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
          await page.waitForTimeout(options.wait);
          if (options.click) {
            await page.click(options.click, { timeout: 10_000 });
            await page.waitForTimeout(400);
          }
          const file = path.join(options.out, fileName(options, route, size, theme));
          await page.screenshot({ path: file, fullPage: options.full });
          const status = response?.status() ?? 0;
          if (status >= 500 || status === 0) failed = true;
          const landed = new URL(page.url()).pathname;
          const moved = landed === new URL(url).pathname ? '' : `  (ended on ${landed})`;
          process.stdout.write(`${status || '???'} ${route} ${size.name} ${theme}${moved}\n    ${file}\n`);
        }
        if (problems.length) process.stdout.write(`  browser problems (${size.name}, ${theme}):\n    ${[...new Set(problems)].join('\n    ')}\n`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  if (failed) process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
