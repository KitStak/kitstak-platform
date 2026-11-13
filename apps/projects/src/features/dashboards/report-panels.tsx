'use client';
/**
 * Report building blocks shared by Dashboards (portfolio + per project) and the project
 * Overview: KPI tiles, burn-up/burn-down, status donut, velocity, cycle time, workload,
 * overdue by person and "finished this week". All read a `ReportDTO` from `useReport()`.
 */
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { AlarmClock, CheckCircle2, CircleDashed, Gauge, Inbox, TrendingDown, TrendingUp, Timer, UserX } from 'lucide-react';
import { ToggleGroup, Tooltip, cn } from '@/components/ui';
import { PersonAvatar } from '@/components/pm';
import { Panel } from '@/components/layout/page';
import { shortDate } from '@/lib/report-math';
import type { ReportDTO } from '@/lib/types';
import { LocalTime } from '@/features/task/local-time';
import { ColumnChart, DonutChart, LineChart, StackedBars } from './charts';

export const SERIES = {
  scope: 'var(--chart-1)',
  done: 'var(--label-green)',
  remaining: 'var(--chart-1)',
  ideal: 'var(--chart-5)',
  velocity: 'var(--chart-2)',
  cycle: 'var(--chart-4)',
  inProgress: 'var(--label-blue)',
  todo: 'var(--label-gray)',
  overdue: 'var(--danger)',
} as const;

const days = (value: number | null) => (value === null ? 'No data' : value < 1 ? '<1 day' : `${value} ${value === 1 ? 'day' : 'days'}`);

function Kpi({
  label,
  value,
  hint,
  icon,
  tone,
  help,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly hint?: ReactNode;
  readonly icon: ReactNode;
  readonly tone?: 'danger' | 'success' | 'warning';
  readonly help: string;
}) {
  return (
    <Tooltip content={help} side="bottom">
      <div tabIndex={0} className="flex min-w-0 flex-col gap-1 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs outline-none focus-visible:outline-2 focus-visible:outline-focus" data-testid="report-kpi">
        <div className="flex items-center gap-2 text-xs font-medium text-fg-muted">
          <span className={cn('inline-flex size-6 items-center justify-center rounded-md bg-sunken text-icon [&_svg]:size-3.5', tone === 'danger' && 'bg-danger-subtle text-danger-text', tone === 'success' && 'bg-success-subtle text-success-text', tone === 'warning' && 'bg-warning-subtle text-warning-text')}>{icon}</span>
          <span className="truncate">{label}</span>
        </div>
        <p className={cn('text-2xl font-semibold tracking-[-0.01em] tabular-nums', tone === 'danger' ? 'text-danger-text' : 'text-fg')}>{value}</p>
        {hint ? <p className="truncate text-xs text-fg-muted">{hint}</p> : null}
      </div>
    </Tooltip>
  );
}

export function KpiTiles({ report }: { readonly report: ReportDTO }) {
  const t = report.totals;
  const delta = t.completedThisWeek - t.completedLastWeek;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="report-kpis">
      <Kpi label="Open tasks" value={t.open} hint={`${t.inProgress} being worked on`} icon={<CircleDashed aria-hidden />} help="Tasks that are not done yet, the same count as the Portal tile. Subtasks count with their parent task." />
      <Kpi
        label="Done this week"
        value={t.completedThisWeek}
        tone={t.completedThisWeek > 0 ? 'success' : undefined}
        hint={
          <span className="inline-flex items-center gap-1">
            {delta > 0 ? <TrendingUp aria-hidden className="size-3 text-success-text" /> : delta < 0 ? <TrendingDown aria-hidden className="size-3 text-danger-text" /> : null}
            {delta === 0 ? 'Same as last week' : `${Math.abs(delta)} ${delta > 0 ? 'more' : 'fewer'} than last week`}
          </span>
        }
        icon={<CheckCircle2 aria-hidden />}
        help="Tasks finished since Monday, compared with all of last week."
      />
      <Kpi label="Overdue" value={t.overdue} tone={t.overdue ? 'danger' : undefined} hint={t.overdue ? 'Past their due date' : 'Nothing is late'} icon={<AlarmClock aria-hidden />} help="Open tasks whose due date has passed." />
      <Kpi label="Finished per week" value={t.averageVelocity} hint="Average per full week" icon={<Gauge aria-hidden />} help="How many tasks the team finishes in a normal week (velocity)." />
      <Kpi label="Time to finish" value={days(t.medianCycleDays)} hint="Typical task" icon={<Timer aria-hidden />} help="Median days from when work starts (or the task is created) until it is done (cycle time)." />
      <Kpi label="Unassigned" value={t.unassigned} tone={t.unassigned ? 'warning' : undefined} hint={t.unassigned ? 'Need an owner' : 'Everyone has an owner'} icon={<UserX aria-hidden />} help="Open tasks nobody is assigned to yet." />
    </div>
  );
}

