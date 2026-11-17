/**
 * The Pulse navigation, in one place. The sidebar, the mobile drawer, the command palette, the
 * shortcut sheet and the search page all read this list, so a page is added or renamed once.
 * Spec: docs/pulse/SPEC.md section 6. Seven items and one group ("More"), no more.
 * Pure module: icons are mapped in src/features/shell/nav-icons.tsx.
 */
import type { PulseRole } from './permissions';
import { routes } from './routes';

export type NavId =
  | 'home'
  | 'jobs'
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
  /** Which live count shows as a badge on this entry. */
  readonly badge?: 'jobsAtRisk';
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
  },
  {
    id: 'labor',
    group: 'main',
    label: 'Labor',
    description: 'What an hour really costs, where paid time goes, and labor cost.',
    href: routes.labor(),
    prefixes: ['/labor'],
    keywords: ['rates', 'wages', 'real cost of an hour', 'time', 'overtime', 'payroll'],
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
  },
  {
    id: 'calculator',
    group: 'more',
    label: 'Calculator',
    description: 'Price a new job or test a what if before you say yes.',
    href: routes.calculator(),
    prefixes: ['/calculator'],
    keywords: ['quote', 'price', 'what if', 'break even', 'estimate'],
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
  },
  {
    id: 'settings',
    group: 'more',
    label: 'Settings',
    description: 'Sites, job types, people and roles, cost rules, month close and connected apps.',
    href: routes.settings(),
    prefixes: ['/settings'],
    keywords: ['preferences', 'roles', 'sites', 'job types', 'month close', 'connected apps', 'audit'],
    hiddenFor: ['supervisor'],
  },
];

/** True when `pathname` belongs to the entry (exact for `/`, prefix with a boundary otherwise). */
export function navMatches(entry: NavEntry, pathname: string): boolean {
  return entry.prefixes.some((prefix) => (prefix === '/' ? pathname === '/' : pathname === prefix || pathname.startsWith(`${prefix}/`)));
}

/** The entries a role may see, in order. People with no role see nothing. */
export function navFor(role: PulseRole): readonly NavEntry[] {
  if (role === 'none') return [];
  return NAV.filter((entry) => !entry.hiddenFor?.includes(role));
}

/** Where a role lands after sign in: supervisors go straight to the log. */
export function landingPath(role: PulseRole): string {
  return role === 'supervisor' ? routes.log() : routes.home();
}

/** Go to shortcuts (`g` then the letter) as a map of lowercase letter to path. */
export function chordTargets(role: PulseRole): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of navFor(role)) {
    if (entry.chord) out[entry.chord.toLowerCase()] = entry.href;
  }
  return out;
}
