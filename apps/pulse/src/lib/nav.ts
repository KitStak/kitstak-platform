/**
 * The Pulse navigation, in one place. The sidebar, the mobile drawer, the command palette, the
 * shortcut sheet and the search page all read this list, so a page is added or renamed once.
 * Spec: docs/pulse/SPEC.md section 6. Eight items and one group ("More"), no more. Programs shows
 * only where the program tracker is available (docs/programs/PULSE_PROGRAMS_SPEC.md 7.1).
 * Pure module: icons are mapped in src/features/shell/nav-icons.tsx.
 */
import { canPulse, type PulseAction, type PulseRole } from './permissions';
import { routes } from './routes';

export type NavId =
  | 'home'
  | 'jobs'
  | 'programs'
  | 'log'
  | 'profit'
  | 'labor'
  | 'alerts'
  | 'reports'
  | 'target-pace'
  | 'calculator'
  | 'goals'
  | 'import'
  | 'settings';

export type NavGroup = 'main' | 'more';

export interface NavEntry {
  readonly id: NavId;
  readonly group: NavGroup;
  readonly label: string;
  /** One plain sentence: what the page is for (palette row, search page). */
  readonly description: string;
  readonly href: string;
  /** Path prefixes that keep this entry highlighted. `/` matches only itself. */
  readonly prefixes: readonly string[];
  readonly keywords: readonly string[];
  /** Second key of the `g` then letter shortcut. */
  readonly chord?: string;
  /** Roles that do not see this entry. Supervisors log work and never see money pages. */
  readonly hiddenFor?: readonly PulseRole[];
  /** Only for people who see money: a viewer with money hidden would land on a "not part of your role" page. */
  readonly money?: boolean;
  /** Which live count shows as a badge on this entry. */
  readonly badge?: 'jobsAtRisk';
  /** Shown only when this part of Pulse is on for the org: `programs` needs Projects and its program tables. */
  readonly requires?: 'programs';
}

/** Parts of Pulse that depend on the org (`NavEntry.requires`). Left out, they are off. */
export interface NavFeatures {
  readonly programs?: boolean;
}

