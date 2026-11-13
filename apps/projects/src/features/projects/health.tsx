'use client';
/** Project health pill (On track / At risk / Off track), shared by the directory, header, overview and dashboards. */
import { AlertTriangle, CheckCircle2, OctagonAlert } from 'lucide-react';
import { Badge, Tooltip } from '@/components/ui';
import { PROJECT_HEALTH_LABELS, type ProjectHealth } from '@/lib/constants';
import { todayIso } from '@/lib/dates';
import { expectedProgress, suggestHealth } from '@/lib/rollups';
import type { ProjectSummary } from '@/lib/types';

export const HEALTH_TONE: Readonly<Record<ProjectHealth, 'success' | 'warning' | 'danger'>> = {
  on_track: 'success',
  at_risk: 'warning',
  off_track: 'danger',
};

export const HEALTH_HELP: Readonly<Record<ProjectHealth, string>> = {
  on_track: 'Going as planned',
  at_risk: 'Might slip without help',
  off_track: 'Behind and needs attention',
};

export function HealthIcon({ health, className = 'size-3' }: { readonly health: ProjectHealth; readonly className?: string }) {
  const Icon = health === 'on_track' ? CheckCircle2 : health === 'at_risk' ? AlertTriangle : OctagonAlert;
  return <Icon aria-hidden className={className} />;
}

export function HealthBadge({ health, size = 'md' }: { readonly health: ProjectHealth; readonly size?: 'sm' | 'md' }) {
  return (
    <Badge tone={HEALTH_TONE[health]} size={size} icon={<HealthIcon health={health} />}>
      {PROJECT_HEALTH_LABELS[health]}
    </Badge>
  );
}

type HealthInputs = Pick<ProjectSummary, 'health' | 'status' | 'startDate' | 'dueDate' | 'progress'>;

/**
 * What the numbers say: share of time passed vs share of tasks done. `null` when the project has
 * no date range or is finished, so there is nothing to compare.
 */
export function dataHealth(project: HealthInputs, today: string = todayIso()): { readonly health: ProjectHealth; readonly expected: number; readonly actual: number } | null {
  if (project.status === 'completed' || project.status === 'archived') return null;
  const expected = expectedProgress(project.startDate, project.dueDate, today);
  if (expected === null) return null;
  return { health: suggestHealth(project.progress.percent, expected), expected, actual: project.progress.percent };
}

/** True when the owner's health and the data disagree (used to sort "Needs attention first"). */
export function healthMismatch(project: HealthInputs, today?: string): boolean {
  const data = dataHealth(project, today);
  return data !== null && data.health !== project.health;
}

/**
 * One truth for health: the owner's call, and when the numbers disagree an amber outline plus a
 * second line "Data says: At risk" so nobody has to guess which one to believe.
 */
export function ProjectHealthBadge({ project, size = 'md' }: { readonly project: HealthInputs; readonly size?: 'sm' | 'md' }) {
  const data = dataHealth(project);
  const mismatch = data !== null && data.health !== project.health;
  if (!mismatch || !data) return <HealthBadge health={project.health} size={size} />;
  return (
    <Tooltip
      side="bottom"
      content={`Owner says ${PROJECT_HEALTH_LABELS[project.health]}. Data says ${PROJECT_HEALTH_LABELS[data.health]}: ${data.expected}% of the time has passed and ${data.actual}% of tasks are done.`}
    >
      <span tabIndex={0} className="inline-flex items-center gap-1.5 rounded-full outline-none focus-visible:outline-2 focus-visible:outline-focus" data-testid="health-mismatch">
        <span className="rounded-full ring-2 ring-[var(--warning-accent,var(--warning))] ring-offset-1 ring-offset-[var(--surface-panel)]">
          <HealthBadge health={project.health} size={size} />
        </span>
        <span className="text-xs whitespace-nowrap text-warning-text max-sm:sr-only">
          Data says {PROJECT_HEALTH_LABELS[data.health].toLowerCase()}
        </span>
      </span>
    </Tooltip>
  );
}
