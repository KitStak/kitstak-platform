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
import { HEALTH_DOT_CLASS, healthHint, projectHealth } from '@/lib/health';
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
 * What the numbers say when they disagree with the owner: share of time passed vs share of tasks
 * done. `null` when they agree, or when there is nothing to compare (no dates, not started, done).
 * Thin wrapper over `projectHealth` in `@/lib/health`, the single source of truth.
 */
export function dataHealth(project: HealthInputs, today: string = todayIso()): { readonly health: ProjectHealth; readonly expected: number; readonly actual: number } | null {
  const view = projectHealth(project, today);
  if (view.expected === null) return null;
  return { health: view.suggested ?? view.health, expected: view.expected, actual: view.actual };
}

/** True when the owner's health and the numbers disagree (the amber dot, "needs a status check"). */
export function healthMismatch(project: HealthInputs, today?: string): boolean {
  return projectHealth(project, today).suggested !== null;
}

/** The amber "numbers disagree" dot, drawn on top of a chip or a health dot. */
function MismatchDot({ size }: { readonly size: 'xs' | 'sm' | 'md' }) {
  return (
    <span
      aria-hidden
      data-testid="health-mismatch-dot"
      className={cn('absolute -top-0.5 -right-0.5 rounded-full bg-warning ring-2 ring-[var(--surface-panel)]', size === 'xs' ? 'size-1.5 ring-1' : size === 'sm' ? 'size-2' : 'size-2.5')}
    />
  );
}

/**
 * Static (non-interactive) version of the health chip, for places that sit inside a link (search
 * results). Same chip, same amber dot, same words as the header.
 */
export function ProjectHealthMark({ project, size = 'sm', className }: { readonly project: HealthInputs; readonly size?: 'sm' | 'md'; readonly className?: string }) {
  const view = projectHealth(project);
  const hint = healthHint(view);
  return (
    <span className={cn('relative inline-flex shrink-0', className)} title={hint ?? undefined} data-testid={hint ? 'health-mismatch' : 'health-chip'} data-health={view.health}>
      <HealthBadge health={view.health} size={size} />
      {hint ? <MismatchDot size={size} /> : null}
      {hint ? <span className="sr-only">. {hint}</span> : null}
    </span>
  );
}

/**
 * Compact health dot: the owner's colour. With `showHint`, the amber dot rides on it when the
 * numbers disagree (Goals project chips). The sidebar passes `hideOnTrack` and no hint: it is
 * navigation, so it only marks projects whose owner says At risk or Off track.
 */
export function ProjectHealthDot({ project, hideOnTrack = false, showHint = true }: { readonly project: HealthInputs; readonly hideOnTrack?: boolean; readonly showHint?: boolean }) {
  const view = projectHealth(project);
  const hint = showHint ? healthHint(view) : null;
  if (hideOnTrack && view.health === 'on_track' && !hint) return null;
  const label = `${PROJECT_HEALTH_LABELS[view.health]}${hint ? `. ${hint}` : ''}`;
  return (
    <span role="img" aria-label={label} title={label} className="relative inline-flex size-2 shrink-0 items-center justify-center" data-testid="health-dot" data-health={view.health} data-suggested={view.suggested ?? undefined}>
      <span className={cn('size-1.5 rounded-full', HEALTH_DOT_CLASS[view.health])} />
      {hint ? <MismatchDot size="xs" /> : null}
    </span>
  );
}

/**
 * One truth for health: the owner's chip, and only that chip. When the numbers (time used vs
 * tasks done) disagree, a small amber dot sits on the chip with a tooltip ("Numbers suggest At
 * risk · Update status"); clicking explains why and, for editors, updates the status in one click.
 * Customer 360 risks (late receipts, inventory exceptions) never change the project's health: they
 * are listed in the same popover as a separate customer note.
 */
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
  /** Customer 360 risks: listed as a customer note, never a health change. */
  readonly risks?: readonly HealthRisk[];
}) {
  // What the numbers say: time used vs work done. Customer risks are a separate note, not health.
  const view = projectHealth(project);
  const data = view.suggested && view.expected !== null ? { health: view.suggested, expected: view.expected, actual: view.actual } : null;
  const mismatch = data !== null;
  const liveRisks = project.status === 'completed' || project.status === 'archived' ? [] : risks;
  const [open, setOpen] = useState(false);
  const accept = useServerAction(postProjectUpdateAction, {
    invalidate: project.key ? [qk.project(project.key), qk.projects()] : [qk.projects()],
    successMessage: data ? `Health set to ${PROJECT_HEALTH_LABELS[data.health]}` : undefined,
    onSuccess: () => setOpen(false),
  });
  if ((!mismatch || !data) && liveRisks.length === 0) return <HealthBadge health={project.health} size={size} />;
  const suggested = mismatch && data ? PROJECT_HEALTH_LABELS[data.health] : null;
  const owner = PROJECT_HEALTH_LABELS[project.health];
  const tip = suggested
    ? `Numbers suggest ${suggested} · ${canEdit && project.id ? 'Update status' : 'Show why'}`
    : `${liveRisks.length === 1 ? '1 customer note' : `${liveRisks.length} customer notes`} · Show`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={suggested ? `${owner}, set by the owner. Numbers suggest ${suggested}. Show why` : `${owner}. ${tip}`}
          title={tip}
          onClick={(event) => event.stopPropagation()}
          className="relative inline-flex min-w-0 items-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          data-testid={suggested ? 'health-mismatch' : 'health-chip'}
        >
          <HealthBadge health={project.health} size={size} />
          {suggested ? <MismatchDot size={size} /> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72" onClick={(event) => event.stopPropagation()}>
        {suggested && data ? (
          <p className="flex items-start gap-2 text-sm text-fg">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-text" />
            <span>
              The owner set <strong className="font-semibold">{owner}</strong>. The numbers suggest <strong className="font-semibold">{suggested}</strong>: {data.expected}% of the time is used and {data.actual}% of tasks are done.
            </span>
          </p>
        ) : (
          <p className="text-sm text-fg">
            Health is <strong className="font-semibold">{owner}</strong>, set by the owner.
          </p>
        )}
        {liveRisks.length ? (
          <div className="mt-2 border-t border-border-subtle pt-2" data-testid="health-customer-notes">
            <p className="text-xs font-semibold text-fg-secondary">Customer notes</p>
            <ul className="mt-1 flex flex-col gap-1 text-xs text-fg-secondary">
              {liveRisks.slice(0, 4).map((risk) => (
                <li key={risk.id} className="flex items-start gap-1.5">
                  <span aria-hidden className={cn('mt-1 size-1.5 shrink-0 rounded-full', risk.tone === 'danger' ? 'bg-danger' : 'bg-warning')} />
                  {risk.text}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {suggested && data && canEdit && project.id ? (
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Keep {owner}
            </Button>
            <Button size="sm" loading={accept.pending} onClick={() => void accept.run({ projectId: project.id as string, health: data.health, note: null })} data-testid="health-accept">
              Update status to {suggested}
            </Button>
          </div>
        ) : suggested ? (
          <p className="mt-2 text-xs text-fg-muted">The project owner sets the health.</p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
