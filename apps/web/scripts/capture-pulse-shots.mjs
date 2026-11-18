// Takes the raw Pulse screenshots for the /pulse page from a running Pulse app with demo data.
//
//   node scripts/capture-pulse-shots.mjs <rawDir> <importBatchId> [slot ...]
//
// The Pulse app must answer at PULSE_URL (default http://localhost:3507) with the seeded "kitstak"
// demo workspace. Playwright is not a dependency of this package: run this where the `playwright`
// module can be found (for example with NODE_PATH pointing at a global install).
// <importBatchId> is a Production file already uploaded and matched, waiting on step 3, Check.
// Every slot is taken in the light and the dark theme at up to three window sizes, at a device pixel
// ratio of 2 (3 for the small "How we got this" panel). Nothing is retouched. `prepare-pulse-shots.mjs` then turns the PNG files into the
// web images under public/pulse/shots.
//
// A picture never ends in the middle of a line of text. A view with a `clip` opens a tall window and
// saves it only down to the edge of a table row or a card, so the height of that picture comes from
// the screen itself. `prepare-pulse-shots.mjs` prints the sizes: copy them into pulse-shots.ts.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.PULSE_URL ?? 'http://localhost:3507';
const EMAIL = process.env.PULSE_EMAIL ?? 'admin@kitstak.io';
const PASSWORD = process.env.PULSE_PASSWORD ?? 'KitStak-Demo-2026!';
const JOB = process.env.PULSE_JOB ?? 'J-1012';
/**
 * The demo data is built around the day it was seeded, and the screens call that day "today". To
 * retake a slot after that day has ended, run the Pulse app with its clock set back and give the same
 * shift here, in minutes, for the clock in the browser. It changes no data and no screen.
 */
const CLOCK_SHIFT_MS = Number(process.env.PULSE_CLOCK_SHIFT_MINUTES ?? 0) * 60_000;
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

/** Every view any slot is taken in. `close` is a part of one screen, cut out for a narrow column. */
const VIEW_NAMES = [...Object.keys(VIEWS), 'close'];