export function BurnPanel({ report, className }: { readonly report: ReportDTO; readonly className?: string }) {
  const [mode, setMode] = useState<'up' | 'down'>('up');
  const labels = report.burn.map((point) => point.date);
  const todayIndex = labels.findIndex((date) => date >= report.today);
  const hasIdeal = report.burn.some((point) => point.ideal !== null);
  const series =
    mode === 'up'
      ? [
          { id: 'scope', label: 'Total work', color: SERIES.scope, values: report.burn.map((p) => p.scope), dashed: false },
          { id: 'done', label: 'Done', color: SERIES.done, values: report.burn.map((p) => p.done), area: true },
        ]
      : [
          { id: 'remaining', label: 'Work left', color: SERIES.remaining, values: report.burn.map((p) => p.remaining), area: true },
          ...(hasIdeal ? [{ id: 'ideal', label: 'On-time pace', color: SERIES.ideal, values: report.burn.map((p) => p.ideal), dashed: true }] : []),
        ];
  return (
    <Panel
      className={className}
      title={mode === 'up' ? 'Burn-up' : 'Burn-down'}
      action={
        <ToggleGroup
          className="-my-1"
          label="Chart type"
          size="sm"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'up', label: 'Burn-up' },
            { value: 'down', label: 'Burn-down' },
          ]}
        />
      }
    >
      <p className="mb-3 text-sm text-fg-secondary">
        {mode === 'up'
          ? 'The green line climbs as tasks get done. When it meets the blue line, everything is finished.'
          : hasIdeal
            ? 'Work left should fall toward zero by the due date. Stay under the dashed line to finish on time.'
            : 'Work left should fall toward zero. Add a due date to the project to see an on-time pace line.'}
      </p>
      <LineChart
        title={mode === 'up' ? 'Burn-up: total work and done' : 'Burn-down: work left'}
        series={series}
        labels={labels}
        formatLabel={shortDate}
        markerIndex={report.to > report.today && todayIndex >= 0 ? todayIndex : null}
        valueSuffix=" tasks"
      />
    </Panel>
  );
}

export function StatusPanel({ report, className }: { readonly report: ReportDTO; readonly className?: string }) {
  return (
    <Panel className={className} title="Where tasks are">
      <DonutChart
        title="Tasks by status"
        slices={report.statusDistribution.map((slice) => ({ id: slice.id, label: slice.name, value: slice.count, color: `var(--label-${slice.color})` }))}
      />
    </Panel>
  );
}

export function VelocityPanel({ report, className }: { readonly report: ReportDTO; readonly className?: string }) {
  const [unit, setUnit] = useState<'tasks' | 'points'>('tasks');
  const hasPoints = report.weeks.some((week) => week.points > 0);
  const current = report.weeks.length - 1;
  const values = report.weeks.map((week) => (unit === 'tasks' ? week.completed : week.points));
  const full = values.slice(0, -1);
  const average = full.length ? Math.round((full.reduce((sum, v) => sum + v, 0) / full.length) * 10) / 10 : 0;
  return (
    <Panel
      className={className}
      title="Velocity"
      action={
        hasPoints ? (
          <ToggleGroup
            className="-my-1"
            label="Count"
            size="sm"
            value={unit}
            onValueChange={setUnit}
            options={[
              { value: 'tasks', label: 'Tasks' },
              { value: 'points', label: 'Points' },
            ]}
          />
        ) : null
      }
    >
      <p className="mb-3 text-sm text-fg-secondary">{unit === 'tasks' ? 'Tasks finished each week.' : 'Story points finished each week.'} The dashed line is the weekly average.</p>
      <ColumnChart
        title={`Velocity: ${unit} finished per week`}
        color={SERIES.velocity}
        reference={average > 0 ? { value: average, label: `Avg ${average}` } : null}
        data={report.weeks.map((week, index) => ({
          id: week.weekStart,
          label: index === current ? 'This wk' : shortDate(week.weekStart),
          value: values[index] ?? 0,
          highlight: index === current,
          description: `Week of ${shortDate(week.weekStart)}: ${week.completed} ${week.completed === 1 ? 'task' : 'tasks'} finished${hasPoints ? `, ${week.points} points` : ''}, ${week.created} added`,
        }))}
      />
    </Panel>
  );
}

