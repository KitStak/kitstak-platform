/**
 * Project health: the single source of truth for every surface (header, cards, overview, home,
 * sidebar, search, goals, dashboards). The owner's health is THE status. The numbers (share of
 * time used vs share of tasks done) only ever add a "numbers suggest" hint on that one status,
 * never a second status. Customer 360 risks (late receipts, inventory exceptions) are customer
 * notes and never change a project's health.
 */
import { PROJECT_HEALTH_LABELS, type GoalHealth, type ProjectHealth } from './constants';
import { todayIso } from './dates';
import { expectedProgress, suggestHealth } from './rollups';

export interface HealthSubject {
  readonly health: ProjectHealth;
  readonly status: string;
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly progress: { readonly percent: number };
}

export interface HealthView {
  /** The one status shown everywhere: the owner's call. */
  readonly health: ProjectHealth;
  /** What the numbers suggest when they disagree with the owner, else null. */
  readonly suggested: ProjectHealth | null;
  /** Share of the time used (0 to 100), or null when there is no date range or it is finished. */
  readonly expected: number | null;
  readonly actual: number;
}

/** Finished projects and projects that have not started yet have no pace to compare. */
function hasPace(project: HealthSubject, today: string): boolean {
  if (project.status === 'completed' || project.status === 'archived') return false;
  if (project.startDate && project.startDate > today) return false;
  return true;
}

export function projectHealth(project: HealthSubject, today: string = todayIso()): HealthView {
  const actual = project.progress.percent;
  const expected = hasPace(project, today) ? expectedProgress(project.startDate, project.dueDate, today) : null;
  const numbers = expected === null ? null : suggestHealth(actual, expected);
  return { health: project.health, suggested: numbers !== null && numbers !== project.health ? numbers : null, expected, actual };
}

/** Tooltip text for the "numbers disagree" hint, the same words on every surface. */
export function healthHint(view: HealthView): string | null {
  return view.suggested ? `Numbers suggest ${PROJECT_HEALTH_LABELS[view.suggested]}` : null;
}

export type ProgressTone = 'primary' | 'success' | 'warning' | 'danger';

/**
 * Progress is a quantity, so rings and bars are drawn in the Projects data color whatever the
 * health (docs/design/UI-CLEANUP.md): the health pill next to them already says at risk or off
 * track, and an amber or red bar would say it twice. Only an achieved goal turns green.
 */
export function healthProgressTone(health: ProjectHealth | GoalHealth): ProgressTone {
  return health === 'achieved' ? 'success' : 'primary';
}

/** Tailwind background class for a small health dot (sidebar, home). On track stays green. */
export const HEALTH_DOT_CLASS: Readonly<Record<ProjectHealth | GoalHealth, string>> = {
  on_track: 'bg-success',
  at_risk: 'bg-warning-accent',
  off_track: 'bg-danger',
  achieved: 'bg-success',
  missed: 'bg-danger',
};