/** Scrolls the page's own scroll area until the heading with this text sits near the top. */
async function scrollToHeading(page, text) {
  await page.evaluate((wanted) => {
    const heading = [...document.querySelectorAll('h1,h2,h3,h4,p,dt,div,span')].find(
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

/** Scrolls the page's own scroll area until this element sits just under the app's top bar. */
async function scrollUnderTopBar(page, locator, gap = 16) {
  await locator.evaluate((el, space) => {
    let scroller = el.parentElement;
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
    const bar = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
    scroller.scrollBy(0, el.getBoundingClientRect().top - bar - space);
  }, gap);
  await page.waitForTimeout(700);
}

/** A clip from the top of the window down to `bottom`, in CSS pixels. */
function downTo(page, bottom) {
  const { width, height } = page.viewportSize();
  if (bottom > height) throw new Error(`The clip ends at ${bottom}, below the ${height} pixel window`);
  return { x: 0, y: 0, width, height: Math.round(bottom) };
}

/** Clips the window under the bottom edge of an element, with `pad` pixels of page after it. */
function downToBottomOf(find, pad = 0) {
  return async (page) => {
    const box = await find(page).boundingBox();
    return downTo(page, box.y + box.height + pad);
  };
}

/**
 * Clips the window under the last row that fits whole in the first `limit` pixels. `selector` names
 * the rows: table rows on a wide screen, cards on a phone.
 */
function downToLastRow(selector, limit, pad = 0) {
  return async (page) => {
    await page.locator(selector).first().waitFor();
    const bottoms = await page
      .locator(selector)
      .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect()).map((box) => box.bottom));
    const fitting = bottoms.filter((bottom) => bottom > 0 && bottom + pad <= limit);
    if (fitting.length === 0) throw new Error(`No "${selector}" row ends above ${limit}`);
    return downTo(page, Math.max(...fitting) + pad);
  };
}

/** The open jobs as rows: table rows on a wide screen, cards on a phone. */
const JOB_ROWS = 'main tbody tr';
const JOB_CARDS = 'main li:has-text("Margin now")';
/** The jobs in "Jobs that need you" on Home. */
const NEED_YOU_ROWS = 'main section:has-text("Jobs that need you") li';

const SLOTS = [
  {
    name: 'home',
    route: '/',
    // At 390 pixels wide the change chip on the Cost tile runs past its tile. A 430 pixel phone fits
    // it. The picture ends under the first job in "Jobs that need you", so the list is not cut off
    // at its heading. The desktop picture ends under the fourth job. The Alerts card beside the list
    // ends on a whole alert there too, so neither column is cut through a line of text.
    views: {
      desktop: { height: 1100, clip: downToLastRow(NEED_YOU_ROWS, 1000) },
      phone: {
        width: 430,
        height: 1300,
        clip: downToBottomOf((page) =>
          page.locator('section', { hasText: 'Jobs that need you' }).locator('li').first(),
        ),
      },
    },
  },
  {
    name: 'profit',
    route: '/profit',
    // Each picture ends under a whole row of the list. The tablet and phone windows are tall: tabs,
    // filters and tiles come first, and the first jobs must show.
    views: {
      desktop: { height: 1000, clip: downToLastRow('main tbody tr', 900) },
      tablet: null, // a tablet shows the phone capture: the tablet window cuts the table through a column
      phone: { height: 1500, clip: downToLastRow('main li:has-text("Revenue")', 1230) },
    },
    // On a desktop the usual columns run past the window and cut the last one in half. The app's own
    // Columns button hides Units per hour, so the table ends on a whole column. The tile above the
    // table still shows units per person per hour. The choice is put back after the picture.
    prepare: async (page, viewName) => {
      if (viewName === 'desktop') await toggleProfitColumn(page, 'Units per hour');
    },
    after: async (page, viewName) => {
      if (viewName === 'desktop') await toggleProfitColumn(page, 'Units per hour');
    },
  },
  {
    name: 'jobs',
    route: '/jobs',
    // Scrolled so the status chips sit under the top bar and the list starts high in the picture.
    // Each picture ends under a whole job.
    views: {
      desktop: { clip: downToLastRow(JOB_ROWS, 760) },
      tablet: null, // a tablet shows the phone capture: the tablet window cuts the table through a column
      phone: { clip: downToLastRow(JOB_CARDS, 712, 8) },
      // The left part of the table alone, for a narrow column: job, client, status with its reason,
      // and units done. It ends at the right edge of the Units done column.
      close: {
        width: 1440,
        height: 900,
        clip: async (page) => {
          const head = await page.locator('main thead tr').boundingBox();
          const units = await page.locator('main thead th', { hasText: 'Units done' }).boundingBox();
          const rows = await downToLastRow(JOB_ROWS, 760)(page);
          return {
            x: Math.ceil(head.x),
            y: Math.ceil(head.y),
            width: Math.floor(units.x + units.width - head.x),
            height: rows.height - Math.ceil(head.y),
          };
        },
      },
    },
    prepare: (page) => scrollUnderTopBar(page, page.getByText('Losing money', { exact: true }).first()),
  },
  {
    name: 'log',
    route: '/log',
    // The phone picture ends under the first crew line of the first job: its boxes, its pace chip and
    // its labor cost and margin for the day.
    views: {
      phone: {
        height: 1100,
        clip: async (page) => {
          const top = await page
            .getByText('Crew line 2')
            .first()
            .evaluate((el) => {
              let block = el;
              while (block && parseFloat(getComputedStyle(block).borderTopWidth) === 0) {
                block = block.parentElement;
              }
              return (block ?? el).getBoundingClientRect().top;
            });
          return downTo(page, top);
        },
      },
    },
  },
  {
    name: 'why',
    route: `/jobs/${JOB}/plan`,
    // A wide window is tall enough for the whole page in one picture: the job, the Quote vs actual
    // table with its column headings, and Why profit changed. On a phone the page is about three
    // screens long. The phone picture leaves out the job header and starts at the Quote vs actual
    // card, with every row, so the quote and the actual are both in it. It ends under the three
    // cards that follow the Why profit changed chart.
    views: {
      desktop: { height: 1500, clip: downToBottomOf(whyCard, 20) },
      tablet: { height: 1500, clip: downToBottomOf(whyCard, 20) },
      phone: {
        height: 2600,
        clip: async (page) => {
          const quote = await page
            .locator('main section', { hasText: 'Quote vs actual' })
            .last()
            .boundingBox();
          // The Biggest lift card is the nearest box with a border around its label.
          const liftBottom = await page.getByText('Biggest lift', { exact: true }).evaluate((el) => {
            let card = el;
            while (card && parseFloat(getComputedStyle(card).borderTopWidth) === 0) {
              card = card.parentElement;
            }
            return (card ?? el).getBoundingClientRect().bottom;
          });
          const top = Math.round(quote.y - 16);
          const { width } = page.viewportSize();
          return { x: 0, y: top, width, height: Math.round(liftBottom + 14) - top };
        },
      },
    },
    // The At finish figures load after the page. Wait for them, so no row says it is still loading.
    prepare: async (page) => {
      await page.getByText('Loading the projection').waitFor({ state: 'detached' });
      await page.waitForTimeout(700);
    },
  },
  {
    // "How we got this" for company profit: the panel behind the info button on the Profit page.
    // The picture is the panel alone. It is small, so it is taken at three device pixels to one.
    name: 'how',
    route: '/profit',
    // The window is tall, so the whole panel fits under its button.
    views: { desktop: { height: 1200, element: 'dialog', scale: 3 }, tablet: null, phone: null },
    prepare: async (page) => {
      await page.getByRole('button', { name: 'How we got company profit' }).click();
      await page.getByRole('dialog').waitFor();
      await page.waitForTimeout(700);
    },
  },
  {
    name: 'rates',
    route: '/labor',
    // On a wide screen the shot is the rate builder, a dialog, alone, in a window tall enough to show
    // its buttons. On a phone the dialog is one long column of boxes, so the phone picture is the
    // Rates tab behind it: the card of the Packer labor class, with what one hour really costs, and
    // the rate history under it.
    views: {
      desktop: { width: 1440, height: 1040, element: 'dialog' },
      tablet: null,
      phone: {
        // A short window, so the page can scroll the Packer card up under the top bar.
        height: 724,
        clip: downToBottomOf((page) => page.locator('section', { hasText: 'Rate history' }).last(), 16),
      },
    },
    prepare: async (page, viewName) => {
      const change = page.getByRole('button', { name: 'Change the rate' });
      if (viewName === 'phone') {
        await scrollUnderTopBar(page, change, 28);
        return;
      }
      await change.click();
      await page.getByRole('dialog').waitFor();
      await page.waitForTimeout(700);
      await page.evaluate(() => document.activeElement?.blur());
    },
  },
  {
    name: 'import',
    route: `/import/${batchId}`,
    // The phone window is tall: it starts at the six counters and reaches the row with the problem.
    views: { phone: { height: 1080 } },
    // On a tablet the bad cell starts off screen. Scroll it into view.
    prepare: async (page, viewName) => {
      if (viewName !== 'tablet') return;
      await page
        .locator('text=/is not a number of hours/ >> visible=true')
        .first()
        .evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
      await page.waitForTimeout(700);
    },
  },
  // Scrolled to the WMS card, which has linked jobs to show. Projects follows it on a wide screen.
  {
    name: 'connected-apps',
    route: '/settings/apps',
    views: { tablet: null },
    prepare: (page) => scrollToHeading(page, 'KitStak WMS'),
  },
];

/** Ticks or unticks one column of the Profit table with the app's own Columns button. */
async function toggleProfitColumn(page, name) {
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByText(name, { exact: true }).last().click();
  await page.keyboard.press('Escape');
  // The menu hands the focus back to its button a moment after it closes, and the button then shows
  // a focus ring. Wait for that, then take the focus off it.
  await page.waitForTimeout(600);
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(700);
}

/** The Why profit changed card on the plan page. */
function whyCard(page) {
  return page.locator('section', { hasText: 'Why profit changed' }).last();
}

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
    deviceScaleFactor: view.scale ?? 2,
    colorScheme: theme,
    reducedMotion: 'reduce',
    isMobile: Boolean(view.isMobile),
    hasTouch: Boolean(view.isMobile),
  });
  if (CLOCK_SHIFT_MS !== 0) {
    await context.addInitScript((shift) => {
      const Real = Date;
      globalThis.Date = new Proxy(Real, {
        construct: (target, args) =>
          args.length > 0 ? new target(...args) : new target(target.now() + shift),
        apply: (target) => new target(target.now() + shift).toString(),
        get: (target, key) => (key === 'now' ? () => target.now() + shift : Reflect.get(target, key)),
      });
    }, CLOCK_SHIFT_MS);
  }
  await context.addCookies([
    { name: 'kitstak-theme', value: theme, domain: new URL(BASE).hostname, path: '/' },
  ]);
  return context;
}

