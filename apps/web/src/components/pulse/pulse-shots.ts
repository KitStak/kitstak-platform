/**
 * Real product screenshots for the Pulse page.
 *
 * Every slot below is a real screen from the running Pulse app with its demo data. Nothing is drawn or
 * retouched. A screenshot may be cropped, scaled and compressed, and that is all.
 *
 * What exists today: each slot was taken in the light and the dark theme, at up to three window sizes
 * (desktop 1440 by 900, tablet 1024 by 720, phone 390 by 720, all at a device pixel ratio of 2). The
 * page picks the size by the width of the visitor's screen and the theme by the visitor's system
 * setting. The web images live in apps/web/public/pulse/shots as
 * <name>-<view>-<theme>-<width>.avif, with one .webp per view for browsers without AVIF.
 *
 * How to retake them (all slots together, so every number on the page comes from one data set):
 *  1. Run the Pulse app (apps/pulse on the Pulse branch) against a database seeded with the "kitstak"
 *     demo workspace, and sign in as a person who can see money. Open Settings, Connected apps once
 *     and let the first sync finish, because a sync can change a few numbers.
 *  2. Upload a Production CSV with one bad cell under Import, match the columns and stop on step 3,
 *     Check. Copy the id from the address bar (/import/<id>).
 *  3. From apps/web run `node scripts/capture-pulse-shots.mjs <rawDir> <id>`. It needs Playwright. It
 *     opens each `route`, hides the dev badge and the text cursor, and saves PNG files to <rawDir>.
 *  4. Run `node scripts/prepare-pulse-shots.mjs <rawDir>`. It crops, scales and compresses the PNG
 *     files into public/pulse/shots.
 *  5. Look at every picture. Then check the `alt` text here and the page copy against what the
 *     screens now show. The demo data is built from today's date, so the numbers move.
 *
 * A slot with `ready: false` shows the coded illustration from pulse-visuals.tsx in its place. The
 * worked job, the "How we got this" panel and the home page card have no screenshot: they stay coded.
 */

export const PULSE_SHOT_IDS = ['hero', 'profit', 'log', 'plan', 'rates', 'risk', 'csv', 'stack'] as const;

export type PulseShotId = (typeof PULSE_SHOT_IDS)[number];

export const PULSE_SHOT_THEMES = ['light', 'dark'] as const;

export type PulseShotTheme = (typeof PULSE_SHOT_THEMES)[number];

/** One capture of a slot at one window size. */
export interface PulseShotView {
  readonly view: 'desktop' | 'tablet' | 'phone';
  /** Size of the picture in CSS pixels, after any crop. */
  readonly width: number;
  readonly height: number;
  /** Widths of the files on disk, smallest first. The smallest also exists as WebP. */
  readonly widths: readonly number[];
  /** The widest screen this view is shown on, in CSS pixels. The desktop view has none. */
  readonly upTo?: number;
}

export interface PulseShotSlot {
  /** The route in the Pulse app the screenshot is taken from. */
  readonly route: string;
  /** What is on screen when the shot is taken. */
  readonly capture: string;
  /** Text alternative. It describes what the real screen shows. */
  readonly alt: string;
  /** Short name of the screen, shown in the caption under the picture. */
  readonly label: string;
  /** File name stem under /pulse/shots/. */
  readonly name: string;
  /** Narrowest screens first. The last view is the desktop one. */
  readonly views: readonly PulseShotView[];
  /** The `sizes` hint: how wide the picture is drawn at each screen width. */
  readonly sizes: string;
  /** The widest the picture is drawn, in CSS pixels, when that is less than its column. */
  readonly maxWidth?: number;
  /** The hero image is above the fold, so it loads first. Every other slot loads lazily. */
  readonly priority?: true;
  /** True once the real files are in place and have been looked at. */
  readonly ready: boolean;
}

/** Pictures that span the page: the full 1200 pixel column on a wide screen. */
const WIDE_SIZES = '(min-width: 1280px) 1200px, 92vw';

const PHONE: PulseShotView = { view: 'phone', width: 390, height: 720, widths: [780], upTo: 640 };
const TABLET: PulseShotView = {
  view: 'tablet',
  width: 1024,
  height: 720,
  widths: [1024, 1536, 2048],
  upTo: 1100,
};
const DESKTOP: PulseShotView = { view: 'desktop', width: 1440, height: 900, widths: [1200, 1800, 2400] };

const FULL_WINDOW: readonly PulseShotView[] = [PHONE, TABLET, DESKTOP];

