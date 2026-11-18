// Takes the raw Pulse screenshots for the /pulse page from a running Pulse app with demo data.
//
//   node scripts/capture-pulse-shots.mjs <rawDir> <importBatchId> [slot ...]
//
// The Pulse app must answer at PULSE_URL (default http://localhost:3507) with the seeded "kitstak"
// demo workspace. Playwright is not a dependency of this package: run this where the `playwright`
// module can be found (for example with NODE_PATH pointing at a global install).
// <importBatchId> is a Production file already uploaded and matched, waiting on step 3, Check.
// Every slot is taken in the light and the dark theme at three window sizes, at a device pixel
// ratio of 2. Nothing is retouched. `prepare-pulse-shots.mjs` then turns the PNG files into the
// web images under public/pulse/shots.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.PULSE_URL ?? 'http://localhost:3507';
const EMAIL = process.env.PULSE_EMAIL ?? 'admin@kitstak.io';
const PASSWORD = process.env.PULSE_PASSWORD ?? 'KitStak-Demo-2026!';
const JOB = process.env.PULSE_JOB ?? 'J-1012';
const [rawDir, batchId, ...only] = process.argv.slice(2);
if (!rawDir || !batchId) {
  console.error('usage: node scripts/capture-pulse-shots.mjs <rawDir> <importBatchId> [slot ...]');
  process.exit(1);
}

/** Window sizes in CSS pixels. The site picks one by the width of the visitor's screen. */
const VIEWS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 1024, height: 720 },
  phone: { width: 390, height: 720, isMobile: true },
};

/** Scrolls the page's own scroll area until the heading with this text sits near the top. */
async function scrollToHeading(page, text) {
  await page.evaluate((wanted) => {
    const heading = [...document.querySelectorAll('h1,h2,h3,h4,div,span')].find(
      (el) => el.childElementCount === 0 && el.textContent.trim() === wanted,
    );
    if (!heading) throw new Error(`No heading "${wanted}" on this screen`);
    let scroller = heading.parentElement;
    while (
      scroller &&
      !(
        scroller.scrollHeight > scroller.clientHeight + 4 &&
        /auto|scroll/.test(getComputedStyle(scroller).overflowY)
      )
    ) {
      scroller = scroller.parentElement;
    }
    scroller ??= document.scrollingElement;
    const gap = heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollBy(0, gap - 28);
  }, text);
  await page.waitForTimeout(700);
}

const SLOTS = [
  { name: 'home', route: '/' },
  { name: 'profit', route: '/profit' },
  { name: 'jobs', route: '/jobs' },
  { name: 'log', route: '/log' },
  { name: 'why', route: `/jobs/${JOB}/plan`, prepare: (page) => scrollToHeading(page, 'Why profit changed') },
  {
    name: 'rates',
    route: '/labor',
    // The rate builder is a dialog. On a wide screen the shot is the dialog alone, in a window tall
    // enough to show its buttons. A phone shows the dialog as a full screen.
    views: { desktop: { width: 1440, height: 1040, element: 'dialog' }, tablet: null },
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Change the rate' }).click();
      await page.getByRole('dialog').waitFor();
      await page.waitForTimeout(700);
      await page.evaluate(() => document.activeElement?.blur());
    },
  },
  {
    name: 'import',
    route: `/import/${batchId}`,
    // On a narrow window the bad cell starts off screen. Scroll it into view.
    prepare: async (page, viewName) => {
      if (viewName === 'desktop') return;
      await page
        .locator('text=/is not a number of hours/ >> visible=true')
        .first()
        .evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
      await page.waitForTimeout(700);
    },
  },
  { name: 'connected-apps', route: '/settings/apps' },
];

/** Signs in once. Every window reuses the session, so the sign in rate limit is never reached. */
async function signIn(browser) {
  const context = await browser.newContext();
  const response = await context.request.post(`${BASE}/api/auth/sign-in/email`, {
    data: { email: EMAIL, password: PASSWORD, rememberMe: true },
    headers: { origin: BASE, 'content-type': 'application/json' },
  });
  if (!response.ok()) throw new Error(`Sign in failed: ${response.status()}`);
  const session = await context.storageState();
  await context.close();
  return session;
}

async function openContext(browser, session, theme, view) {
  const context = await browser.newContext({
    storageState: session,
    viewport: { width: view.width, height: view.height },
    deviceScaleFactor: 2,
    colorScheme: theme,
    reducedMotion: 'reduce',
    isMobile: Boolean(view.isMobile),
    hasTouch: Boolean(view.isMobile),
  });
  await context.addCookies([
    { name: 'kitstak-theme', value: theme, domain: new URL(BASE).hostname, path: '/' },
  ]);
  return context;
}

/** Waits for the screen to settle and hides the Next.js dev badge and the text cursor. */
async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.addStyleTag({
    content:
      'nextjs-portal,[data-nextjs-toast],[data-next-badge-root]{display:none!important} *{caret-color:transparent!important}',
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  await page.mouse.move(0, 0);
}

mkdirSync(rawDir, { recursive: true });
const browser = await chromium.launch();
const session = await signIn(browser);
for (const theme of ['light', 'dark']) {
  for (const [viewName, baseView] of Object.entries(VIEWS)) {
    for (const slot of SLOTS) {
      if (only.length > 0 && !only.includes(slot.name)) continue;
      if (slot.views?.[viewName] === null) continue;
      const view = { ...baseView, ...slot.views?.[viewName] };
      const context = await openContext(browser, session, theme, view);
      const page = await context.newPage();
      await page.goto(BASE + slot.route, { waitUntil: 'networkidle', timeout: 180_000 });
      await settle(page);
      if (slot.prepare) await slot.prepare(page, viewName);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(400);
      const file = path.join(rawDir, `${slot.name}-${viewName}-${theme}.png`);
      if (view.element) await page.getByRole(view.element).screenshot({ path: file });
      else await page.screenshot({ path: file });
      console.log(file);
      await context.close();
    }
  }
}
await browser.close();
