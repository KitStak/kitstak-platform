'use client';
/** Project health pill (On track / At risk / Off track), shared by the directory, header, overview and dashboards. */
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, OctagonAlert } from 'lucide-react';
import { Badge, Button, Popover, PopoverContent, PopoverTrigger } from '@/components/ui';
import { useServerAction } from '@/lib/hooks/use-action';
import { qk } from '@/lib/query-keys';
import { postProjectUpdateAction } from '@/server/actions/portfolio';
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
 * One truth for health: the owner's pill. When the numbers disagree, the pill gets a small amber
 * dot; clicking it explains why ("56% of the time used, 31% of tasks done") and, for people who
 * can edit the project, switches the health in one click (posted as a status update).
 */
export function ProjectHealthBadge({ project, size = 'md', canEdit = false }: { readonly project: HealthInputs & { readonly id?: string; readonly key?: string }; readonly size?: 'sm' | 'md'; readonly canEdit?: boolean }) {
  const data = dataHealth(project);
  const mismatch = data !== null && data.health !== project.health;
  const [open, setOpen] = useState(false);
  const accept = useServerAction(postProjectUpdateAction, {
    invalidate: project.key ? [qk.project(project.key), qk.projects()] : [qk.projects()],
    successMessage: data ? `Health set to ${PROJECT_HEALTH_LABELS[data.health]}` : undefined,
    onSuccess: () => setOpen(false),
  });
  if (!mismatch || !data) return <HealthBadge health={project.health} size={size} />;
  const suggested = PROJECT_HEALTH_LABELS[data.health];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${PROJECT_HEALTH_LABELS[project.health]}. The numbers suggest ${suggested}. Show why`}
          onClick={(event) => event.stopPropagation()}
          className="relative inline-flex rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          data-testid="health-mismatch"
        >
          <HealthBadge health={project.health} size={size} />
          <span aria-hidden className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-warning ring-2 ring-[var(--surface-panel)]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72" onClick={(event) => event.stopPropagation()}>
        <p className="flex items-start gap-2 text-sm text-fg">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-text" />
          <span>
            The numbers suggest <strong className="font-semibold">{suggested}</strong>: {data.expected}% of the time is used and {data.actual}% of tasks are done.
          </span>
        </p>
        {canEdit && project.id ? (
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Keep {PROJECT_HEALTH_LABELS[project.health]}
            </Button>
            <Button size="sm" loading={accept.pending} onClick={() => void accept.run({ projectId: project.id as string, health: data.health, note: null })} data-testid="health-accept">
              Switch to {suggested}
            </Button>
          </div>
        ) : (
          <p className="mt-2 text-xs text-fg-muted">The project owner sets the health.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