export function CycleTimePanel({ report, className }: { readonly report: ReportDTO; readonly className?: string }) {
  const current = report.weeks.length - 1;
  return (
    <Panel className={className} title="Time to finish">
      <p className="mb-3 text-sm text-fg-secondary">
        Typical days from starting a task to finishing it. Lower is faster. {report.totals.medianCycleDays !== null ? <>Overall: <strong className="font-semibold text-fg">{days(report.totals.medianCycleDays)}</strong>.</> : null}
      </p>
      <ColumnChart
        title="Cycle time: median days to finish per week"
        color={SERIES.cycle}
        formatValue={(value) => `${value}d`}
        data={report.weeks.map((week, index) => ({
          id: week.weekStart,
          label: index === current ? 'This wk' : shortDate(week.weekStart),
          value: week.medianCycleDays,
          highlight: index === current,
          description:
            week.medianCycleDays === null
              ? `Week of ${shortDate(week.weekStart)}: nothing finished`
              : `Week of ${shortDate(week.weekStart)}: typical task took ${days(week.medianCycleDays).toLowerCase()} (${week.completed} finished)`,
        }))}
      />
    </Panel>
  );
}

function personLabel(id: string | null) {
  return id ? <PersonAvatar userId={id} size="xs" showName /> : <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted"><UserX aria-hidden className="size-4" />Unassigned</span>;
}

export function WorkloadPanel({ report, className, personText }: { readonly report: ReportDTO; readonly className?: string; readonly personText: (id: string | null) => string }) {
  return (
    <Panel className={className} title="Workload">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg-secondary">Open tasks per person.</p>
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-secondary" aria-hidden>
          <li className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px]" style={{ background: SERIES.overdue }} />Overdue</li>
          <li className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px]" style={{ background: SERIES.inProgress }} />In progress</li>
          <li className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px]" style={{ background: SERIES.todo }} />To do</li>
        </ul>
      </div>
      <StackedBars
        title="Open tasks per person"
        emptyText="No open tasks. Nice work!"
        rows={report.people.map((person) => {
          const overdue = person.overdue;
          const inProgress = Math.max(0, person.inProgress - Math.min(person.inProgress, overdue));
          const todo = Math.max(0, person.open - overdue - inProgress);
          return {
            id: person.assigneeId ?? 'none',
            label: personLabel(person.assigneeId),
            text: personText(person.assigneeId),
            segments: [
              { label: 'Overdue', value: overdue, color: SERIES.overdue },
              { label: 'In progress', value: inProgress, color: SERIES.inProgress },
              { label: 'To do', value: todo, color: SERIES.todo },
            ],
            trailing: (
              <span>
                <strong className="font-semibold text-fg">{person.open}</strong>
                {person.points ? <span className="ml-1">· {person.points} pts</span> : null}
              </span>
            ),
          };
        })}
      />
    </Panel>
  );
}

export function OverduePanel({ report, className, personText }: { readonly report: ReportDTO; readonly className?: string; readonly personText: (id: string | null) => string }) {
  const rows = report.people.filter((person) => person.overdue > 0).sort((a, b) => b.overdue - a.overdue);
  return (
    <Panel className={className} title="Overdue by person">
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md bg-success-subtle px-4 py-8 text-center">
          <CheckCircle2 aria-hidden className="size-6 text-success-text" />
          <p className="text-sm font-medium text-success-text">Nothing is overdue</p>
          <p className="text-xs text-fg-secondary">Every open task is still on schedule.</p>
        </div>
      ) : (
        <StackedBars
          title="Overdue tasks per person"
          emptyText="Nothing is overdue"
          rows={rows.map((person) => ({
            id: person.assigneeId ?? 'none',
            label: personLabel(person.assigneeId),
            text: personText(person.assigneeId),
            segments: [{ label: 'Overdue', value: person.overdue, color: SERIES.overdue }],
            trailing: <strong className="font-semibold text-danger-text">{person.overdue}</strong>,
          }))}
        />
      )}
    </Panel>
  );
}

export function CompletedPanel({ report, className, taskHref }: { readonly report: ReportDTO; readonly className?: string; readonly taskHref: (key: string) => string }) {
  const list = report.completedThisWeek;
  return (
    <Panel className={className} title={`Finished this week (${report.totals.completedThisWeek})`} bodyClassName="p-2">
      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <Inbox aria-hidden className="size-6 text-icon" />
          <p className="text-sm font-medium text-fg">Nothing finished yet this week</p>
          <p className="text-xs text-fg-muted">Tasks show up here as soon as they are marked done.</p>
        </div>
      ) : (
        <ul className="flex flex-col">
          {list.map((task) => (
            <li key={task.id}>
              <Link href={taskHref(task.key)} data-task-key={task.key} scroll={false} className="flex items-center gap-3 rounded-md px-2 py-2 text-sm outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus">
                <CheckCircle2 aria-hidden className="size-4 shrink-0 text-success" />
                <span className="w-16 shrink-0 font-key text-xs text-fg-muted">{task.key}</span>
                <span className="min-w-0 flex-1 truncate text-fg">{task.title}</span>
                <PersonAvatar userId={task.assigneeId} size="xs" />
                <LocalTime iso={task.completedAt} className="hidden w-24 shrink-0 text-right text-xs text-fg-muted sm:block" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
