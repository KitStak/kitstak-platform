/**
 * Screenshot slots for the Pulse page.
 *
 * Today every slot is `ready: false`, so the page shows the coded illustrations in pulse-visuals.tsx.
 * When the Pulse app is finished, real screenshots replace them one slot at a time.
 *
 * How to capture a slot:
 *  1. Run the Pulse app (apps/pulse, http://localhost:3500) and sign in to the "kitstak" demo workspace
 *     as a person who can see money. Load the sample data if the workspace is empty.
 *  2. Set the browser window to the slot's `width` by `height` at a device pixel ratio of 2. Hide the
 *     cursor and close any open menu or toast.
 *  3. Open the slot's `route`. Where the route has a `[ref]`, use the job named in `capture`.
 *  4. Take the shot twice: once in the light theme and once in the dark theme (the theme switch is in
 *     the command palette). Save both as PNG.
 *  5. Put the two files at the slot's `light` and `dark` paths under apps/web/public (so
 *     /pulse/shots/home-light.png is the file apps/web/public/pulse/shots/home-light.png).
 *  6. Check the screen against the page copy, then set `ready: true` on that slot. That one line is
 *     the whole change: PulseShot renders the picture in place of the coded visual.
 *
 * Keep screenshots honest: sample data only, straight from the running app, no retouching.
 */

export const PULSE_SHOT_IDS = ['hero', 'profit', 'log', 'plan', 'rates', 'risk', 'csv', 'stack'] as const;

export type PulseShotId = (typeof PULSE_SHOT_IDS)[number];

export interface PulseShotSlot {
  /** The route in the Pulse app the screenshot is taken from. */
  readonly route: string;
  /** What to have on screen when the shot is taken. */
  readonly capture: string;
  /** Text alternative for the screenshot. It describes what the screen shows. */
  readonly alt: string;
  /** Site paths under /pulse/shots/, one per theme. */
  readonly light: string;
  readonly dark: string;
  /** Size of the capture in CSS pixels. The files are twice this, for sharp screens. */
  readonly width: number;
  readonly height: number;
  /** The hero image is above the fold, so it loads first. Every other slot loads lazily. */
  readonly priority?: true;
  /** Set to true once both files are in place. */
  readonly ready: boolean;
}

function files(name: string): Pick<PulseShotSlot, 'light' | 'dark'> {
  return { light: `/pulse/shots/${name}-light.png`, dark: `/pulse/shots/${name}-dark.png` };
}

export const PULSE_SHOTS: Readonly<Record<PulseShotId, PulseShotSlot>> = {
  hero: {
    route: '/',
    capture: 'Home for this month: the two line answer, the tiles and Jobs that need you.',
    alt: 'KitStak Pulse Home. It says in words what the jobs made this month, shows money in, money out, profit and margin, and lists the jobs that need you. Sample data.',
    ...files('home'),
    width: 1440,
    height: 900,
    priority: true,
    ready: false,
  },
  profit: {
    route: '/profit?by=client',
    capture: 'The Profit page on the Client tab for this month, ranking chart above the table.',
    alt: 'The Profit page in KitStak Pulse. A table ranks each client by profit, with money in, money out, profit and margin, and tabs for job, client, job type and service. Sample data.',
    ...files('profit'),
    width: 1440,
    height: 900,
    ready: false,
  },
  log: {
    route: '/log',
    capture: 'Log work for one day at the main site, with one row opened into its crew lines.',
    alt: 'Log work in KitStak Pulse. One row per job for the day, with good units, people, hours each, labor hours and units per person per hour against the target pace. Sample data.',
    ...files('log'),
    width: 1440,
    height: 900,
    ready: false,
  },
  plan: {
    route: '/jobs/[ref]/plan',
    capture: 'Plan vs actual for an open job, "For the work done so far", with Why profit changed in view.',
    alt: 'Plan vs actual for one job in KitStak Pulse. A table compares the plan for the work done so far with what happened, and a chart splits the change in profit by cause. Sample data.',
    ...files('plan'),
    width: 1440,
    height: 900,
    ready: false,
  },
  rates: {
    route: '/labor',
    capture: 'Labor, Rates tab, with the rate builder open on the Packer labor class.',
    alt: 'The rate builder in KitStak Pulse. It adds payroll taxes, benefits and overhead to the wage and reads out what one hour really costs. Sample data.',
    ...files('rates'),
    width: 1440,
    height: 900,
    ready: false,
  },
  risk: {
    route: '/jobs',
    capture: 'Jobs on the Open tab, sorted worst first, with the status chips in view.',
    alt: 'The Jobs list in KitStak Pulse, worst first. Each open job has a status, the reason in a sentence and a next step. Sample data.',
    ...files('jobs'),
    width: 1440,
    height: 900,
    ready: false,
  },
  csv: {
    route: '/import/new',
    capture: 'A Production file on step 3, Check, with one error shown on its cell.',
    alt: 'The Check step of a CSV import in KitStak Pulse. It counts new, changed and unchanged rows and shows each problem in plain words on the exact cell. Sample data.',
    ...files('import'),
    width: 1440,
    height: 900,
    ready: false,
  },
  stack: {
    route: '/settings/apps',
    capture: 'Settings, Connected apps, with CRM, WMS and Projects connected and a recent sync.',
    alt: 'Connected apps in KitStak Pulse. It shows what comes in from KitStak CRM, WMS and Projects and when each was last synced. Sample data.',
    ...files('connected-apps'),
    width: 1440,
    height: 900,
    ready: false,
  },
};
