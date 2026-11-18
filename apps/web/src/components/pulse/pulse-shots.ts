/**
 * Real product screenshots for the Pulse page.
 *
 * Every slot below is a real screen from the running Pulse app with its demo data. Nothing is drawn or
 * retouched. A screenshot may be cropped, scaled and compressed, and that is all.
 *
 * What exists today: each slot was taken in the light and the dark theme, at up to three window sizes
 * (desktop 1440 wide, tablet 1024 wide, phone 390 wide, all at a device pixel ratio of 2). The page
 * picks the size by the width of the visitor's screen and the theme by the visitor's system setting.
 * A picture never ends in the middle of a line of text: the capture script ends it under a whole
 * table row or card, so pictures differ in height. Home is taken on a 430 pixel phone, because at
 * 390 the change chip on the Cost tile runs past its tile. The phone capture is used up to
 * `PHONE_UP_TO`, so a small tablet or a phone on its side does not get a wide window shrunk to
 * two thirds of its size. pulse-shot.module.css holds the phone picture to 440 pixels there.
 *
 * One picture has one `alt` text, whatever size the visitor gets. So each `alt` first says what
 * every size shows, and then names what only a wide screen adds. Check each against the phone
 * picture as well as the desktop one. The web images live in apps/web/public/pulse/shots as
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
 *     files into public/pulse/shots, and prints the size of each picture. Copy any height that
 *     changed into the views below.
 *  5. Look at every picture. Then check the `alt` text here and the page copy against what the
 *     screens now show. The demo data is built from today's date, so the numbers move.
 *
 * A slot with `ready: false` shows the coded illustration in its place. The worked job has no
 * screenshot: it is a coded example from the spec and stays coded.
 *
 * Each picture is also a link to its widest desktop file, so a visitor can open the screen at full
 * size and read the small print.
 */

export const PULSE_SHOT_IDS = [
  'hero',
  'profit',
  'proof',
  'log',
  'plan',
  'rates',
  'risk',
  'csv',
  'stack',
] as const;

export type PulseShotId = (typeof PULSE_SHOT_IDS)[number];

export const PULSE_SHOT_THEMES = ['light', 'dark'] as const;

export type PulseShotTheme = (typeof PULSE_SHOT_THEMES)[number];

/** One capture of a slot at one window size. */
export interface PulseShotView {
  /** `close` is a part of one screen, cut out at the edge of a column for a narrow space. */
  readonly view: 'desktop' | 'tablet' | 'phone' | 'close';
  /** Size of the picture in CSS pixels, after any crop. */
  readonly width: number;
  readonly height: number;
  /** Widths of the files on disk, smallest first. The smallest also exists as WebP. */
  readonly widths: readonly number[];
  /** The widest screen this view is shown on, in CSS pixels. The desktop view has none. */
  readonly upTo?: number;
}

/** A section that puts the picture beside the copy on a wide screen. */
export type PulseShotColumn = 'side-column' | 'bundle-band';

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
  /**
   * Set when `views` shows the phone capture between the width where the host section gets two
   * columns and `SIDE_COLUMN_WIDE_FROM`. The picture is then held to the phone's own width. The value
   * names the host section, because sections become two columns at different widths.
   */
  readonly phoneInColumn?: PulseShotColumn;
  /** Set when the phone capture is also shown on a tablet, up to `PHONE_ON_TABLET_UP_TO`. */
  readonly phoneOnTablet?: true;
  /** The hero image is above the fold, so it loads first. Every other slot loads lazily. */
  readonly priority?: true;
  /** True once the real files are in place and have been looked at. */
  readonly ready: boolean;
}

/** Pictures that span the page: the full 1200 pixel column on a wide screen. */
const WIDE_SIZES = '(min-width: 1280px) 1200px, 92vw';

/** The widest screen that gets the phone capture. pulse-shot.module.css uses the same number. */
export const PHONE_UP_TO = 760;

const PHONE: PulseShotView = { view: 'phone', width: 390, height: 720, widths: [780], upTo: PHONE_UP_TO };

