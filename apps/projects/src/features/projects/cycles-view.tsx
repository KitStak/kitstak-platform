'use client';
/**
 * Cycles tab (/p/OPS/cycles?cycle=<id>): time-boxed rounds of work. Left: every cycle (current,
 * upcoming, done) with progress. Right: the picked cycle with its burndown, scope changes, the
 * tasks in it and the backlog to pull from. Ended cycles close on their own and unfinished
 * work rolls into the next cycle.
 */
import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarRange, CheckCircle2, CircleDashed, Pencil, Plus, RefreshCcw, Repeat, Search, Target, Trash2, X } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  Field,
  IconButton,
  Input,
  IsoDatePicker,
  ProgressBar,
  Skeleton,
  Switch,
  Textarea,
  ToggleGroup,
  cn,
  toast,
} from '@/components/ui';
import { TaskRow } from '@/components/pm';
import { Panel } from '@/components/layout/page';
import { cycleDaysLeft } from '@/lib/cycle-math';
import { addDaysIso, diffDays, formatRange, startOfWeekIso, todayIso } from '@/lib/dates';
import { useCycle, useCycles, useProjectTasks } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import { shortDate } from '@/lib/report-math';
import type { CycleDTO, TaskSummary } from '@/lib/types';
import { completeCycleAction, createCycleAction, deleteCycleAction, setTasksCycleAction, updateCycleAction } from '@/server/actions/cycles';
import { ColumnChart, LineChart } from '@/features/dashboards/charts';
import { SERIES } from '@/features/dashboards/report-panels';
import { useCurrentProject } from './project-context';

export const cycleName = (cycle: Pick<CycleDTO, 'name' | 'number'>) => cycle.name?.trim() || `Cycle ${cycle.number}`;

const STATE_LABEL: Record<CycleDTO['state'], string> = { current: 'Current', upcoming: 'Upcoming', done: 'Done' };

function useInvalidateCycles() {
  const queryClient = useQueryClient();
  const { project } = useCurrentProject();
  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.cycles(project.key) });
    void queryClient.invalidateQueries({ queryKey: ['cycles'] });
  };
}

function CycleListItem({ cycle, selected, onSelect }: { readonly cycle: CycleDTO; readonly selected: boolean; readonly onSelect: () => void }) {
  const percent = cycle.taskCount ? Math.round((cycle.doneCount / cycle.taskCount) * 100) : 0;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        data-testid="cycle-item"
        className={cn(
          'flex w-full flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-left outline-none transition-colors focus-visible:outline-2 focus-visible:outline-focus',
          selected ? 'border-primary bg-primary-subtle/40' : 'border-transparent hover:bg-hover',
        )}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-fg">{cycleName(cycle)}</span>
          {cycle.state === 'current' ? <Badge tone="primary" size="sm">Current</Badge> : cycle.state === 'upcoming' ? <Badge tone="outline" size="sm">Upcoming</Badge> : null}
        </span>
        <span className="text-xs text-fg-muted">{formatRange(cycle.startDate, cycle.endDate)}</span>
        <span className="flex items-center gap-2">
          <ProgressBar value={percent} size="sm" label={`${cycleName(cycle)} progress`} tone={percent >= 100 ? 'success' : 'primary'} className="flex-1" />
          <span className="w-16 text-right text-2xs text-fg-secondary tabular-nums">
            {cycle.doneCount}/{cycle.taskCount} done
          </span>
        </span>
      </button>
    </li>
  );
}

interface CycleFormState {
  name: string;
  goal: string;
  startDate: string | null;
  endDate: string | null;
  autoRollover: boolean;
}

