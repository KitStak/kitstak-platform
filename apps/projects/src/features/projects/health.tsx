'use client';
/** Project health pill (On track / At risk / Off track), shared by the directory, header, overview and dashboards. */
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, OctagonAlert } from 'lucide-react';
import { Badge, Button, Popover, PopoverContent, PopoverTrigger, cn } from '@/components/ui';
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
 * One truth for health: the owner's pill. When the numbers disagree, the pill says so in words
 * right beside it ("On track · Data says At risk"), never as an unexplained dot. Clicking it shows
 * why ("56% of the time used, 31% of tasks done") and, for people who can edit the project, updates
 * the status in one click (posted as a status update).
 */
const HEALTH_RANK: Readonly<Record<ProjectHealth, number>> = { on_track: 0, at_risk: 1, off_track: 2 };

const worse = (a: ProjectHealth, b: ProjectHealth): ProjectHealth => (HEALTH_RANK[a] >= HEALTH_RANK[b] ? a : b);

/** A cross-app risk (late receipts, inventory exceptions, a deal closing early) from Customer 360. */
export interface HealthRisk {
  readonly id: string;
  readonly tone: 'danger' | 'warning';
  readonly text: string;
}

export function ProjectHealthBadge({
  project,
  size = 'md',
  canEdit = false,
  risks = [],
}: {
  readonly project: HealthInputs & { readonly id?: string; readonly key?: string };
  readonly size?: 'sm' | 'md';
  readonly canEdit?: boolean;
  /** Customer 360 risks: any of them makes the data say at least At risk. */
  readonly risks?: readonly HealthRisk[];
}) {
  const timeData = dataHealth(project);
  // What the data says: time used vs work done, made worse by live CRM and warehouse risks.
  const riskHealth: ProjectHealth | null = risks.length && project.status !== 'completed' && project.status !== 'archived' ? 'at_risk' : null;
  const combined: ProjectHealth | null =
    timeData || riskHealth ? worse(timeData?.health ?? 'on_track', riskHealth ?? 'on_track') : null;
  const data = combined ? { health: combined, expected: timeData?.expected ?? null, actual: timeData?.actual ?? null } : null;
  const mismatch = data !== null && data.health !== project.health;
  const [open, setOpen] = useState(false);
  const accept = useServerAction(postProjectUpdateAction, {
    invalidate: project.key ? [qk.project(project.key), qk.projects()] : [qk.projects()],
    successMessage: data ? `Health set to ${PROJECT_HEALTH_LABELS[data.health]}` : undefined,
    onSuccess: () => setOpen(false),
  });
  if (!mismatch || !data) return <HealthBadge health={project.health} size={size} />;
  const suggested = PROJECT_HEALTH_LABELS[data.health];
  const tone = HEALTH_TONE[data.health];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${PROJECT_HEALTH_LABELS[project.health]}, set by the owner. The data says ${suggested}. Show why`}
          title={`Set by the owner: ${PROJECT_HEALTH_LABELS[project.health]}. The data says ${suggested}.`}
          onClick={(event) => event.stopPropagation()}
          className="inline-flex min-w-0 items-center gap-1 rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          data-testid="health-mismatch"
        >
          <HealthBadge health={project.health} size={size} />
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed font-medium whitespace-nowrap',
              size === 'sm' ? 'h-5 px-1.5 text-2xs' : 'h-6 px-2 text-xs',
              tone === 'danger' ? 'border-danger/50 text-danger-text' : tone === 'warning' ? 'border-warning/60 text-warning-text' : 'border-success/50 text-success-text',
            )}
          >
            <HealthIcon health={data.health} />
            {size === 'sm' ? `Data: ${suggested}` : `Data says ${suggested}`}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72" onClick={(event) => event.stopPropagation()}>
        <p className="flex items-start gap-2 text-sm text-fg">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-text" />
          <span>
            The owner set <strong className="font-semibold">{PROJECT_HEALTH_LABELS[project.health]}</strong>. The data says <strong className="font-semibold">{suggested}</strong>
            {data.expected !== null && data.actual !== null ? `: ${data.expected}% of the time is used and ${data.actual}% of tasks are done.` : '.'}
          </span>
        </p>
        {risks.length ? (
          <ul className="mt-2 flex flex-col gap-1 border-t border-border-subtle pt-2 text-xs text-fg-secondary">
            {risks.slice(0, 4).map((risk) => (
              <li key={risk.id} className="flex items-start gap-1.5">
                <span aria-hidden className={cn('mt-1 size-1.5 shrink-0 rounded-full', risk.tone === 'danger' ? 'bg-danger' : 'bg-warning')} />
                {risk.text}
              </li>
            ))}
          </ul>
        ) : null}
        {canEdit && project.id ? (
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Keep {PROJECT_HEALTH_LABELS[project.health]}
            </Button>
            <Button size="sm" loading={accept.pending} onClick={() => void accept.run({ projectId: project.id as string, health: data.health, note: null })} data-testid="health-accept">
              Update status to {suggested}
            </Button>
          </div>
        ) : (
          <p className="mt-2 text-xs text-fg-muted">The project owner sets the health.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