/** A phone capture of another height, so the part the copy talks about is in the picture. */
function phoneOfHeight(height: number): PulseShotView {
  return { ...PHONE, height };
}
/**
 * Profit and Jobs are wide tables. A tablet window cuts them through a column, so a tablet gets the
 * phone capture, held to the phone's own width, and the desktop capture starts above this width.
 * pulse-shot.module.css uses the same number.
 */
export const PHONE_ON_TABLET_UP_TO = 900;

function phoneOnTablet(height: number): PulseShotView {
  return { ...PHONE, height, upTo: PHONE_ON_TABLET_UP_TO };
}
const TABLET: PulseShotView = {
  view: 'tablet',
  width: 1024,
  height: 720,
  widths: [1024, 1536, 2048],
  upTo: 1100,
};
const DESKTOP: PulseShotView = { view: 'desktop', width: 1440, height: 900, widths: [1200, 1800, 2400] };

/** The Jobs screen, scrolled so the status chips sit under the top bar. Each view ends under a job. */
const JOBS_PHONE = phoneOfHeight(671);
const JOBS_DESKTOP: PulseShotView = { ...DESKTOP, height: 749 };
/** The left part of the Jobs table alone: job, client, status with its reason, and units done. */
const JOBS_CLOSE: PulseShotView = { view: 'close', width: 929, height: 503, widths: [929, 1858] };

/**
 * The Jobs slot shown in a side column, as on the home page, where the picture gets about half the
 * page. A full window would be too small to read there, and the tablet window cuts the table through
 * a column. So the column shows the close view: the table cut at the right edge of Units done. While
 * the column is narrow it shows the phone capture. `SIDE_COLUMN_STACKS_AT` is the screen width at
 * which the host section becomes one column.
 */
export const SIDE_COLUMN_STACKS_AT = 960;
export const SIDE_COLUMN_WIDE_FROM = 1280;
export const SIDE_COLUMN_VIEWS: readonly PulseShotView[] = [
  JOBS_PHONE,
  { ...JOBS_CLOSE, upTo: SIDE_COLUMN_STACKS_AT },
  { ...JOBS_PHONE, upTo: SIDE_COLUMN_WIDE_FROM - 1 },
  JOBS_CLOSE,
];
export const SIDE_COLUMN_SIZES = `(min-width: ${SIDE_COLUMN_WIDE_FROM}px) 656px, (min-width: ${SIDE_COLUMN_STACKS_AT + 1}px) 390px, 92vw`;

/** The widest screen on which the navy bundle band of a product page is one column. */
const BUNDLE_BAND_STACKS_AT = 900;

/** The phone capture of Connected apps starts at the top edge of the KitStak WMS card. */
const APPS_PHONE = phoneOfHeight(652);

/** The Connected apps card on its own: the capture is cropped to the WMS and Projects cards. */
const APPS_DESKTOP: PulseShotView = { view: 'desktop', width: 872, height: 730, widths: [872, 1744] };