/**
 * Waits for the screen to settle and hides the Next.js dev badge and the text cursor. A screen is not
 * settled while a loading placeholder is still on it.
 */
async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"], .ks-skeleton'));
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
  for (const viewName of VIEW_NAMES) {
    for (const slot of SLOTS) {
      if (only.length > 0 && !only.includes(slot.name)) continue;
      // A view outside the three window sizes is taken only for the slots that name it.
      if (slot.views?.[viewName] === null || !(VIEWS[viewName] ?? slot.views?.[viewName])) continue;
      const view = { ...VIEWS[viewName], ...slot.views?.[viewName] };
      const context = await openContext(browser, session, theme, view);
      const page = await context.newPage();
      await page.goto(BASE + slot.route, { waitUntil: 'networkidle', timeout: 180_000 });
      await settle(page);
      if (slot.prepare) await slot.prepare(page, viewName);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(400);
      const file = path.join(rawDir, `${slot.name}-${viewName}-${theme}.png`);
      if (view.element) await page.getByRole(view.element).screenshot({ path: file });
      else if (view.clip) await page.screenshot({ path: file, clip: await view.clip(page) });
      else await page.screenshot({ path: file });
      console.log(file);
      if (slot.after) await slot.after(page, viewName);
      await context.close();
    }
  }
}
await browser.close();