function CycleDialog({
  open,
  onOpenChange,
  cycle,
  suggested,
  onSaved,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly cycle: CycleDTO | null;
  readonly suggested: { startDate: string; endDate: string };
  readonly onSaved: (cycle: CycleDTO) => void;
}) {
  const { project } = useCurrentProject();
  const [form, setForm] = useState<CycleFormState>(() => ({
    name: cycle?.name ?? '',
    goal: cycle?.goal ?? '',
    startDate: cycle?.startDate ?? suggested.startDate,
    endDate: cycle?.endDate ?? suggested.endDate,
    autoRollover: cycle?.autoRollover ?? true,
  }));
  const [saving, setSaving] = useState(false);
  const length = form.startDate && form.endDate ? diffDays(form.startDate, form.endDate) + 1 : 0;
  const dateError = form.startDate && form.endDate && form.endDate < form.startDate ? 'The end date has to be on or after the start date.' : undefined;
  const setLength = (days: number) => form.startDate && setForm({ ...form, endDate: addDaysIso(form.startDate, days - 1) });

  const save = async () => {
    if (!form.startDate || !form.endDate || dateError) return;
    setSaving(true);
    const fields = { name: form.name.trim() || null, goal: form.goal.trim() || null, startDate: form.startDate, endDate: form.endDate, autoRollover: form.autoRollover };
    const result = cycle ? await updateCycleAction({ cycleId: cycle.id, patch: fields }) : await createCycleAction({ projectId: project.id, ...fields });
    setSaving(false);
    if (!result.ok) {
      toast.error(cycle ? "Couldn't save the cycle" : "Couldn't plan the cycle", result.error.message);
      return;
    }
    toast.success(cycle ? 'Cycle saved' : `${cycleName(result.data)} is planned`);
    onSaved(result.data);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader
          icon={<Repeat aria-hidden className="size-5 text-primary-text" />}
          title={cycle ? `Edit ${cycleName(cycle)}` : 'Plan a cycle'}
          description="A cycle is a short round of work, usually one or two weeks. Pick what the team will finish by the end date."
        />
        <DialogBody className="flex flex-col gap-4 pb-4">
          <Field label="Name" hint={`Optional. Leave empty to call it ${cycle ? `Cycle ${cycle.number}` : 'by its number'}.`}>
            {({ inputId, describedBy }) => <Input id={inputId} aria-describedby={describedBy} value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Peak prep week 1" />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-secondary">Starts</span>
              <IsoDatePicker value={form.startDate} onChange={(startDate) => setForm({ ...form, startDate, endDate: startDate && length ? addDaysIso(startDate, length - 1) : form.endDate })} aria-label="Start date" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-secondary">Ends</span>
              <IsoDatePicker value={form.endDate} onChange={(endDate) => setForm({ ...form, endDate })} aria-label="End date" />
              {dateError ? <span role="alert" className="text-2xs font-medium text-danger-text">{dateError}</span> : <span className="text-2xs text-fg-muted">{length} {length === 1 ? 'day' : 'days'}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-fg-muted">Length:</span>
            {[7, 14, 21].map((days) => (
              <Button key={days} type="button" size="sm" variant={length === days ? 'secondary' : 'ghost'} onClick={() => setLength(days)}>
                {days / 7} {days === 7 ? 'week' : 'weeks'}
              </Button>
            ))}
          </div>
          <Field label="Goal" hint="Optional. One sentence the team can check the work against.">
            {({ inputId, describedBy }) => <Textarea id={inputId} aria-describedby={describedBy} rows={2} maxLength={500} value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} placeholder="Every client in the pilot can ship a test order." />}
          </Field>
          <label className="flex items-center justify-between gap-4 rounded-lg border border-border-subtle px-3 py-2.5">
            <span>
              <span className="block text-sm font-medium text-fg">Roll over unfinished work</span>
              <span className="block text-xs text-fg-muted">When the cycle ends, open tasks move to the next cycle. We plan the next one for you if there isn’t one.</span>
            </span>
            <Switch checked={form.autoRollover} onCheckedChange={(autoRollover) => setForm({ ...form, autoRollover })} aria-label="Roll over unfinished work" />
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={!form.startDate || !form.endDate || Boolean(dateError)} data-testid="cycle-save">
            {cycle ? 'Save' : 'Plan cycle'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloseCycleDialog({ open, onOpenChange, cycle, onClosed }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly cycle: CycleDTO; readonly onClosed: (nextId: string | null) => void }) {
  const [mode, setMode] = useState<'next' | 'backlog'>('next');
  const [saving, setSaving] = useState(false);
  const open_ = cycle.taskCount - cycle.doneCount;
  const close = async () => {
    setSaving(true);
    const result = await completeCycleAction({ cycleId: cycle.id, unfinished: mode });
    setSaving(false);
    if (!result.ok) {
      toast.error("Couldn't close the cycle", result.error.message);
      return;
    }
    toast.success(`${cycleName(cycle)} is closed`, result.data.moved ? `${result.data.moved} unfinished ${result.data.moved === 1 ? 'task' : 'tasks'} ${mode === 'next' ? 'moved to the next cycle' : 'went back to the backlog'}.` : 'Everything in it was finished.');
    onClosed(result.data.nextCycleId);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader title={`Close ${cycleName(cycle)}?`} description={`${cycle.doneCount} of ${cycle.taskCount} tasks are done.`} />
        <DialogBody className="flex flex-col gap-3 pb-4">
          {open_ > 0 ? (
            <>
              <p className="text-sm text-fg-secondary">What should happen to the {open_} unfinished {open_ === 1 ? 'task' : 'tasks'}?</p>
              <ToggleGroup
                label="Unfinished tasks"
                value={mode}
                onValueChange={setMode}
                options={[
                  { value: 'next', label: 'Move to next cycle' },
                  { value: 'backlog', label: 'Back to backlog' },
                ]}
              />
            </>
          ) : (
            <p className="text-sm text-fg-secondary">Nice work. Everything in this cycle is finished.</p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void close()} loading={saving} data-testid="cycle-close-confirm">
            Close cycle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, hint, icon }: { readonly label: string; readonly value: string; readonly hint?: string; readonly icon: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-border-subtle bg-panel px-3 py-2.5">
      <span className="flex items-center gap-1.5 text-xs text-fg-muted [&_svg]:size-3.5">
        {icon}
        {label}
      </span>
      <span className="text-lg font-semibold text-fg tabular-nums">{value}</span>
      {hint ? <span className="truncate text-2xs text-fg-muted">{hint}</span> : null}
    </div>
  );
}

function BacklogPicker({ cycle, backlog, onAdded }: { readonly cycle: CycleDTO; readonly backlog: readonly TaskSummary[]; readonly onAdded: () => void }) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return backlog.filter((t) => !q || t.title.toLowerCase().includes(q) || t.key.toLowerCase().includes(q));
  }, [backlog, query]);
  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const add = async () => {
    setSaving(true);
    const result = await setTasksCycleAction({ taskIds: [...picked], cycleId: cycle.id });
    setSaving(false);
    if (!result.ok) {
      toast.error("Couldn't add the tasks", result.error.message);
      return;
    }
    toast.success(`Added ${result.data.changed} ${result.data.changed === 1 ? 'task' : 'tasks'} to ${cycleName(cycle)}`);
    setPicked(new Set());
    onAdded();
  };
  return (
    <Panel
      title={`Backlog (${backlog.length})`}
      action={
        <Button size="sm" leadingIcon={<Plus aria-hidden />} disabled={picked.size === 0} loading={saving} onClick={() => void add()} data-testid="cycle-add-tasks">
          {picked.size ? `Add ${picked.size} to cycle` : 'Add to cycle'}
        </Button>
      }
    >
      <p className="mb-2 text-sm text-fg-secondary">Open tasks that are not in a cycle yet. Pick the ones the team will finish this round.</p>
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a task" aria-label="Find a backlog task" leadingIcon={<Search aria-hidden />} size="sm" containerClassName="mb-2" />
      {shown.length ? (
        <ul className="flex max-h-[360px] flex-col overflow-y-auto" aria-label="Backlog tasks">
          {shown.map((task) => (
            <li key={task.id} className="flex items-center gap-2 rounded-md px-1 hover:bg-hover">
              <Checkbox checked={picked.has(task.id)} onCheckedChange={() => toggle(task.id)} aria-label={`Pick ${task.key} ${task.title}`} />
              <span className="w-16 shrink-0 font-mono text-2xs text-fg-muted">{task.key}</span>
              <button type="button" onClick={() => toggle(task.id)} className="min-w-0 flex-1 truncate py-2 text-left text-sm text-fg outline-none focus-visible:underline">
                {task.title}
              </button>
              {task.estimatePoints ? <span className="shrink-0 rounded-sm bg-sunken px-1.5 text-2xs text-fg-secondary tabular-nums">{task.estimatePoints} pt</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-border-default px-3 py-6 text-center text-sm text-fg-muted">{backlog.length ? 'No backlog tasks match.' : 'The backlog is empty. Every open task is in a cycle.'}</p>
      )}
    </Panel>
  );
}

function CycleDetail({ cycleId, backlog, onDeleted, onSelect }: { readonly cycleId: string; readonly backlog: readonly TaskSummary[]; readonly onDeleted: () => void; readonly onSelect: (id: string) => void }) {
  const { project, capabilities } = useCurrentProject();
  const detail = useCycle(cycleId);
  const invalidate = useInvalidateCycles();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);
  const canEdit = capabilities['task:update'];
  const refresh = () => {
    invalidate();
    void queryClient.invalidateQueries({ queryKey: qk.projectTasks(project.key) });
  };

  if (detail.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton height={80} />
        <Skeleton height={260} />
      </div>
    );
  }
  if (!detail.data) return <p className="text-sm text-fg-muted">We couldn’t load this cycle.</p>;
  const { cycle, report, tasks } = detail.data;
  const today = todayIso();
  const daysLeft = cycleDaysLeft(cycle.endDate, today);
  const todayIndex = report.days.findIndex((d) => d.date === today);
  const scopeChange = report.addedAfterStart - report.removedAfterStart;
  const sortedTasks = [...tasks].sort((a, b) => Number(a.statusCategory === 'done') - Number(b.statusCategory === 'done') || a.number - b.number);

  const removeTask = async (task: TaskSummary) => {
    const result = await setTasksCycleAction({ taskIds: [task.id], cycleId: null });
    if (!result.ok) {
      toast.error("Couldn't take the task out", result.error.message);
      return;
    }
    refresh();
    toast.undo(`Took ${task.key} out of ${cycleName(cycle)}`, {
      onUndo: async () => {
        const undo = await setTasksCycleAction({ taskIds: [task.id], cycleId: cycle.id });
        if (!undo.ok) throw new Error(undo.error.message);
        refresh();
      },
    });
  };
  const remove = async () => {
    const result = await deleteCycleAction({ cycleId: cycle.id });
    if (!result.ok) {
      toast.error("Couldn't remove the cycle", result.error.message);
      return;
    }
    toast.success(`Removed ${cycleName(cycle)}`, 'Its tasks went back to the backlog.');
    refresh();
    onDeleted();
  };

  const burnSeries = [
    { id: 'remaining', label: 'Work left', color: SERIES.remaining, values: report.days.map((d) => (d.future ? null : d.remaining)), area: true },
    { id: 'ideal', label: 'On-time pace', color: SERIES.ideal, values: report.days.map((d) => d.ideal), dashed: true },
    { id: 'scope', label: 'Total in cycle', color: SERIES.velocity, values: report.days.map((d) => (d.future ? null : d.scope)) },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="cycle-detail">
      <section className="flex flex-wrap items-start gap-3 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs">
        <div className="min-w-[min(100%,260px)] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-fg">{cycleName(cycle)}</h2>
            <Badge tone={cycle.state === 'current' ? 'primary' : cycle.state === 'done' ? 'success' : 'outline'}>{STATE_LABEL[cycle.state]}</Badge>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-secondary">
            <span className="inline-flex items-center gap-1">
              <CalendarRange aria-hidden className="size-3.5 text-icon" />
              {formatRange(cycle.startDate, cycle.endDate)}
            </span>
            {cycle.state === 'current' ? <span>{daysLeft === 1 ? 'Last day' : `${daysLeft} days left`}</span> : cycle.state === 'upcoming' ? <span>Starts in {diffDays(today, cycle.startDate)} {diffDays(today, cycle.startDate) === 1 ? 'day' : 'days'}</span> : null}
            {cycle.autoRollover && cycle.state !== 'done' ? (
              <span className="inline-flex items-center gap-1 text-fg-muted">
                <RefreshCcw aria-hidden className="size-3.5" />
                Rolls over
              </span>
            ) : null}
          </p>
          {cycle.goal ? (
            <p className="mt-2 flex items-start gap-1.5 text-sm text-fg">
              <Target aria-hidden className="mt-0.5 size-4 shrink-0 text-primary-text" />
              {cycle.goal}
            </p>
          ) : null}
        </div>
        {canEdit ? (
          <div className="flex items-center gap-1.5">
            <Button variant="secondary" size="sm" leadingIcon={<Pencil aria-hidden />} onClick={() => setEditing(true)}>
              Edit
            </Button>
            {cycle.state !== 'done' ? (
              <Button size="sm" leadingIcon={<CheckCircle2 aria-hidden />} onClick={() => setClosing(true)} data-testid="cycle-close">
                Close cycle
              </Button>
            ) : null}
            <IconButton label={`Remove ${cycleName(cycle)}`} icon={<Trash2 aria-hidden />} size="sm" onClick={() => void remove()} />
          </div>
        ) : null}
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<CheckCircle2 aria-hidden />} label="Done" value={`${report.percent}%`} hint={`${report.done} of ${report.scope} tasks`} />
        <Stat icon={<CircleDashed aria-hidden />} label="Left to do" value={String(report.remaining)} hint={report.points ? `${report.points - report.donePoints} of ${report.points} points` : 'Add points to tasks to see effort'} />
        <Stat
          icon={<ArrowRight aria-hidden />}
          label="Scope change"
          value={scopeChange === 0 ? 'None' : `${scopeChange > 0 ? '+' : ''}${scopeChange}`}
          hint={`Planned ${report.plannedScope} · ${report.addedAfterStart} added · ${report.removedAfterStart} taken out`}
        />
        <Stat icon={<RefreshCcw aria-hidden />} label="Rolled over" value={String(report.rolledOver)} hint={cycle.state === 'done' ? 'Moved on when it closed' : 'Moves on if still open at the end'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Burndown">
          <p className="mb-3 text-sm text-fg-secondary">Work left should reach zero on the last day. Staying under the dashed line means the cycle is on pace.</p>
          <LineChart title={`${cycleName(cycle)} burndown`} series={burnSeries} labels={report.days.map((d) => d.date)} formatLabel={shortDate} markerIndex={todayIndex >= 0 && todayIndex < report.days.length - 1 ? todayIndex : null} valueSuffix=" tasks" />
        </Panel>
        <Panel title="Scope changes">
          <p className="mb-3 text-sm text-fg-secondary">Tasks added (up) or taken out (down) after the cycle started. Lots of change mid-cycle makes the goal harder to hit.</p>
          <ColumnChart
            title={`${cycleName(cycle)} scope changes`}
            data={report.days.map((d) => ({
              id: d.date,
              // Day of the month keeps two-week cycles readable; the full date is in the description.
              label: String(Number(d.date.slice(8))),
              value: d.future ? null : d.added - d.removed,
              description: `${shortDate(d.date)}: ${d.added} added, ${d.removed} taken out, ${d.scope} in the cycle`,
              highlight: d.date === today,
            }))}
            color={SERIES.velocity}
            formatValue={(v) => (v > 0 ? `+${v}` : String(v))}
          />
        </Panel>
      </div>

      <div className={cn('grid gap-4', canEdit && cycle.state !== 'done' ? 'xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]' : '')}>
        <Panel title={`In this cycle (${tasks.length})`}>
          {sortedTasks.length ? (
            <ul className="flex flex-col" aria-label="Tasks in this cycle">
              {sortedTasks.map((task) => (
                <li key={task.id} className="group flex items-center gap-1" data-task-key={task.key}>
                  <TaskRow task={task} className="min-w-0 flex-1" />
                  {canEdit && cycle.state !== 'done' ? (
                    <IconButton label={`Take ${task.key} out of the cycle`} icon={<X aria-hidden />} size="sm" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => void removeTask(task)} />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState size="sm" illustration="board" title="No tasks in this cycle yet" description={cycle.state === 'done' ? 'This cycle closed without tasks.' : 'Pick tasks from the backlog to plan the round.'} />
          )}
        </Panel>
        {canEdit && cycle.state !== 'done' ? <BacklogPicker cycle={cycle} backlog={backlog} onAdded={refresh} /> : null}
      </div>

      {editing ? <CycleDialog open={editing} onOpenChange={setEditing} cycle={cycle} suggested={{ startDate: cycle.startDate, endDate: cycle.endDate }} onSaved={refresh} /> : null}
      {closing ? (
        <CloseCycleDialog
          open={closing}
          onOpenChange={setClosing}
          cycle={cycle}
          onClosed={(nextId) => {
            refresh();
            if (nextId) onSelect(nextId);
          }}
        />
      ) : null}
    </div>
  );
}

export function CyclesView() {
  const { project, capabilities } = useCurrentProject();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const cycles = useCycles(project.key);
  const tasks = useProjectTasks(project.key);
  const invalidate = useInvalidateCycles();
  const [planning, setPlanning] = useState(false);
  const canEdit = capabilities['task:update'];

  const list = useMemo(() => cycles.data?.cycles ?? [], [cycles.data]);
  const selectedId = params.get('cycle') ?? cycles.data?.currentId ?? list.find((c) => c.state === 'upcoming')?.id ?? list[0]?.id ?? null;
  const select = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set('cycle', id);
    else next.delete('cycle');
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const backlog = useMemo(() => {
    const inCycle = cycles.data?.taskCycle ?? {};
    return (tasks.data ?? []).filter((t) => !t.parentTaskId && t.statusCategory !== 'done' && t.statusCategory !== 'cancelled' && !inCycle[t.id]);
  }, [tasks.data, cycles.data]);

  // Next cycle follows the latest one; a stale project starts fresh this week.
  const latest = list[0];
  const latestLength = latest ? diffDays(latest.startDate, latest.endDate) : 13;
  const today = todayIso();
  const afterLatest = latest ? addDaysIso(latest.endDate, 1) : null;
  const suggestedStart = afterLatest && addDaysIso(afterLatest, latestLength) >= today ? afterLatest : startOfWeekIso(today);
  const suggested = { startDate: suggestedStart, endDate: addDaysIso(suggestedStart, latestLength) };

  const groups: { title: string; items: CycleDTO[] }[] = [
    { title: 'Current', items: list.filter((c) => c.state === 'current') },
    { title: 'Upcoming', items: list.filter((c) => c.state === 'upcoming').reverse() },
    { title: 'Done', items: list.filter((c) => c.state === 'done') },
  ].filter((g) => g.items.length);

  return (
    <div className="flex flex-col gap-4 px-6 py-5" data-testid="cycles-view">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[min(100%,320px)] flex-1">
          <h2 className="text-base font-semibold text-fg">Cycles</h2>
          <p className="text-sm text-fg-muted">Short rounds of work with a clear end date. Unfinished work rolls into the next cycle by itself.</p>
        </div>
        {canEdit ? (
          <Button leadingIcon={<Plus aria-hidden />} onClick={() => setPlanning(true)} data-testid="cycle-new">
            Plan a cycle
          </Button>
        ) : null}
      </div>

      {cycles.isPending ? (
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <Skeleton height={240} />
          <Skeleton height={360} />
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-border-subtle bg-panel">
          <EmptyState
            illustration="board"
            title="Plan your first cycle"
            description={`Pick a week or two, pull in the tasks the team will finish, and watch the burndown. ${cycles.data?.backlogCount ?? 0} open tasks are waiting in the backlog.`}
            actions={canEdit ? <Button leadingIcon={<Plus aria-hidden />} onClick={() => setPlanning(true)}>Plan a cycle</Button> : null}
          />
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <nav aria-label="Cycles" className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-panel p-2 shadow-xs lg:sticky lg:top-0">
            {groups.map((group) => (
              <div key={group.title}>
                <p className="px-2 pt-1 pb-1 text-2xs font-semibold tracking-wide text-fg-muted uppercase">{group.title}</p>
                <ul className="flex flex-col gap-0.5">
                  {group.items.map((cycle) => (
                    <CycleListItem key={cycle.id} cycle={cycle} selected={cycle.id === selectedId} onSelect={() => select(cycle.id)} />
                  ))}
                </ul>
              </div>
            ))}
            <p className="border-t border-border-subtle px-2 pt-2 pb-1 text-xs text-fg-muted">{cycles.data?.backlogCount ?? 0} open tasks in the backlog</p>
          </nav>
          {selectedId ? <CycleDetail key={selectedId} cycleId={selectedId} backlog={backlog} onDeleted={() => select(null)} onSelect={select} /> : null}
        </div>
      )}

      {planning ? (
        <CycleDialog
          open={planning}
          onOpenChange={setPlanning}
          cycle={null}
          suggested={suggested}
          onSaved={(cycle) => {
            invalidate();
            select(cycle.id);
          }}
        />
      ) : null}
    </div>
  );
}
