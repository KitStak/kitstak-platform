'use client';
/**
 * Project Overview: status updates (health + note, with history), progress and pace, the
 * description, a milestone timeline, recent activity, key details, people, goals this project
 * feeds, and linked CRM / warehouse records.
 */
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  BarChart3,
  Check,
  ExternalLink,
  Flag,
  Lock,
  Megaphone,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Target,
  Trash2,
  Users,
  X,
  Zap,
} from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Input,
  IsoDatePicker,
  ProgressBar,
  Select,
  Skeleton,
  Textarea,
  Tooltip,
  cn,
  toast,
} from '@/components/ui';
import { DueDate, EntityIcon, PersonAvatar } from '@/components/pm';
import { Panel } from '@/components/layout/page';
import { Customer360Strip } from '@/features/integrations/customer-360-strip';
import { PulseProfitStrip } from '@/features/integrations/pulse-profit-strip';
import {
  GOAL_HEALTH_LABELS,
  INTEGRATION_TARGET_LABELS,
  PROJECT_HEALTHS,
  PROJECT_HEALTH_LABELS,
  PROJECT_ROLE_LABELS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  type IntegrationTargetType,
  type ProjectHealth,
  type ProjectStatus,
} from '@/lib/constants';
import { describeActivity, describeActivityParts } from '@/lib/activity-text';
import { diffDays, formatRange, parseIsoDate, todayIso } from '@/lib/dates';
import { useServerAction } from '@/lib/hooks/use-action';
import { useIntegrationStatus, useProjectActivity, useProjectGoals, useProjectLinks, useProjectTasks, useProjectUpdates, useReport, useSpaces } from '@/lib/hooks/use-data';
import { usePeopleMap } from '@/lib/hooks/use-people';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { GoalDTO, IntegrationLinkDTO, MilestoneDTO, ProjectDetail, ProjectUpdateDTO } from '@/lib/types';
import type { ActivityPage } from '@/lib/hooks/use-data';
import type { Customer360 } from '@/server/integrations/customer360';
import { apiGet, apiPath } from '@/lib/api-client';
import { customer360Key } from '@/features/integrations/customer-360-strip';
import { addLinkAction, refreshLinksAction, removeLinkAction } from '@/server/actions/links';
import { postProjectUpdateAction } from '@/server/actions/portfolio';
import { updateProjectAction } from '@/server/actions/projects';
import { createMilestoneAction, deleteMilestoneAction, updateMilestoneAction } from '@/server/actions/structure';
import { LocalTime } from '@/features/task/local-time';
import { ProgressRing } from '@/features/dashboards/charts';
import { HEALTH_HELP, HealthIcon } from './health';
import { healthProgressTone } from '@/lib/health';
import { withoutUpdateEchoes } from './project-activity';
import { useCurrentProject } from './project-context';
import { ProjectDescription } from './project-description';
import { RecordPicker, TARGET_ICONS } from './record-picker';

const HEALTH_COLOR: Readonly<Record<ProjectHealth, string>> = { on_track: 'var(--success)', at_risk: 'var(--warning)', off_track: 'var(--danger)' };

function useRefreshProject() {
  const queryClient = useQueryClient();
  const { project } = useCurrentProject();
  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.project(project.key) });
    void queryClient.invalidateQueries({ queryKey: qk.projects() });
  };
}

// --- Status updates -------------------------------------------------------------------------

function HealthChoice({ value, onChange, disabled }: { readonly value: ProjectHealth; readonly onChange: (health: ProjectHealth) => void; readonly disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="How is it going?" className="grid grid-cols-3 gap-2">
      {PROJECT_HEALTHS.map((health) => {
        const checked = value === health;
        return (
          <button
            key={health}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(health)}
            data-testid={`health-${health}`}
            className={cn(
              'flex min-w-0 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left outline-none max-sm:px-2 transition-[border-color,background-color,box-shadow] duration-[var(--duration-fast)]',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:opacity-50',
              checked ? 'shadow-xs' : 'border-border-subtle bg-panel hover:border-border-default',
            )}
            style={checked ? { borderColor: HEALTH_COLOR[health], background: `color-mix(in srgb, ${HEALTH_COLOR[health]} 9%, var(--surface-panel))` } : undefined}
          >
            <span className="flex items-center gap-1.5 text-sm font-semibold whitespace-nowrap max-sm:gap-1" style={{ color: checked ? HEALTH_COLOR[health] : undefined }}>
              <HealthIcon health={health} className="size-4 shrink-0" />
              {PROJECT_HEALTH_LABELS[health]}
            </span>
            <span className="hidden truncate text-2xs text-fg-muted sm:block">{HEALTH_HELP[health]}</span>
          </button>
        );
      })}
    </div>
  );
}