export const PULSE_SHOTS: Readonly<Record<PulseShotId, PulseShotSlot>> = {
  hero: {
    route: '/',
    capture:
      'Home for this month, at the top of the page. The desktop picture ends under the fourth job in Jobs that need you, where the Alerts card beside it also ends on a whole alert.',
    alt: 'KitStak Pulse Home. It greets the signed in person and says in words what the jobs made this month, the margin, what the company made after time not on a job and overhead, and how many jobs need you. Six tiles show revenue, cost, profit on jobs, margin after all costs, labor as a percent of revenue and units per person per hour. Below the tiles a list called Jobs that need you starts, worst first. Each job has the reason in a sentence, the projected profit and its status. A phone or a tablet shows the first job, which is losing money. A wide screen shows four jobs, three losing money and one at risk, beside the entries logged today and the first open alerts.',
    label: 'Home',
    name: 'home',
    views: [
      { view: 'phone', width: 430, height: 1057, widths: [860], upTo: PHONE_UP_TO },
      TABLET,
      { ...DESKTOP, height: 984 },
    ],
    sizes: WIDE_SIZES,
    priority: true,
    ready: true,
  },
  profit: {
    route: '/profit',
    capture:
      'Profit on the Jobs tab for this month, Table view. On the desktop picture the Units per hour column is hidden with the Columns button, so the table ends on a whole column.',
    alt: 'The Profit page in KitStak Pulse on the Jobs tab. Tabs across the top switch between jobs, clients, job types, extra services, sites, months, weeks and days. Six tiles show revenue, cost, profit, margin after all costs with its target, margin before shared costs and units per person per hour. Under them the jobs are listed by profit, each with its revenue, profit and margin. A wide screen shows the list as a table that adds the status, labor, material, other cost, time not on a job, units, hours and a profit trend line.',
    label: 'Profit by job',
    name: 'profit',
    views: [phoneOnTablet(1215), { ...DESKTOP, height: 859 }],
    sizes: WIDE_SIZES,
    phoneOnTablet: true,
    ready: true,
  },
  proof: {
    route: '/profit',
    capture:
      'Profit for this month, with the How we got this panel open on the company profit line. The picture is the panel alone.',
    alt: 'A How we got this panel in KitStak Pulse for company profit. It says in words that company profit starts from profit on jobs and takes away the costs no job carried. Then it lists each step with its figure: profit on jobs, less time not on a job that no job carried, less paid time not on any job, less overhead the hourly rate did not cover, equals company profit. Two warning lines say what is missing: some days have units and no hours, so labor cost is too low, and one job has no price, so revenue is too low. A link at the bottom says See where paid time went.',
    label: 'How we got this',
    name: 'how',
    views: [{ view: 'desktop', width: 340, height: 495, widths: [340, 680, 1020] }],
    sizes: '(min-width: 480px) 400px, 92vw',
    maxWidth: 400,
    ready: true,
  },
  log: {
    route: '/log',
    capture: 'Log work on the Day tab for today at the main site.',
    alt: 'Log work in KitStak Pulse for one day at one site. Each job has boxes for good units, scrap, rework, the crew, people, hours each, labor hours and overtime. Under a filled job a chip compares the pace with the target for an hour and says On pace or Too slow, with the labor cost and margin for the day. A wider screen also shows a second crew line for a line lead.',
    label: 'Log work',
    name: 'log',
    views: [phoneOfHeight(747), TABLET, DESKTOP],
    sizes: WIDE_SIZES,
    ready: true,
  },
  plan: {
    route: '/jobs/[ref]/plan',
    capture:
      'Plan vs actual for a job that is losing money. A wide window holds the whole page. The phone picture leaves out the job header: it starts at the Quote vs actual card and ends under the three cards that follow the Why profit changed chart.',
    alt: 'Plan vs actual for one job in KitStak Pulse. First comes Quote vs actual. Its rows run from units, labor hours and units per person per hour through each cost to revenue, profit and margin. Each row has the plan for the work done, the actual, the difference and the figure at finish. Below it a Why profit changed chart steps from the plan to the actual profit with bars for price, labor rate, labor efficiency, scrap, material, time not on a job and other. Three cards name the gap, the biggest drag and the biggest lift in a sentence each. A phone shows each row as a small card with Plan, Actual and At finish. A wide screen shows a table with the columns Quote for the work done, Actual, Difference, Difference percent and Projected at finish, under the job and its Losing money status.',
    label: 'Plan vs actual',
    name: 'why',
    views: [phoneOfHeight(1770), { ...TABLET, height: 1366 }, { ...DESKTOP, height: 1350 }],
    sizes: WIDE_SIZES,
    ready: true,
  },
  rates: {
    route: '/labor',
    capture:
      'Labor, Rates tab. On a wide screen "Change the rate" is open on the Packer labor class and the picture is the dialog. On a phone the picture is the Rates tab itself, scrolled to the Packer card.',
    alt: 'Labor rates in KitStak Pulse for the Packer labor class. A read-out says what one hour of a packer really costs, split into the wage, taxes, benefits and other, and overhead. It gives the cost of an overtime hour. A phone shows this on the Rates tab, with a Change the rate button and a rate history that lists each rate with its start date. A wide screen shows the dialog for a new rate, with boxes for the wage, payroll taxes and workers comp, benefits and paid time off, and overhead for each hour, and a line that says how many logged entries the new rate changes.',
    label: 'Labor rates',
    name: 'rates',
    views: [phoneOfHeight(722), { view: 'desktop', width: 760, height: 876, widths: [760, 1520] }],
    sizes: '(min-width: 1280px) 600px, (min-width: 961px) 50vw, 92vw',
    maxWidth: 600,
    ready: true,
  },
  risk: {
    route: '/jobs',
    capture: 'Jobs on the Open tab, sorted worst first, scrolled so the status chips sit under the top bar.',
    alt: 'The Jobs list in KitStak Pulse on the Open tab, worst first. Chips count the open jobs by status: Losing money, At risk, Not enough data, Heads up and On track. Each job has its client, a status with the reason in a sentence, units done, the margin now and the profit at finish. The jobs that are losing money come first. A wide screen shows them as a table, with the jobs at risk next. It adds the target margin, a trend line and the due date.',
    label: 'Jobs',
    name: 'jobs',
    views: [{ ...JOBS_PHONE, upTo: PHONE_ON_TABLET_UP_TO }, JOBS_DESKTOP],
    sizes: WIDE_SIZES,
    phoneOnTablet: true,
    ready: true,
  },
  csv: {
    route: '/import/[id]',
    capture: 'A Production file on step 3, Check, with one bad cell.',
    alt: 'Step 3, Check, of a production import in KitStak Pulse. Six counters sort the rows of the file: New, Changed, No change, Look the same, Left out and Problems. The row with a problem is listed with the bad cell marked and the words: 9x is not a number of hours. Use 7.5 or 7:30. A wide screen also shows the buttons to fix the row, leave it out, save nothing or skip bad rows.',
    label: 'Import, step 3',
    name: 'import',
    views: [phoneOfHeight(1080), TABLET, { ...DESKTOP, height: 760 }],
    sizes: WIDE_SIZES,
    ready: true,
  },
  stack: {
    route: '/settings/apps',
    capture: 'Settings, Connected apps, after the first sync, scrolled to the KitStak WMS card.',
    alt: 'Connected apps in KitStak Pulse settings. KitStak WMS shows as Connected with the time of the last sync and a Sync now button. One list says what comes into Pulse, with switches: kits built, parts used, warehouse bills and work orders short of parts. Another says what shows in WMS: a Job profit card on work orders and a Client profit line. It says 8 jobs are linked. A wide screen also shows KitStak Projects, Connected, with 9 jobs linked.',
    label: 'Connected apps',
    name: 'connected-apps',
    // Beside the copy from 961 pixels up. Until 1280 that column is too narrow for the desktop capture.
    views: [
      APPS_PHONE,
      { ...APPS_DESKTOP, upTo: BUNDLE_BAND_STACKS_AT },
      { ...APPS_PHONE, upTo: SIDE_COLUMN_WIDE_FROM - 1 },
      APPS_DESKTOP,
    ],
    // From 1280 pixels up the Pulse band gives the picture the wider column: see `.bundleWide`.
    sizes: `(min-width: ${SIDE_COLUMN_WIDE_FROM}px) 660px, (min-width: ${BUNDLE_BAND_STACKS_AT + 1}px) 390px, 92vw`,
    phoneInColumn: 'bundle-band',
    ready: true,
  },
};

/**
 * The file a picture links to, so a visitor can open the screen at full size: the widest file of the
 * slot's desktop view.
 */
export function fullSizeFile(slot: PulseShotSlot, theme: PulseShotTheme): string {
  const desktop = slot.views[slot.views.length - 1]!;
  return shotFile(slot, desktop, theme, desktop.widths[desktop.widths.length - 1]!, 'avif');
}

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