export const PULSE_SHOTS: Readonly<Record<PulseShotId, PulseShotSlot>> = {
  hero: {
    route: '/',
    capture: 'Home for this month, at the top of the page.',
    alt: 'KitStak Pulse Home. It greets the signed in person and says in words what the jobs made this month, the margin, what the company made after time not on a job and overhead, and that 7 jobs need you. Six tiles show revenue, cost, profit on jobs, margin after all costs, labor as a percent of revenue and units per person per hour. Below, Jobs that need you lists the worst jobs first, each with the reason and a Losing money status.',
    label: 'Home',
    name: 'home',
    views: FULL_WINDOW,
    sizes: WIDE_SIZES,
    priority: true,
    ready: true,
  },
  profit: {
    route: '/profit',
    capture: 'Profit on the Jobs tab for this month, Table view.',
    alt: 'The Profit page in KitStak Pulse on the Jobs tab. Tabs across the top switch between jobs, clients, job types, extra services, sites, months, weeks and days. Six tiles show revenue, cost, profit, margin after all costs with its target, margin before shared costs and units per person per hour. A table lists each job with its status, revenue, labor, material, other cost, time not on a job, profit, margin, units and hours, sorted by profit.',
    label: 'Profit by job',
    name: 'profit',
    views: FULL_WINDOW,
    sizes: WIDE_SIZES,
    ready: true,
  },
  log: {
    route: '/log',
    capture: 'Log work on the Day tab for today at the main site.',
    alt: 'Log work in KitStak Pulse for one day at one site. Each job is a row with boxes for good units, scrap, rework, the crew, people, hours each, labor hours and overtime. Some jobs have a second crew line for a line lead. Beside each filled row a chip compares the pace with the target, such as 47.5 of 44 an hour, On pace, or 26.9 of 46 an hour, Too slow, with the labor cost and margin for the day.',
    label: 'Log work',
    name: 'log',
    views: FULL_WINDOW,
    sizes: WIDE_SIZES,
    ready: true,
  },
  plan: {
    route: '/jobs/[ref]/plan',
    capture: 'Plan vs actual for a job that is losing money, scrolled to Why profit changed.',
    alt: 'Plan vs actual for one job in KitStak Pulse. The end of the Quote vs actual table compares cost, revenue, profit and margin for the work done with what happened. Under it, a Why profit changed chart steps from the plan to the actual profit with bars for price, labor rate, labor efficiency, scrap, material, time not on a job and other. Cards beside it name the gap, the biggest drag and the biggest lift in a sentence each.',
    label: 'Plan vs actual',
    name: 'why',
    views: FULL_WINDOW,
    sizes: WIDE_SIZES,
    ready: true,
  },
  rates: {
    route: '/labor',
    capture: 'Labor, Rates tab, with "Change the rate" open on the Packer labor class.',
    alt: 'The New rate for Packer dialog in KitStak Pulse. On the left are boxes for the wage for an hour, payroll taxes and workers comp, benefits and paid time off, other, and overhead for each hour. On the right a read-out says one hour of a packer really costs $26.25, split into wage $17.15, taxes, benefits and other $3.60, and overhead $5.50, and gives the cost of an overtime hour.',
    label: 'Labor rates',
    name: 'rates',
    views: [PHONE, { view: 'desktop', width: 760, height: 876, widths: [760, 1520] }],
    sizes: '(min-width: 1280px) 600px, (min-width: 961px) 50vw, 92vw',
    maxWidth: 600,
    ready: true,
  },
  risk: {
    route: '/jobs',
    capture: 'Jobs on the Open tab, sorted worst first.',
    alt: 'The Jobs list in KitStak Pulse on the Open tab, worst first. Chips count the open jobs by status: Losing money, At risk, Not enough data, Heads up and On track. Each row has the job, the client, a status with the reason in a sentence, units done, margin now against the target, profit at finish, a trend line and the due date. The first three jobs are losing money.',
    label: 'Jobs',
    name: 'jobs',
    views: FULL_WINDOW,
    sizes: WIDE_SIZES,
    ready: true,
  },
  csv: {
    route: '/import/[id]',
    capture: 'A Production file on step 3, Check, with one bad cell.',
    alt: 'Step 3, Check, of a production import in KitStak Pulse. Counters show 8 new rows, 2 changed, 7 with no change and 1 problem out of 18. The row with the problem is listed with the bad cell marked and the words: 9x is not a number of hours. Use 7.5 or 7:30. Buttons offer to fix the row, leave it out, save nothing or skip bad rows.',
    label: 'Import, step 3',
    name: 'import',
    views: [PHONE, TABLET, { ...DESKTOP, height: 760 }],
    sizes: WIDE_SIZES,
    ready: true,
  },
  stack: {
    route: '/settings/apps',
    capture: 'Settings, Connected apps, after the first sync.',
    alt: 'Connected apps in KitStak Pulse settings. KitStak CRM and KitStak WMS each show as Connected with the time of the last sync and a Sync now button. For each app one column lists what comes into Pulse, with switches, and another lists what shows up in that app, such as a Profit tab on deals and accounts in CRM and a Job profit card on work orders in WMS.',
    label: 'Connected apps',
    name: 'connected-apps',
    views: [PHONE, { view: 'desktop', width: 872, height: 844, widths: [872, 1744] }],
    sizes: '(min-width: 1280px) 552px, (min-width: 961px) 44vw, 92vw',
    ready: true,
  },
};

/** Site path of one screenshot file. */
export function shotFile(
  slot: PulseShotSlot,
  view: PulseShotView,
  theme: PulseShotTheme,
  width: number,
  format: 'avif' | 'webp',
): string {
  return `/pulse/shots/${slot.name}-${view.view}-${theme}-${width}.${format}`;
}