function UpdateItem({ update, latest }: { readonly update: ProjectUpdateDTO; readonly latest?: boolean }) {
  const people = usePeopleMap();
  const author = update.authorId ? (people.get(update.authorId)?.name ?? 'Former member') : 'Automation';
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0" data-testid="project-update">
      <span aria-hidden className="absolute top-7 bottom-0 left-[11px] w-px bg-border-subtle group-last/updates:hidden" />
      <span className="relative z-[1] mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-white" style={{ background: HEALTH_COLOR[update.health] }}>
        <HealthIcon health={update.health} className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-fg-secondary">
          <span className="font-semibold text-fg">{author}</span> marked it <span className="font-medium" style={{ color: HEALTH_COLOR[update.health] }}>{PROJECT_HEALTH_LABELS[update.health].toLowerCase()}</span>
          {update.status ? <> and moved it to <span className="font-medium text-fg">{PROJECT_STATUS_LABELS[update.status]}</span></> : null}
          <span className="text-fg-muted"> · {update.progress}% done at the time · </span>
          <LocalTime iso={update.createdAt} className="text-fg-muted" />
          {latest ? <span className="ml-1.5 rounded-sm bg-primary-subtle px-1.5 py-px text-2xs font-semibold text-primary-text">Latest</span> : null}
        </p>
        {update.note ? <p className="mt-1 text-sm whitespace-pre-wrap text-fg">{update.note}</p> : null}
      </div>
    </li>
  );
}

