/**
 * Program alerts on the Alerts page (docs/programs/PULSE_PROGRAMS_SPEC.md 6): P1 to P7 of every
 * tracked program for this month, worked out from the program's numbers each time the page opens
 * (they are not stored alerts, so they have no snooze and clear on their own). Pure: where each
 * action goes, and how loud each alert is.
 */
import type { ProgramAlertAction, ProgramRule } from '@/lib/profit/program-risk';
import type { ProgramAlertDTO, ProgramHealth } from '@/lib/program-types';
import { routes } from '@/lib/routes';

/** One tracked program with the alerts that fire for it this month. */
export interface ProgramAlertGroupDTO {
  readonly key: string;
  readonly name: string;
  readonly health: ProgramHealth;
  /** Pulse path of the program page. */
  readonly path: string;
  /** Path of the program in Projects (add the Projects origin). */
  readonly projectsPath: string;
  readonly alerts: readonly ProgramAlertDTO[];
}

export interface ProgramAlertsDTO {
  /** `YYYY-MM`. */
  readonly month: string;
  readonly groups: readonly ProgramAlertGroupDTO[];
}

/** P1, P2, P4 and P5 put the program at risk (the same split as its health dot); the rest are a heads up. */
const AT_RISK: ReadonlySet<ProgramRule> = new Set<ProgramRule>(['P1', 'P2', 'P4', 'P5']);

export type ProgramAlertSeverity = 'critical' | 'warning' | 'info';

/** How loud an alert is: a program losing money makes its money alerts urgent. */
export function programAlertSeverity(rule: ProgramRule, health: ProgramHealth): ProgramAlertSeverity {
  if (!AT_RISK.has(rule)) return 'info';
  return health === 'losing' ? 'critical' : 'warning';
}

/**
 * Where the one action of an alert goes: the program tab that shows the problem, for the same
 * month. "Open program in Projects" goes to Projects when its address is known, else to the
 * program page.
 */
export function programAlertHref(action: ProgramAlertAction, group: Pick<ProgramAlertGroupDTO, 'key' | 'projectsPath'>, month: string, projectsOrigin: string | null): { readonly href: string; readonly external: boolean } {
  switch (action) {
    case 'see_variants':
    case 'open_variant':
      return { href: routes.program(group.key, { month, tab: 'variants' }), external: false };
    case 'see_days':
    case 'add_hours':
      return { href: routes.program(group.key, { month, tab: 'days' }), external: false };
    case 'open_in_projects':
      return projectsOrigin ? { href: `${projectsOrigin.replace(/\/+$/, '')}${group.projectsPath}`, external: true } : { href: routes.program(group.key, { month }), external: false };
  }
}

const HEALTH_ORDER: Readonly<Record<ProgramHealth, number>> = { losing: 0, at_risk: 1, heads_up: 2, no_data: 3, on_track: 4 };

/** Programs with alerts, worst first, then by key. */
export function sortProgramAlertGroups(groups: readonly ProgramAlertGroupDTO[]): ProgramAlertGroupDTO[] {
  return groups.filter((group) => group.alerts.length > 0).sort((a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] || a.key.localeCompare(b.key));
}

/** "3 program alerts this month" for the section heading. */
export function programAlertCount(groups: readonly ProgramAlertGroupDTO[]): string {
  const count = groups.reduce((sum, group) => sum + group.alerts.length, 0);
  return count === 1 ? '1 program alert' : `${count} program alerts`;
}