export const NAV: readonly NavEntry[] = [
  {
    id: 'home',
    group: 'main',
    label: 'Home',
    description: 'How the business is doing and which jobs need you.',
    href: routes.home(),
    prefixes: ['/'],
    keywords: ['dashboard', 'overview', 'today', 'summary'],
    chord: 'H',
    hiddenFor: ['supervisor'],
  },
  {
    id: 'jobs',
    group: 'main',
    label: 'Jobs',
    description: 'Every job, with the ones at risk or losing money first.',
    href: routes.jobs(),
    prefixes: ['/jobs'],
    keywords: ['open jobs', 'at risk', 'losing money', 'work orders', 'quotes'],
    chord: 'J',
    badge: 'jobsAtRisk',
  },
  {
    id: 'programs',
    group: 'main',
    label: 'Programs',
    description: 'Recurring work under one price card, by month and by variant.',
    href: routes.programs(),
    prefixes: ['/programs'],
    keywords: ['recurring', 'price card', 'variants', 'monthly', 'kits', 'forecast'],
    chord: 'R',
    requires: 'programs',
  },
  {
    id: 'log',
    group: 'main',
    label: 'Log work',
    description: 'Type in what got finished today: units, people and hours.',
    href: routes.log(),
    prefixes: ['/log'],
    keywords: ['production', 'daily entry', 'units', 'headcount', 'hours', 'kits'],
    chord: 'L',
  },
  {
    id: 'profit',
    group: 'main',
    label: 'Profit',
    description: 'Revenue, cost and margin by job, client, job type, service, site or month.',
    href: routes.profit(),
    prefixes: ['/profit', '/clients', '/services'],
    keywords: ['margin', 'revenue', 'cost', 'clients', 'job types', 'extra services', 'sites', 'months'],
    chord: 'P',
    hiddenFor: ['supervisor'],
    money: true,
  },
  {
    id: 'labor',
    group: 'main',
    label: 'Labor',
    description: 'What an hour really costs, where paid time goes, and labor cost.',
    href: routes.labor(),
    prefixes: ['/labor'],
    keywords: ['rates', 'wages', 'real cost of an hour', 'time', 'overtime', 'payroll'],
    chord: 'B',
  },
  {
    id: 'alerts',
    group: 'main',
    label: 'Alerts',
    description: 'Things that need you, with what happened and the next step.',
    href: routes.alerts(),
    prefixes: ['/alerts'],
    keywords: ['notifications', 'warnings', 'rules', 'things to fix'],
    chord: 'A',
  },
  {
    id: 'reports',
    group: 'main',
    label: 'Reports',
    description: 'Ready made reports you can filter, print, export or build on a schedule.',
    href: routes.reports(),
    prefixes: ['/reports'],
    keywords: ['print', 'csv', 'schedule', 'month close', 'ready to bill'],
    chord: 'E',
    hiddenFor: ['supervisor'],
  },
  {
    id: 'target-pace',
    group: 'more',
    label: 'Target pace',
    description: 'How many units one person should finish in an hour.',
    href: routes.targetPace(),
    prefixes: ['/target-pace'],
    keywords: ['units per person per hour', 'standards', 'productivity', 'speed'],
    chord: 'T',
  },
  {
    id: 'calculator',
    group: 'more',
    label: 'Calculator',
    description: 'Price a new job or test a what if before you say yes.',
    href: routes.calculator(),
    prefixes: ['/calculator'],
    keywords: ['quote', 'price', 'what if', 'break even', 'estimate'],
    chord: 'C',
    hiddenFor: ['supervisor'],
  },
  {
    id: 'goals',
    group: 'more',
    label: 'Goals',
    description: 'Targets for margin, profit and pace, and how you are doing against them.',
    href: routes.goals(),
    prefixes: ['/goals'],
    keywords: ['targets', 'scorecard', 'margin goal'],
    chord: 'O',
    hiddenFor: ['supervisor'],
  },
  {
    id: 'import',
    group: 'more',
    label: 'Import and export',
    description: 'Bring in spreadsheets and download your data as CSV files.',
    href: routes.importCenter(),
    prefixes: ['/import', '/export'],
    keywords: ['csv', 'spreadsheet', 'upload', 'download', 'template', 'excel'],
    chord: 'I',
  },
  {
    id: 'settings',
    group: 'more',
    label: 'Settings',
    description: 'Sites, job types, people and roles, cost rules, month close and connected apps.',
    href: routes.settings(),
    prefixes: ['/settings'],
    keywords: ['preferences', 'roles', 'sites', 'job types', 'month close', 'connected apps', 'audit'],
    chord: 'S',
    hiddenFor: ['supervisor'],
  },
];

/** True when `pathname` belongs to the entry (exact for `/`, prefix with a boundary otherwise). */
export function navMatches(entry: NavEntry, pathname: string): boolean {
  return entry.prefixes.some((prefix) => (prefix === '/' ? pathname === '/' : pathname === prefix || pathname.startsWith(`${prefix}/`)));
}

/**
 * The entries a role may see, in order. People with no role see nothing; `seesMoney` false drops
 * the money pages; an entry that `requires` a part of Pulse shows only when `features` turns it on.
 */
export function navFor(role: PulseRole, seesMoney = true, features: NavFeatures = {}): readonly NavEntry[] {
  if (role === 'none') return [];
  return NAV.filter((entry) => !entry.hiddenFor?.includes(role) && (seesMoney || !entry.money) && (!entry.requires || features[entry.requires] === true));
}

/** Where a role lands after sign in: supervisors go straight to the log. */
export function landingPath(role: PulseRole): string {
  return role === 'supervisor' ? routes.log() : routes.home();
}

/** Go to shortcuts (`g` then the letter) as a map of lowercase letter to path. */
export function chordTargets(role: PulseRole, seesMoney = true, features: NavFeatures = {}): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of navFor(role, seesMoney, features)) {
    if (entry.chord) out[entry.chord.toLowerCase()] = entry.href;
  }
  return out;
}