function StatusUpdatesPanel({ project, canEdit }: { readonly project: ProjectDetail; readonly canEdit: boolean }) {
  const updates = useProjectUpdates(project.key);
  const [health, setHealth] = useState<ProjectHealth>(project.health);
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [note, setNote] = useState('');
  const [showAll, setShowAll] = useState(false);
  const post = useServerAction(postProjectUpdateAction, {
    invalidate: [qk.project(project.key), qk.projects()],
    successMessage: 'Update posted. The team will see it in their inbox.',
    onSuccess: () => setNote(''),
  });
  const list = updates.data ?? [];
  const shown = showAll ? list : list.slice(0, 3);
  const changed = health !== project.health || status !== project.status || note.trim().length > 0;

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Megaphone aria-hidden className="size-4 text-icon" />
          Status updates
        </span>
      }
    >
      {canEdit ? (
        <form
          className="flex flex-col gap-3"
          data-testid="status-update-form"
          onSubmit={(event) => {
            event.preventDefault();
            void post.run({ projectId: project.id, health, note: note.trim() || null, status: status !== project.status ? status : undefined });
          }}
        >
          <HealthChoice value={health} onChange={setHealth} />
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={2000} placeholder="What happened since the last update? Anything blocking you? What’s next?" aria-label="Update note" data-testid="status-update-note" />
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Project stage"
              size="md"
              value={status}
              onValueChange={(value) => setStatus(value as ProjectStatus)}
              options={PROJECT_STATUSES.filter((s) => s !== 'archived').map((s) => ({ value: s, label: PROJECT_STATUS_LABELS[s] }))}
              className="w-40"
            />
            <span className="text-xs text-fg-muted">Members get a note in their inbox.</span>
            <Button type="submit" className="ml-auto" loading={post.pending} disabled={!changed} data-testid="post-update">
              Post update
            </Button>
          </div>
        </form>
      ) : null}
      <div className={cn(canEdit && 'mt-4 border-t border-border-subtle pt-4')}>
        {updates.isPending ? (
          <Skeleton height={56} rounded="md" />
        ) : list.length === 0 ? (
          <p className="text-sm text-fg-muted">{project.healthNote ?? 'No updates yet. A short weekly update keeps everyone in the loop without a meeting.'}</p>
        ) : (
          <>
            <ol className="group/updates flex flex-col" aria-label="Update history">
              {shown.map((update, index) => (
                <UpdateItem key={update.id} update={update} latest={index === 0} />
              ))}
            </ol>
            {list.length > 3 ? (
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Show fewer' : `Show all ${list.length} updates`}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </Panel>
  );
}

// --- Progress --------------------------------------------------------------------------------

function Stat({ label, value, tone, hint }: { readonly label: string; readonly value: ReactNode; readonly tone?: 'danger' | 'success'; readonly hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-sunken px-3 py-2.5" title={hint}>
      <p className={cn('text-lg font-semibold tabular-nums', tone === 'danger' ? 'text-danger-text' : tone === 'success' ? 'text-success-text' : 'text-fg')}>{value}</p>
      <p className="truncate text-xs text-fg-muted">{label}</p>
    </div>
  );
}

// Same colour language as the ring: neutral ink when on track, amber at risk, red off track.
const HEALTH_BAR: Readonly<Record<ProjectHealth, string>> = { on_track: 'bg-[var(--logo-ink)]', at_risk: 'bg-warning', off_track: 'bg-danger' };

function ScheduleBar({ start, due, percent, health }: { readonly start: string | null; readonly due: string | null; readonly percent: number; readonly health: ProjectHealth }) {
  const today = todayIso();
  if (!start || !due || due <= start) return <p className="text-xs text-fg-muted">{formatRange(start, due) || 'No dates yet. Add a start and due date in Settings to track pace.'}</p>;
  const total = diffDays(start, due);
  const elapsed = Math.max(0, Math.min(total, diffDays(start, today)));
  const timePercent = Math.round((elapsed / total) * 100);
  const daysLeft = diffDays(today, due);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-2 rounded-full bg-sunken" role="img" aria-label={`${percent}% of tasks done, ${timePercent}% of the time used`}>
        <span className={cn('absolute inset-y-0 left-0 rounded-full transition-[width] duration-[var(--duration-slower)] motion-reduce:transition-none', HEALTH_BAR[health])} data-health={health} style={{ width: `${percent}%` }} />
        <span aria-hidden className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-fg" style={{ left: `calc(${timePercent}% - 1px)` }} />
      </div>
      <div className="flex items-center justify-between text-xs text-fg-muted">
        <span>{parseIsoDate(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        <span className="font-medium text-fg-secondary">
          {daysLeft > 0 ? `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left` : daysLeft === 0 ? 'Due today' : `${Math.abs(daysLeft)} ${Math.abs(daysLeft) === 1 ? 'day' : 'days'} past due`} · the line marks today
        </span>
        <span>{parseIsoDate(due).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
      </div>
    </div>
  );
}

function ProgressPanel({ project }: { readonly project: ProjectDetail }) {
  const report = useReport({ project: project.key });
  // The task cache is seeded with the page, so this number is there on first paint (the report,
  // which also draws the charts, streams in after).
  const tasks = useProjectTasks(project.key);
  const fromTasks = tasks.data ? tasks.data.filter((task) => !task.parentTaskId && task.statusCategory === 'in_progress').length : undefined;
  const data = report.data;
  const inProgress = fromTasks ?? data?.totals.inProgress;
  return (
    <Panel
      title="Progress"
      action={
        <Link href={`${routes.dashboards()}?project=${project.key}`} className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-fg-link outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus" data-testid="overview-reports-link">
          <BarChart3 aria-hidden className="size-4" />
          Reports
        </Link>
      }
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <ProgressRing percent={project.progress.percent} size={88} strokeWidth={8} label="Tasks done" tone={healthProgressTone(project.health)} />
        <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Tasks" value={project.progress.total} />
          <Stat label="In progress" value={inProgress === undefined ? '…' : inProgress} />
          <Stat label="Done" value={project.progress.done} tone={project.progress.done ? 'success' : undefined} />
          <Stat label="Overdue" value={project.progress.overdue} tone={project.progress.overdue ? 'danger' : undefined} />
        </div>
      </div>
      <div className="mt-4">
        <ScheduleBar start={project.startDate} due={project.dueDate} percent={project.progress.percent} health={project.health} />
      </div>
      {data ? (
        <p className="mt-3 text-xs text-fg-muted">
          This week: <strong className="font-semibold text-fg">{data.totals.completedThisWeek}</strong> finished, <strong className="font-semibold text-fg">{data.totals.createdThisWeek}</strong> added
          {data.totals.medianCycleDays !== null ? <> · tasks take about <strong className="font-semibold text-fg">{data.totals.medianCycleDays < 1 ? 'less than a day' : `${data.totals.medianCycleDays} days`}</strong></> : null}
        </p>
      ) : null}
    </Panel>
  );
}

// --- Milestones ------------------------------------------------------------------------------

function MilestoneTimeline({ milestones, start, due }: { readonly milestones: readonly MilestoneDTO[]; readonly start: string | null; readonly due: string | null }) {
  const dated = milestones.filter((m) => m.dueDate);
  const today = todayIso();
  const dates = [start, due, ...dated.map((m) => m.dueDate as string)].filter((d): d is string => Boolean(d)).sort();
  if (dated.length === 0 || dates.length < 2) return null;
  const from = dates[0] as string;
  const to = dates[dates.length - 1] as string;
  const span = Math.max(1, diffDays(from, to));
  const pos = (date: string) => `${Math.max(0, Math.min(100, (diffDays(from, date) / span) * 100))}%`;
  return (
    <div className="mb-4 px-2 pt-7 pb-6" aria-hidden data-testid="milestone-timeline">
      <div className="relative h-1.5 rounded-full bg-sunken">
        {today >= from && today <= to ? (
          <span className="absolute -top-2 -bottom-2 w-0.5 rounded-full bg-primary" style={{ left: pos(today) }}>
            <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-2xs font-semibold whitespace-nowrap text-primary-text">Today</span>
          </span>
        ) : null}
        {dated.map((milestone, index) => {
          const done = Boolean(milestone.completedAt);
          const late = !done && (milestone.dueDate as string) < today;
          return (
            <span key={milestone.id} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: pos(milestone.dueDate as string) }}>
              <span
                className={cn('block size-3 rotate-45 rounded-[2px] border-2', done ? 'border-success bg-success' : late ? 'border-danger bg-danger' : 'border-[var(--label-blue)] bg-panel')}
              />
              <span className={cn('absolute left-1/2 max-w-28 -translate-x-1/2 truncate text-2xs whitespace-nowrap text-fg-secondary', index % 2 ? 'bottom-4' : 'top-4')}>{milestone.name}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function MilestonesPanel({ project, canEdit }: { readonly project: ProjectDetail; readonly canEdit: boolean }) {
  const refresh = useRefreshProject();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState<string | null>(null);
  const create = useServerAction(createMilestoneAction, {
    successMessage: 'Milestone added',
    onSuccess: () => {
      setName('');
      setDate(null);
      setAdding(false);
      refresh();
    },
  });
  const run = async (promise: Promise<{ ok: boolean; error?: { message: string } }>, success: string) => {
    const result = await promise;
    if (!result.ok) {
      toast.error("Couldn't update the milestone", result.error?.message);
      return;
    }
    toast.success(success);
    refresh();
  };
  const sorted = [...project.milestones].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Flag aria-hidden className="size-4 text-icon" />
          Milestones
        </span>
      }
      action={
        canEdit && !adding ? (
          <Button variant="ghost" size="sm" leadingIcon={<Plus aria-hidden />} onClick={() => setAdding(true)} data-testid="add-milestone">
            Add
          </Button>
        ) : null
      }
    >
      <MilestoneTimeline milestones={sorted} start={project.startDate} due={project.dueDate} />
      {adding ? (
        <form
          className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-sunken/50 p-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) void create.run({ projectId: project.id, name: name.trim(), dueDate: date });
          }}
        >
          <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Milestone name, e.g. Go live" aria-label="Milestone name" containerClassName="min-w-0 flex-1 basis-48" maxLength={120} data-testid="milestone-name" />
          <div className="w-40">
            <IsoDatePicker value={date} onChange={setDate} placeholder="Pick a date" aria-label="Milestone date" />
          </div>
          <Button type="submit" size="md" loading={create.pending} disabled={!name.trim()}>
            Add
          </Button>
          <IconButton label="Cancel" icon={<X aria-hidden />} onClick={() => setAdding(false)} />
        </form>
      ) : null}
      {sorted.length === 0 && !adding ? (
        <p className="text-sm text-fg-muted">No milestones yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle">
          {sorted.map((milestone) => {
            const done = Boolean(milestone.completedAt);
            const percent = milestone.taskCount ? Math.round((milestone.doneCount / milestone.taskCount) * 100) : done ? 100 : 0;
            return (
              <li key={milestone.id} className="group flex items-center gap-3 py-2.5" data-testid="milestone-row">
                <Tooltip content={done ? 'Mark as not reached' : 'Mark as reached'} disabled={!canEdit}>
                  <button
                    type="button"
                    disabled={!canEdit}
                    aria-label={done ? `Mark ${milestone.name} as not reached` : `Mark ${milestone.name} as reached`}
                    aria-pressed={done}
                    onClick={() => void run(updateMilestoneAction({ milestoneId: milestone.id, patch: { completed: !done } }), done ? 'Milestone reopened' : `Nice! ${milestone.name} reached`)}
                    className={cn(
                      'inline-flex size-6 shrink-0 items-center justify-center rounded-full border outline-none transition-colors focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-default',
                      done ? 'border-success bg-success text-white' : 'border-border-strong text-transparent hover:border-success hover:text-success',
                    )}
                  >
                    <Check aria-hidden className="size-3.5" strokeWidth={3} />
                  </button>
                </Tooltip>
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate text-sm font-medium', done ? 'text-fg-muted line-through' : 'text-fg')}>{milestone.name}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <ProgressBar value={percent} size="sm" tone={done ? 'success' : 'primary'} label={`${milestone.name} progress`} className="max-w-40 flex-1" />
                    <span className="text-xs text-fg-muted tabular-nums">
                      {milestone.taskCount ? `${milestone.doneCount}/${milestone.taskCount} tasks` : 'No tasks linked'}
                    </span>
                  </div>
                </div>
                {milestone.dueDate ? <DueDate date={milestone.dueDate} done={done} /> : <span className="text-xs text-fg-muted">No date</span>}
                {canEdit ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton label={`More for ${milestone.name}`} icon={<MoreHorizontal aria-hidden />} size="sm" className="opacity-70 group-hover:opacity-100" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem icon={<Check aria-hidden />} onSelect={() => void run(updateMilestoneAction({ milestoneId: milestone.id, patch: { completed: !done } }), done ? 'Milestone reopened' : 'Milestone reached')}>
                        {done ? 'Mark as not reached' : 'Mark as reached'}
                      </DropdownMenuItem>
                      <DropdownMenuItem icon={<Trash2 aria-hidden />} variant="danger" onSelect={() => void run(deleteMilestoneAction({ milestoneId: milestone.id }), `Deleted ${milestone.name}`)}>
                        Delete milestone
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// --- Activity --------------------------------------------------------------------------------

function RecentActivity({ project }: { readonly project: ProjectDetail }) {
  const { statusById, labelById } = useCurrentProject();
  const activity = useProjectActivity(project.key);
  const tasks = useProjectTasks(project.key);
  const people = usePeopleMap();
  const { openTask } = useTaskDrawer();
  const taskById = useMemo(() => new Map((tasks.data ?? []).map((t) => [t.id, t])), [tasks.data]);
  const items = withoutUpdateEchoes(activity.data?.items ?? []).slice(0, 7);
  return (
    <Panel
      title="Recent activity"
      action={
        <Link href={routes.projectTab(project.key, 'activity')} className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-fg-link outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus">
          See all <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      }
    >
      {activity.isPending ? (
        <Skeleton height={120} rounded="md" />
      ) : items.length === 0 ? (
        <p className="text-sm text-fg-muted">Nothing yet. Changes to tasks and the project show up here.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {items.map((event) => {
            const task = event.taskId ? taskById.get(event.taskId) : undefined;
            return (
              <li key={event.id} className="flex gap-2.5 text-sm">
                {event.actorKind === 'automation' ? (
                  <span aria-hidden className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary-text">
                    <Zap className="size-3" />
                  </span>
                ) : (
                  <PersonAvatar userId={event.actorId} size="xs" className="mt-0.5" />
                )}
                <p className="min-w-0 flex-1 text-fg-secondary">
                  <span className="font-medium text-fg">{event.actorId ? (people.get(event.actorId)?.name ?? 'Someone') : 'Automation'}</span>{' '}
                  {task ? (
                    (() => {
                      const parts = describeActivityParts(event, { statusName: (id) => statusById.get(id)?.name, personName: (id) => people.get(id)?.name, labelName: (id) => labelById.get(id)?.name });
                      return (
                        <>
                          {parts.before}{' '}
                          <button type="button" data-task-key={task.key} onClick={() => openTask(task.key)} className="rounded-sm font-medium text-fg-link outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus">
                            {task.title}
                          </button>
                          {parts.after ? ` ${parts.after}` : null}
                        </>
                      );
                    })()
                  ) : (
                    describeActivity(event, { statusName: (id) => statusById.get(id)?.name, personName: (id) => people.get(id)?.name, labelName: (id) => labelById.get(id)?.name })
                  )}
                  <span className="text-fg-muted"> · </span>
                  <LocalTime iso={event.createdAt} className="text-xs text-fg-muted" />
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

// --- Sidebar panels -------------------------------------------------------------------------

function DetailRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3 text-sm">
      <dt className="shrink-0 text-fg-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right text-fg">{children}</dd>
    </div>
  );
}

function DetailsPanel({ project, canEdit }: { readonly project: ProjectDetail; readonly canEdit: boolean }) {
  const spaces = useSpaces();
  const space = project.spaceId ? (spaces.data ?? []).find((s) => s.id === project.spaceId) : undefined;
  return (
    <Panel
      title="Details"
      action={
        canEdit ? (
          <Link href={routes.projectTab(project.key, 'settings')} className="text-sm font-medium text-fg-link hover:underline">
            Edit
          </Link>
        ) : null
      }
    >
      <dl className="flex flex-col">
        <DetailRow label="Owner">
          <PersonAvatar userId={project.ownerId} size="xs" showName />
        </DetailRow>
        <DetailRow label="Stage">{PROJECT_STATUS_LABELS[project.status]}</DetailRow>
        <DetailRow label="Dates">{formatRange(project.startDate, project.dueDate) || 'Not set'}</DetailRow>
        <DetailRow label="Space">
          {space ? (
            <Link href={`${routes.projects()}?space=${space.id}`} className="inline-flex items-center gap-1.5 hover:underline">
              <EntityIcon icon={space.icon} color={space.color} size={16} />
              {space.name}
            </Link>
          ) : (
            'None'
          )}
        </DetailRow>
        <DetailRow label="Who can see it">
          <span className="inline-flex items-center gap-1">
            {project.visibility === 'private' ? <Lock aria-hidden className="size-3.5 text-icon" /> : <Users aria-hidden className="size-3.5 text-icon" />}
            {project.visibility === 'private' ? 'Only members' : 'Whole workspace'}
          </span>
        </DetailRow>
        <DetailRow label="Key">
          <span className="font-key" title={`Tasks are numbered ${project.key}-1, ${project.key}-2 and so on`}>{project.key}</span>
        </DetailRow>
      </dl>
    </Panel>
  );
}

function PeoplePanel({ project }: { readonly project: ProjectDetail }) {
  const { capabilities } = useCurrentProject();
  const shown = project.members.slice(0, 8);
  return (
    <Panel
      title={`People (${project.members.length})`}
      action={
        capabilities['project:manage_members'] ? (
          <Link href={`${routes.projectTab(project.key, 'settings')}?section=members`} className="text-sm font-medium text-fg-link hover:underline">
            Manage
          </Link>
        ) : null
      }
    >
      <ul className="flex flex-col gap-2">
        {shown.map((member) => (
          <li key={member.userId} className="flex items-center justify-between gap-2">
            <PersonAvatar userId={member.userId} showName className="min-w-0" />
            <span className="shrink-0 text-xs text-fg-muted">{PROJECT_ROLE_LABELS[member.role]}</span>
          </li>
        ))}
      </ul>
      {project.members.length > shown.length ? <p className="mt-2 text-xs text-fg-muted">and {project.members.length - shown.length} more</p> : null}
    </Panel>
  );
}

function GoalsPanel({ project }: { readonly project: ProjectDetail }) {
  const goals = useProjectGoals(project.key);
  const list = goals.data ?? [];
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Target aria-hidden className="size-4 text-icon" />
          Goals
        </span>
      }
      action={
        <Link href={routes.goals()} className="text-sm font-medium text-fg-link hover:underline">
          All goals
        </Link>
      }
    >
      {goals.isPending ? (
        <Skeleton height={40} rounded="md" />
      ) : list.length === 0 ? (
        <p className="text-sm text-fg-muted">Not linked to a goal yet. Link it from the Goals page.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((goal) => (
            <li key={goal.id}>
              <Link href={routes.goal(goal.id)} className="block rounded-md outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium text-fg">{goal.name}</span>
                  <span className="shrink-0 text-xs text-fg-muted">{GOAL_HEALTH_LABELS[goal.health]}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <ProgressBar value={goal.progress} size="sm" label={`${goal.name} progress`} className="flex-1" />
                  <span className="w-9 text-right text-xs font-medium text-fg tabular-nums">{goal.progress}%</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function LinksPanel({ project, canEdit }: { readonly project: ProjectDetail; readonly canEdit: boolean }) {
  const links = useProjectLinks(project.key);
  const status = useIntegrationStatus();
  const queryClient = useQueryClient();
  const types = (status.data?.targetTypes ?? ['core_customer']) as IntegrationTargetType[];
  const [type, setType] = useState<IntegrationTargetType>('core_customer');
  const activeType = types.includes(type) ? type : (types[0] ?? 'core_customer');
  const list = links.data ?? [];
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: qk.projectLinks(project.key) });
  };
  const add = useServerAction(addLinkAction, { successMessage: 'Linked', onSuccess: invalidate });
  const remove = async (id: string, title: string) => {
    const result = await removeLinkAction({ linkId: id });
    if (!result.ok) {
      toast.error("Couldn't remove the link", result.error.message);
      return;
    }
    invalidate();
    toast.success(`Unlinked ${title}`);
  };
  const refresh = async () => {
    const result = await refreshLinksAction({ projectId: project.id });
    if (result.ok) {
      invalidate();
      toast.success('Linked records are up to date');
    } else toast.error("Couldn't refresh", result.error.message);
  };

  return (
    <Panel
      title="Linked records"
      action={list.length ? <IconButton label="Refresh linked records" icon={<RefreshCw aria-hidden />} size="sm" onClick={() => void refresh()} /> : null}
    >
      {links.isPending ? (
        <Skeleton height={40} rounded="md" />
      ) : list.length === 0 ? (
        <p className="mb-3 text-sm text-fg-muted">Connect the customer, CRM deal or warehouse orders this project is for.</p>
      ) : (
        <ul className="mb-3 flex flex-col gap-1" data-testid="project-links">
          {list.map((link) => (
            <li key={link.id} className="group flex items-center gap-2 rounded-md py-1 text-sm">
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-sunken text-icon [&_svg]:size-4">{TARGET_ICONS[link.targetType]}</span>
              <div className="min-w-0 flex-1">
                {link.url ? (
                  <a href={link.url} className="flex min-w-0 items-center gap-1 font-medium text-fg-link hover:underline">
                    <span className="truncate">{link.title ?? link.targetId}</span>
                    <ExternalLink aria-hidden className="size-3 shrink-0" />
                  </a>
                ) : (
                  <span className="block truncate font-medium text-fg">{link.title ?? link.targetId}</span>
                )}
                <span className="block truncate text-xs text-fg-muted">
                  {INTEGRATION_TARGET_LABELS[link.targetType]}
                  {link.status ? ` · ${link.status}` : ''}
                </span>
              </div>
              {canEdit ? (
                <IconButton label={`Unlink ${link.title ?? 'record'}`} icon={<X aria-hidden />} size="sm" className="opacity-60 group-hover:opacity-100" onClick={() => void remove(link.id, link.title ?? 'record')} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
          <Select size="sm" aria-label="What to link" value={activeType} onValueChange={(value) => setType(value as IntegrationTargetType)} options={types.map((t) => ({ value: t, label: INTEGRATION_TARGET_LABELS[t] }))} />
          <RecordPicker
            type={activeType}
            value={null}
            excludeIds={list.filter((l) => l.targetType === activeType).map((l) => l.targetId)}
            onChange={(record) => {
              if (record) void add.run({ projectId: project.id, targetType: record.type, targetId: record.id });
            }}
            placeholder={`Link a ${INTEGRATION_TARGET_LABELS[activeType].toLowerCase()}`}
            className="h-8"
          />
        </div>
      ) : null}
    </Panel>
  );
}

// --- Page -------------------------------------------------------------------------------------

/** Overview data loaded on the server with the page, so its sections paint without skeletons. */
export interface OverviewInitial {
  readonly loadedAt: number;
  readonly updates?: readonly ProjectUpdateDTO[];
  readonly activity?: ActivityPage;
  readonly links?: readonly IntegrationLinkDTO[];
  readonly goals?: readonly GoalDTO[];
  readonly integrationStatus?: { readonly crm: boolean; readonly wms: boolean; readonly targetTypes: readonly IntegrationTargetType[] };
  readonly customer360?: Customer360 | null;
}

/** Seeds the Overview queries (notifyOnChangeProps: [] so it never re-renders). */
function SeedOverview({ projectKey, initial }: { readonly projectKey: string; readonly initial: OverviewInitial }) {
  const at = initial.loadedAt;
  const seed = { initialDataUpdatedAt: at, notifyOnChangeProps: [] as [] };
  useProjectUpdates(projectKey, { initialData: initial.updates ? [...initial.updates] : undefined, ...seed });
  useProjectActivity(projectKey, { initialData: initial.activity, ...seed });
  useProjectLinks(projectKey, { initialData: initial.links ? [...initial.links] : undefined, ...seed });
  useProjectGoals(projectKey, { initialData: initial.goals ? [...initial.goals] : undefined, ...seed });
  useIntegrationStatus({ initialData: initial.integrationStatus ? { ...initial.integrationStatus, targetTypes: [...initial.integrationStatus.targetTypes] } : undefined, ...seed });
  useQuery({
    queryKey: customer360Key(projectKey),
    queryFn: () => apiGet<Customer360>(apiPath(`projects/${encodeURIComponent(projectKey)}/customer-360`)),
    initialData: initial.customer360 ?? undefined,
    staleTime: 30_000,
    ...seed,
  });
  return null;
}

export function ProjectOverview({ initial }: { readonly initial?: OverviewInitial } = {}) {
  const { project, capabilities } = useCurrentProject();
  const refresh = useRefreshProject();
  const canEdit = capabilities['project:update'];

  const saveDescription = async (html: string | null) => {
    const result = await updateProjectAction({ projectId: project.id, patch: { description: html } });
    if (!result.ok) {
      toast.error("Couldn't save the description", result.error.message);
      return false;
    }
    refresh();
    toast.success('Description saved');
    return true;
  };

  return (
    <div className="mx-auto grid w-full max-w-[1240px] grid-cols-1 gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]" data-testid="project-overview">
      {initial ? <SeedOverview projectKey={project.key} initial={initial} /> : null}
      {project.archivedAt ? (
        <div className="flex items-center gap-3 rounded-lg border border-warning bg-warning-subtle px-4 py-3 text-sm text-warning-text lg:col-span-2">
          <span className="flex-1">This project is archived. It’s read-only in lists and reports until you restore it.</span>
          {canEdit ? (
            <Link href={routes.projectTab(project.key, 'settings')}>
              <Button size="sm" variant="secondary">
                Restore in Settings
              </Button>
            </Link>
          ) : null}
        </div>
      ) : null}
      <Customer360Strip projectKey={project.key} projectId={project.id} canEdit={canEdit} />
      <PulseProfitStrip projectKey={project.key} canEdit={canEdit} />
      <div className="flex min-w-0 flex-col gap-5">
        <StatusUpdatesPanel key={`${project.health}-${project.status}`} project={project} canEdit={canEdit} />
        <ProgressPanel project={project} />
        <Panel title="About this project">
          <ProjectDescription html={project.description} canEdit={canEdit} onSave={saveDescription} />
        </Panel>
        <MilestonesPanel project={project} canEdit={canEdit} />
        <RecentActivity project={project} />
      </div>
      <div className="flex min-w-0 flex-col gap-5">
        <DetailsPanel project={project} canEdit={canEdit} />
        <PeoplePanel project={project} />
        <LinksPanel project={project} canEdit={canEdit} />
        <GoalsPanel project={project} />
      </div>
    </div>
  );
}
