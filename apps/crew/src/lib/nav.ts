/**
 * The Crew navigation, in one place (docs/crew/SPEC.md section 6). The top nav, the mobile sheet,
 * the command palette and the search page all read this list. Home, Schedule, Time, People,
 * Attendance, Plan, then More (Time off, Skills, Import and export, Settings). Today is the primary
 * button in the top bar. Leads see Today, Schedule, Time and Plan only.
 * Pure module: icons are mapped in src/features/shell/nav-icons.tsx.
 */
import { canCrew, type CrewAction, type CrewRole } from './permissions';
import { routes } from './routes';

export type NavId = 'home' | 'today' | 'schedule' | 'time' | 'people' | 'attendance' | 'plan' | 'time-off' | 'skills' | 'import' | 'settings';

export type NavGroup = 'main' | 'more' | 'primary';

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
  /** The action a role needs to see this entry. */
  readonly needs: CrewAction;
  /** Shown to leads (SPEC 6: leads see Today, Schedule, Time, Plan). */
  readonly forLeads?: boolean;
  /** Which live count shows as a badge on this entry. */
  readonly badge?: 'needsFix';
}

export const NAV: readonly NavEntry[] = [
  { id: 'today', group: 'primary', label: 'Today', description: 'Who is here, who is late and who is out, per site, right now.', href: routes.today(), prefixes: ['/today'], keywords: ['board', 'floor', 'on site', 'late', 'now'], chord: 'Y', needs: 'crew:read', forLeads: true },
  { id: 'home', group: 'main', label: 'Home', description: 'Each site at a glance: on site now, hours this week and what needs you.', href: routes.home(), prefixes: ['/'], keywords: ['dashboard', 'overview', 'summary'], chord: 'H', needs: 'crew:read' },
  { id: 'schedule', group: 'main', label: 'Schedule', description: 'Build the week from shift templates, fill open slots and publish.', href: routes.schedule(), prefixes: ['/schedule'], keywords: ['shifts', 'week', 'publish', 'open shifts', 'templates'], chord: 'S', needs: 'schedule:read', forLeads: true },
  { id: 'time', group: 'main', label: 'Time', description: 'Time cards by site and week, fixes and approving the week.', href: routes.time(), prefixes: ['/time'], keywords: ['timesheets', 'time cards', 'punches', 'approve', 'overtime', 'payroll'], chord: 'T', needs: 'crew:read', forLeads: true, badge: 'needsFix' },
  { id: 'people', group: 'main', label: 'People', description: 'Everyone on the floor, temps included, with agencies and imports.', href: routes.people(), prefixes: ['/people'], keywords: ['employees', 'temps', 'agencies', 'roster', 'crew'], chord: 'P', needs: 'person:manage' },
  { id: 'attendance', group: 'main', label: 'Attendance', description: 'Late, early out, no call no show and called out, by site and date.', href: routes.attendance(), prefixes: ['/attendance'], keywords: ['late', 'no call no show', 'called out', 'excuse'], chord: 'A', needs: 'attendance:read' },
  { id: 'plan', group: 'main', label: 'Plan', description: 'How many people each day needs against how many are scheduled.', href: routes.plan(), prefixes: ['/plan'], keywords: ['labor plan', 'people short', 'gap', 'temps', 'pace'], chord: 'L', needs: 'plan:read', forLeads: true },
  { id: 'time-off', group: 'more', label: 'Time off', description: 'Requests to decide, who is out, and balances.', href: routes.timeOff(), prefixes: ['/time-off'], keywords: ['pto', 'vacation', 'sick', 'requests', 'balances'], chord: 'O', needs: 'timeoff:decide' },
  { id: 'skills', group: 'more', label: 'Skills', description: 'Certifications and skills by person, with cards ending soon.', href: routes.skills(), prefixes: ['/skills'], keywords: ['certifications', 'forklift', 'training', 'matrix'], chord: 'K', needs: 'crew:read' },
  { id: 'import', group: 'more', label: 'Import and export', description: 'Bring in spreadsheets and download your data as CSV files.', href: routes.importCenter(), prefixes: ['/import', '/export'], keywords: ['csv', 'spreadsheet', 'upload', 'download', 'template'], chord: 'I', needs: 'import:run' },
  { id: 'settings', group: 'more', label: 'Settings', description: 'Sites and areas, labor rules, time clocks, roles and connected apps.', href: routes.settings(), prefixes: ['/settings'], keywords: ['sites', 'areas', 'rules', 'kiosks', 'roles', 'apps'], chord: ',', needs: 'settings:manage' },
];

/** True when `pathname` belongs to the entry (exact for `/`, prefix with a boundary otherwise). */
export function navMatches(entry: NavEntry, pathname: string): boolean {
  return entry.prefixes.some((prefix) => (prefix === '/' ? pathname === '/' : pathname === prefix || pathname.startsWith(`${prefix}/`)));
}

/** The entries a role may see, in order. A lead sees only the lead entries. */
export function navFor(role: CrewRole): readonly NavEntry[] {
  if (role === 'none') return [];
  return NAV.filter((entry) => canCrew(role, entry.needs) && (role !== 'lead' || entry.forLeads === true));
}

/** Where a role lands after sign in: leads go straight to Today (SPEC 6). */
export function landingPath(role: CrewRole): string {
  return role === 'lead' ? routes.today() : routes.home();
}

/** Go to shortcuts (`g` then the letter) as a map of lowercase letter to path. */
export function chordTargets(role: CrewRole): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of navFor(role)) if (entry.chord) out[entry.chord.toLowerCase()] = entry.href;
  return out;
}