/**
 * Pages that sit under a navigation entry (tabs, second level screens and settings sections).
 * The command palette lists them, so every screen can be reached by typing its name.
 * A page shows when its parent entry shows for the role and the role may do `needs`.
 */
export interface SubPage {
  readonly id: string;
  readonly parent: NavId;
  readonly label: string;
  readonly description: string;
  readonly href: string;
  readonly keywords: readonly string[];
  readonly needs?: PulseAction;
  /** Only for people who see money. */
  readonly money?: boolean;
}

export const SUB_PAGES: readonly SubPage[] = [
  { id: 'welcome', parent: 'home', label: 'Getting started', description: 'Five short steps to your first profit number.', href: routes.welcome(), keywords: ['welcome', 'setup', 'checklist', 'sample data', 'first steps'] },
  { id: 'jobs-all', parent: 'jobs', label: 'All jobs', description: 'Every job, open or not.', href: routes.jobs({ tab: 'all' }), keywords: ['jobs', 'list', 'everything'] },
  { id: 'jobs-completed', parent: 'jobs', label: 'Completed jobs', description: 'Finished jobs and how they ended.', href: routes.jobs({ tab: 'completed' }), keywords: ['done', 'finished', 'closed jobs'] },
  { id: 'jobs-planned', parent: 'jobs', label: 'Planned jobs', description: 'Jobs that have not started yet.', href: routes.jobs({ tab: 'planned' }), keywords: ['upcoming', 'not started', 'pipeline'] },
  { id: 'jobs-risk', parent: 'jobs', label: 'Jobs at risk or losing money', description: 'Only the jobs that need you.', href: routes.jobs({ risk: 'losing,at_risk' }), keywords: ['at risk', 'losing money', 'trouble', 'red'] },
  { id: 'log-bulk', parent: 'log', label: 'Log many days', description: 'One sheet for a run of days, with paste from a spreadsheet.', href: routes.logBulk(), keywords: ['bulk', 'many days', 'catch up', 'paste'], needs: 'production:log' },
  { id: 'log-review', parent: 'log', label: 'Review the day', description: 'Check each day, fix odd rows, then approve it.', href: routes.logReview(), keywords: ['approve', 'review', 'send back', 'odd rows'], needs: 'day:review' },
  { id: 'log-entries', parent: 'log', label: 'All work entries', description: 'Every logged row, with filters, edits and CSV export.', href: routes.logEntries(), keywords: ['entries', 'production rows', 'history', 'fix'] },
  { id: 'profit-client', parent: 'profit', label: 'Profit by client', description: 'Which clients make money and which do not.', href: routes.profit({ by: 'client' }), keywords: ['clients', 'customers', 'cost to serve'] },
  { id: 'profit-type', parent: 'profit', label: 'Profit by job type', description: 'Margin for each kind of work.', href: routes.profit({ by: 'type' }), keywords: ['job types', 'kinds of work'] },
  { id: 'profit-service', parent: 'profit', label: 'Profit by extra service', description: 'What each extra service earns and costs.', href: routes.profit({ by: 'service' }), keywords: ['extra services', 'vas'] },
  { id: 'profit-site', parent: 'profit', label: 'Profit by site', description: 'One building against another.', href: routes.profit({ by: 'site' }), keywords: ['sites', 'buildings', 'locations'] },
  { id: 'profit-month', parent: 'profit', label: 'Profit by month', description: 'Revenue, cost and margin month by month.', href: routes.profit({ by: 'month' }), keywords: ['months', 'trend', 'monthly'] },
  { id: 'services', parent: 'profit', label: 'Extra services', description: 'Your price list of extra work, with margin for each service.', href: routes.services(), keywords: ['extra services', 'price list', 'labeling', 'underpriced'] },
  { id: 'labor-rates', parent: 'labor', label: 'Labor rates', description: 'Labor classes and the real cost of an hour.', href: routes.labor('rates'), keywords: ['wage', 'rate', 'real cost of an hour', 'labor class', 'overtime'], money: true },
  { id: 'labor-time', parent: 'labor', label: 'Where paid time goes', description: 'Hours on jobs, time not on a job and paid time not on any job.', href: routes.labor('time'), keywords: ['time not on a job', 'paid hours', 'punches', 'share of paid time'] },
  { id: 'labor-cost', parent: 'labor', label: 'Labor cost', description: 'Labor cost by labor class, job type and client.', href: routes.labor('cost'), keywords: ['labor cost', 'overtime share', 'labor share of revenue'], money: true },
  { id: 'alert-rules', parent: 'alerts', label: 'Alert rules', description: 'Choose what Pulse should tell you about, and who hears it.', href: routes.alertRules(), keywords: ['rules', 'tell me when', 'thresholds', 'quiet hours'] },
  { id: 'reports-scheduled', parent: 'reports', label: 'Scheduled reports', description: 'Reports Pulse builds for you on a schedule.', href: `${routes.reports()}?tab=scheduled`, keywords: ['schedule', 'weekly report', 'monthly report', 'builds'] },
  { id: 'import-new', parent: 'import', label: 'Import a file', description: 'Bring in a CSV file or paste rows.', href: routes.newImport(), keywords: ['upload', 'csv', 'paste', 'spreadsheet'], needs: 'production:log' },
  { id: 'export', parent: 'import', label: 'Export data', description: 'Download any part of your data as CSV files.', href: routes.exportCenter(), keywords: ['download', 'csv', 'backup', 'zip'] },
  { id: 'wall', parent: 'jobs', label: 'Wall display', description: 'Full screen goals and pace for the floor TV.', href: routes.wall(), keywords: ['tv', 'floor', 'screen', 'display'] },
  { id: 'settings-close', parent: 'settings', label: 'Close a month', description: 'Check a month, then lock its numbers.', href: routes.settingsClose(), keywords: ['month end', 'lock', 'period', 'close'], needs: 'period:close' },
  { id: 'settings-apps', parent: 'settings', label: 'Connected apps', description: 'What flows in from CRM, WMS and Projects, and when it last synced.', href: routes.settingsApps(), keywords: ['crm', 'wms', 'projects', 'sync', 'integrations', 'links'] },
  { id: 'settings-audit', parent: 'settings', label: 'Audit log', description: 'Who changed what, and when.', href: routes.settingsAudit(), keywords: ['history', 'changes', 'who changed', 'activity'] },
  { id: 'settings-sites', parent: 'settings', label: 'Sites', description: 'Your buildings and their time zones.', href: routes.settings('sites'), keywords: ['buildings', 'locations', 'time zone'], needs: 'settings:manage' },
  { id: 'settings-job-types', parent: 'settings', label: 'Job types', description: 'The kinds of work you sell.', href: routes.settings('job-types'), keywords: ['kinds of work', 'kitting', 'categories'], needs: 'settings:manage' },
  { id: 'settings-people', parent: 'settings', label: 'People and roles', description: 'Who can use Pulse and who can see money.', href: routes.settings('people'), keywords: ['roles', 'team', 'who can see money', 'permissions', 'pin'], needs: 'roles:manage' },
  { id: 'settings-cost-rules', parent: 'settings', label: 'Cost rules', description: 'When a job counts as at risk or losing money.', href: routes.settings('cost-rules'), keywords: ['risk', 'thresholds', 'rules', 'target margin'], needs: 'settings:manage' },
  { id: 'settings-devices', parent: 'settings', label: 'Floor tablets and TVs', description: 'Links and PINs for floor tablets and wall TVs.', href: routes.settings('devices'), keywords: ['kiosk', 'tablet', 'tv', 'pin', 'device links'], needs: 'device:manage' },
  { id: 'settings-math', parent: 'settings', label: 'How Pulse does the math', description: 'Every formula in plain words.', href: routes.settings('math'), keywords: ['formula', 'math', 'how we got this', 'explain'] },
];

/** The sub pages a role may open. `seesMoney` drops the money only ones. */
export function subPagesFor(role: PulseRole, seesMoney: boolean, features: NavFeatures = {}): readonly SubPage[] {
  const parents = new Set(navFor(role, seesMoney, features).map((entry) => entry.id));
  return SUB_PAGES.filter((page) => parents.has(page.parent) && (!page.needs || canPulse(role, page.needs)) && (!page.money || seesMoney));
}
