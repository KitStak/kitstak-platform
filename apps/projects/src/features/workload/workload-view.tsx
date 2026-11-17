'use client';
/**
 * Workload: one row per person, one column per week. Each cell shows how much open work lands in
 * that week (tasks, points or hours) against the person's weekly capacity, red when it's too much.
 * Drag a task to another person or week to rebalance; it's saved right away with Undo.
 * Capacity (team default + per person) is saved on the project for everyone.
 */
import { useCallback, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Gauge, Move, Scale, UserRound } from 'lucide-react';
import {
  Avatar,
  Button,
  EmptyState,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  ToggleGroup,
  Tooltip,
  cn,
  toast,
} from '@/components/ui';
import { StatusIcon } from '@/components/pm';
import { addDaysIso, parseIsoDate, startOfWeekIso, todayIso, type IsoDate } from '@/lib/dates';
import { useProjectTasks } from '@/lib/hooks/use-data';
import { usePeopleMap } from '@/lib/hooks/use-people';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { useTaskMutations } from '@/lib/hooks/use-task-mutations';
import { qk } from '@/lib/query-keys';
import type { ProjectDetail, TaskSummary } from '@/lib/types';
import { updateProjectAction } from '@/server/actions/projects';
import { useCurrentProject } from '@/features/projects/project-context';
import { isClosed } from '@/features/timeline/task-colors';
import { SavedViewsMenu } from '@/features/timeline/saved-views';
import { TASK_MIME } from '@/features/timeline/unscheduled-tray';
import { useIsNarrow, useViewPrefs } from '@/features/timeline/use-view-prefs';
import { OptionSelect, OptionSwitch, OptionsMenu, ToolbarSpacer, ViewTips, ViewToolbar } from '@/features/timeline/view-toolbar';
import {
  EARLIER,
  NO_DATE,
  UNASSIGNED,
  UNIT_LABELS,
  buildWorkload,
  capacityFor,
  formatLoad,
  loadLevel,
  readWorkloadSettings,
  shiftToWeek,
  taskLoad,
  weekStarts,
  withCapacity,
  type LoadLevel,
  type LoadUnit,
  type WorkloadCell,
} from './workload-model';

interface WorkloadPrefs {
  /** `auto` measures in points (or hours) when most open tasks carry that estimate, else in tasks. */
  readonly unit: LoadUnit | 'auto';
  readonly weeks: '4' | '6' | '8' | '12';
  readonly hideIdle: boolean;
  readonly collapsed: readonly string[];
  readonly viewId: string | null;
}

type WorkloadViewOptions = Pick<WorkloadPrefs, 'unit' | 'weeks' | 'hideIdle'>;

const DEFAULT_PREFS: WorkloadPrefs = { unit: 'auto', weeks: '6', hideIdle: false, collapsed: [], viewId: null };

function viewOptions(prefs: WorkloadPrefs): WorkloadViewOptions {
  return { unit: prefs.unit, weeks: prefs.weeks, hideIdle: prefs.hideIdle };
}

const SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

const LEVEL_FILL: Readonly<Record<LoadLevel, string>> = {
  empty: 'bg-transparent',
  light: 'bg-success/55',
  good: 'bg-success',
  full: 'bg-warning',
  over: 'bg-danger',
};

interface DragPayload {
  readonly taskId: string;
  readonly fromPerson: string;
  readonly fromBucket: string;
}

/** Planning works in effort, not task counts: use points or hours when most open tasks have them. */
function autoUnit(tasks: readonly TaskSummary[]): LoadUnit {
  if (tasks.length === 0) return 'tasks';
  const points = tasks.filter((task) => task.estimatePoints !== null).length;
  const hours = tasks.filter((task) => task.estimateMinutes !== null).length;
  // A quarter of the work estimated is enough to plan in effort; the rest is flagged as missing.
  if (points >= hours && points * 4 >= tasks.length) return 'points';
  if (hours * 4 >= tasks.length) return 'hours';
  return 'tasks';
}

/** "Nov 13 to 16" in one month, "Oct 30 to Nov 17" across months (never a bare "Oct 30–17"). */
function shortRange(start: IsoDate, end: IsoDate): string {
  const a = parseIsoDate(start);
  const b = parseIsoDate(end);
  if (start === end) return SHORT.format(a);
  return a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear() ? `${SHORT.format(a)} to ${b.getDate()}` : `${SHORT.format(a)} to ${SHORT.format(b)}`;
}

function unitText(value: number, unit: LoadUnit): string {
  const n = formatLoad(value);
  const label = UNIT_LABELS[unit];
  return `${n} ${Number(n) === 1 ? label.one : label.many}`;
}

export function WorkloadView() {
  const { project, statusById, capabilities } = useCurrentProject();
  const tasksQuery = useProjectTasks(project.key);
  const people = usePeopleMap();
  const queryClient = useQueryClient();
  const { openTask } = useTaskDrawer();
  const { updateTask } = useTaskMutations({ statusCategory: (id) => statusById.get(id)?.category });
  const [prefs, setPrefs] = useViewPrefs<WorkloadPrefs>(`workload:${project.key}`, DEFAULT_PREFS);
  const narrow = useIsNarrow();
  const today = todayIso();
  const canEdit = capabilities['task:update'];
  const canSetCapacity = capabilities['project:update'];

  const [anchor, setAnchor] = useState<IsoDate>(() => startOfWeekIso(todayIso()));
  const [over, setOver] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragRef = useRef<DragPayload | null>(null);

  const openTasks = useMemo(() => (tasksQuery.data ?? []).filter((task) => !isClosed(task) && !task.isMilestone), [tasksQuery.data]);
  const unit: LoadUnit = useMemo(() => (prefs.unit === 'auto' ? autoUnit(openTasks) : prefs.unit), [openTasks, prefs.unit]);
  // Show only the weeks that fit the screen (never a clipped last column).
  const [gridWidth, setGridWidth] = useState(0);
  const gridObserver = useRef<ResizeObserver | null>(null);
  const measureGrid = useCallback((node: HTMLDivElement | null) => {
    gridObserver.current?.disconnect();
    if (!node) return;
    gridObserver.current = new ResizeObserver(([entry]) => setGridWidth(Math.round(entry?.contentRect.width ?? 0)));
    gridObserver.current.observe(node);
  }, []);
  // Phones: a slim name column and one full-width week (task chips readable), the next weeks a
  // sideways scroll away (the next column peeks in at the edge as the hint).
  const nameWidth = narrow ? 108 : 248;
  const colMin = narrow ? (gridWidth > 0 ? Math.max(200, gridWidth - nameWidth - 28) : 240) : 168;
  const fitWeeks = gridWidth > 0 && !narrow ? Math.max(1, Math.floor((gridWidth - nameWidth - 2 * colMin) / colMin)) : Number(prefs.weeks);
  // Phones show one week at a time as a list of people (swipe or use the arrows for other weeks).
  const weekCount = narrow ? 1 : Math.min(12, Number(prefs.weeks), fitWeeks);
  const weeks = useMemo(() => weekStarts(anchor, weekCount), [anchor, weekCount]);
  const settings = useMemo(() => readWorkloadSettings(project.settings, unit), [project.settings, unit]);
  const collapsed = useMemo(() => new Set(prefs.collapsed), [prefs.collapsed]);

  const taskById = useMemo(() => new Map(openTasks.map((task) => [task.id, task])), [openTasks]);
  const rows = useMemo(() => buildWorkload(openTasks, weeks, unit), [openTasks, weeks, unit]);
  // "<n> open tasks" counts every open task the person has, not only those inside the visible weeks
  // (so it matches the List and Table).
  const openByPerson = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of openTasks) {
      const key = task.assigneeId ?? UNASSIGNED;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [openTasks]);

  const hasEarlier = useMemo(() => [...rows.values()].some((row) => row.cells.has(EARLIER)), [rows]);
  const buckets = useMemo(() => [...(hasEarlier ? [EARLIER] : []), ...weeks, NO_DATE], [hasEarlier, weeks]);

  const personIds = useMemo(() => {
    const ids = new Set<string>(project.members.map((member) => member.userId));
    for (const id of rows.keys()) if (id !== UNASSIGNED) ids.add(id);
    const list = [...ids].filter((id) => !prefs.hideIdle || rows.has(id));
    list.sort((a, b) => (people.get(a)?.name ?? 'zz').localeCompare(people.get(b)?.name ?? 'zz'));
    if (rows.has(UNASSIGNED)) list.push(UNASSIGNED);
    return list;
  }, [project.members, rows, prefs.hideIdle, people]);

  // Overloaded person-weeks in view (for the toolbar warning).
  const overloads = useMemo(() => {
    const out: { person: string; week: IsoDate; load: number; capacity: number }[] = [];
    for (const id of personIds) {
      if (id === UNASSIGNED) continue;
      const row = rows.get(id);
      const capacity = capacityFor(settings, id);
      for (const week of weeks) {
        const load = row?.cells.get(week)?.load ?? 0;
        if (loadLevel(load, capacity) === 'over') out.push({ person: id, week, load, capacity });
      }
    }
    return out;
  }, [personIds, rows, settings, weeks]);

  const hoursCount = useMemo(() => openTasks.filter((task) => task.estimateMinutes !== null).length, [openTasks]);
  const pointsCount = useMemo(() => openTasks.filter((task) => task.estimatePoints !== null).length, [openTasks]);
  const estimatedCount = Math.max(hoursCount, pointsCount);
  const unestimated = useMemo(() => [...rows.values()].reduce((sum, row) => sum + row.unestimated, 0), [rows]);
  const thisWeek = startOfWeekIso(today);

  // --- Writes ---------------------------------------------------------------------------------

  const saveCapacity = async (change: { perWeek?: number; person?: { id: string; value: number | null } }) => {
    const previous = queryClient.getQueryData<ProjectDetail>(qk.project(project.key));
    const next = withCapacity(project.settings, unit, change);
    queryClient.setQueryData<ProjectDetail>(qk.project(project.key), (detail) => (detail ? { ...detail, settings: next } : detail));
    const result = await updateProjectAction({ projectId: project.id, patch: { settings: next } });
    if (!result.ok) {
      queryClient.setQueryData(qk.project(project.key), previous);
      toast.error("Couldn't save the capacity", result.error.message);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: qk.project(project.key), exact: true });
    toast.success('Capacity saved');
  };

  const moveTask = async (payload: DragPayload, toPerson: string, toBucket: string) => {
    const task = taskById.get(payload.taskId);
    if (!task || toBucket === EARLIER) return;
    if (payload.fromPerson === toPerson && payload.fromBucket === toBucket) return;
    const patch: { assigneeId?: string | null; startDate?: string | null; dueDate?: string | null } = {};
    if (payload.fromPerson !== toPerson) patch.assigneeId = toPerson === UNASSIGNED ? null : toPerson;
    if (payload.fromBucket !== toBucket) {
      if (toBucket === NO_DATE) {
        patch.startDate = null;
        patch.dueDate = null;
      } else {
        Object.assign(patch, shiftToWeek(task, payload.fromBucket, toBucket));
      }
    }
    const before = { assigneeId: task.assigneeId, startDate: task.startDate, dueDate: task.dueDate };
    const saved = await updateTask(task.id, patch);
    if (!saved) return;
    const who = toPerson === UNASSIGNED ? 'Unassigned' : (people.get(toPerson)?.name ?? 'them');
    const when = toBucket === NO_DATE ? 'no date' : `the week of ${SHORT.format(parseIsoDate(toBucket))}`;
    const description = payload.fromPerson !== toPerson && payload.fromBucket !== toBucket ? `${who} · ${when}` : payload.fromPerson !== toPerson ? who : when;
    toast.undo(`Moved “${task.title}”`, {
      description: `Now: ${description}`,
      onUndo: async () => {
        await updateTask(task.id, before);
      },
    });
  };

  const dropProps = (person: string, bucket: string) => {
    const key = `${person}|${bucket}`;
    return {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!canEdit || bucket === EARLIER || !event.dataTransfer.types.includes(TASK_MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (over !== key) setOver(key);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver((current) => (current === key ? null : current));
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        setOver(null);
        const payload = dragRef.current;
        dragRef.current = null;
        setDraggingId(null);
        if (!payload || bucket === EARLIER) return;
        event.preventDefault();
        void moveTask(payload, person, bucket);
      },
    };
  };

  const toggleRow = (id: string) => setPrefs({ collapsed: collapsed.has(id) ? prefs.collapsed.filter((x) => x !== id) : [...prefs.collapsed, id] });
  const allCollapsed = personIds.length > 0 && personIds.every((id) => collapsed.has(id));

  // --- Render ---------------------------------------------------------------------------------

  if (tasksQuery.isLoading) {
    return (
      <div aria-busy="true" aria-label="Loading workload" className="flex flex-col gap-3 p-5">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="flex items-center gap-4">
            <Skeleton width={180} height={28} rounded="full" />
            <Skeleton height={44} className="flex-1" />
          </div>
        ))}
      </div>
    );
  }

  const gridTemplate = narrow ? `${nameWidth}px repeat(${buckets.length}, ${colMin}px)` : `${nameWidth}px repeat(${buckets.length}, minmax(${colMin}px, 1fr))`;
  const lastWeek = weeks.at(-1) as IsoDate;
  const rangeTitle = narrow
    ? `Week of ${SHORT.format(parseIsoDate(weeks[0] as IsoDate))}`
    : `${SHORT.format(parseIsoDate(weeks[0] as IsoDate))} to ${SHORT.format(parseIsoDate(addDaysIso(lastWeek, 6)))}`;
  const unitLabel = UNIT_LABELS[unit];

  const bucketHeader = (bucket: string) => {
    if (bucket === EARLIER)
      return (
        <Tooltip content="Open work whose dates have already passed. Drag it into a week to plan it again.">
          <span tabIndex={0} className="flex items-center gap-1.5 rounded-xs text-xs font-semibold text-danger-text focus-visible:outline-2 focus-visible:outline-focus">
            <AlertTriangle aria-hidden className="size-3.5" /> Overdue
          </span>
        </Tooltip>
      );
    if (bucket === NO_DATE) return <span className="text-xs font-semibold text-fg-muted">No date</span>;
    const current = bucket === thisWeek;
    return (
      <span className="flex items-center gap-1.5">
        <span className={cn('text-xs font-semibold', current ? 'text-fg' : 'text-fg-secondary')}>Week of {SHORT.format(parseIsoDate(bucket))}</span>
        {current ? <span className="rounded-full bg-primary px-1.5 text-2xs leading-4 font-semibold text-primary-fg">This week</span> : null}
      </span>
    );
  };

  const meter = (load: number, capacity: number | null, compact = false) => {
    const level = capacity === null ? (load > 0 ? 'good' : 'empty') : loadLevel(load, capacity);
    const pct = capacity ? Math.min(100, (load / capacity) * 100) : load > 0 ? 100 : 0;
    const overBy = capacity !== null && level === 'over' ? load - capacity : 0;
    return (
      <div className={cn('flex flex-col gap-1', compact && 'gap-0.5')}>
        <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
          <span className={cn('font-semibold', level === 'over' ? 'text-danger-text' : level === 'empty' ? 'text-fg-muted' : 'text-fg')}>
            {formatLoad(load)}
            {capacity !== null ? <span className="font-normal text-fg-muted"> / {formatLoad(capacity)}</span> : null}
            {unitLabel.short ? <span className="font-normal text-fg-muted"> {unitLabel.short}</span> : null}
          </span>
          {overBy > 0 ? <span className="font-medium text-danger-text">+{formatLoad(overBy)} over</span> : null}
        </div>
        <div
          role="meter"
          aria-label={capacity !== null ? `${unitText(load, unit)} of ${unitText(capacity, unit)}` : unitText(load, unit)}
          aria-valuemin={0}
          aria-valuemax={capacity ?? Math.max(load, 1)}
          aria-valuenow={Math.round(load * 10) / 10}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div className={cn('h-full rounded-full transition-[width] duration-[var(--duration-base)]', capacity === null ? 'bg-border-strong' : LEVEL_FILL[level])} style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  };

  const chip = (entry: WorkloadCell['tasks'][number], person: string, bucket: string) => {
    const { task, share } = entry;
    const status = statusById.get(task.statusId);
    const load = taskLoad(task, unit) * share;
    const overdue = Boolean(task.dueDate) && (task.dueDate as string) < today;
    return (
      <li key={`${task.id}-${bucket}`}>
        <div
          draggable={canEdit}
          data-testid="workload-task"
          data-task-key={task.key}
          onDragStart={(event) => {
            dragRef.current = { taskId: task.id, fromPerson: person, fromBucket: bucket };
            setDraggingId(task.id);
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData(TASK_MIME, task.id);
            event.dataTransfer.setData('text/plain', task.key);
          }}
          onDragEnd={() => {
            dragRef.current = null;
            setDraggingId(null);
            setOver(null);
          }}
          className={cn(
            'group/chip flex h-7 items-center gap-1.5 rounded-md border border-border-subtle bg-panel px-1.5 text-xs shadow-xs transition-[box-shadow,opacity] hover:shadow-sm',
            canEdit && 'cursor-grab active:cursor-grabbing',
            draggingId === task.id && 'opacity-40',
          )}
        >
          <StatusIcon category={task.statusCategory} color={status?.color} size={12} />
          <button
            type="button"
            onClick={() => openTask(task.key)}
            title={`${task.key} · ${task.title}${task.dueDate ? ` · due ${SHORT.format(parseIsoDate(task.dueDate))}` : ''}`}
            className="min-w-0 flex-1 truncate rounded-xs text-left text-fg hover:text-primary-text focus-visible:outline-2 focus-visible:outline-focus"
          >
            {task.title}
          </button>
          {overdue ? <span aria-label="Past its due date" className="size-1.5 shrink-0 rounded-full bg-danger" /> : null}
          {unit !== 'tasks' ? (
            <span className={cn('shrink-0 text-2xs tabular-nums', load === 0 ? 'text-warning-text' : 'text-fg-muted')} title={load === 0 ? 'No estimate yet' : undefined}>
              {load === 0 ? 'No estimate' : `${formatLoad(load)}${unitLabel.short}`}
            </span>
          ) : share < 0.999 ? (
            <span className="shrink-0 text-2xs text-fg-muted" title={`This task runs across more than one week, so ${Math.round(share * 100)}% of it counts here`}>
              {task.startDate && task.dueDate ? shortRange(task.startDate, task.dueDate) : ''}
            </span>
          ) : null}
        </div>
      </li>
    );
  };

  const teamCapacity = personIds.filter((id) => id !== UNASSIGNED).reduce((sum, id) => sum + capacityFor(settings, id), 0);

  return (
    <div className="flex h-full min-h-[460px] flex-col" data-testid="workload-view">
      <ViewToolbar testId="workload-toolbar">
        <SavedViewsMenu<WorkloadViewOptions>
          kind="workload"
          options={viewOptions(prefs)}
          defaults={viewOptions(DEFAULT_PREFS)}
          activeId={prefs.viewId}
          onApply={(options, viewId) => setPrefs({ ...options, viewId })}
        />
        <Button variant="secondary" size="sm" onClick={() => setAnchor(startOfWeekIso(today))} data-testid="workload-this-week">
          This week
        </Button>
        <span className="flex items-center">
          <IconButton size="sm" label="Earlier weeks" icon={<ChevronLeft aria-hidden />} onClick={() => setAnchor((a) => addDaysIso(a, -7))} />
          <IconButton size="sm" label="Later weeks" icon={<ChevronRight aria-hidden />} onClick={() => setAnchor((a) => addDaysIso(a, 7))} />
        </span>
        <h2 className="truncate text-md font-semibold text-fg" aria-live="polite" data-testid="workload-title">
          {rangeTitle}
        </h2>
        <ToggleGroup<LoadUnit>
          size="sm"
          label="Measure work in"
          value={unit}
          onValueChange={(next) => setPrefs({ unit: next })}
          options={[
            { value: 'tasks', label: 'Tasks' },
            { value: 'points', label: 'Points' },
            { value: 'hours', label: 'Hours' },
          ]}
        />
        <ToolbarSpacer />
        {overloads.length > 0 ? (
          <Tooltip
            content={
              <span className="flex flex-col gap-0.5">
                {overloads.slice(0, 6).map((o) => (
                  <span key={`${o.person}-${o.week}`}>
                    {people.get(o.person)?.name ?? 'Someone'} · week of {SHORT.format(parseIsoDate(o.week))}: {formatLoad(o.load)} of {formatLoad(o.capacity)}
                  </span>
                ))}
                {overloads.length > 6 ? <span>and {overloads.length - 6} more</span> : null}
              </span>
            }
          >
            <span tabIndex={0} data-testid="workload-overloads" className="inline-flex h-7 items-center gap-1.5 rounded-full bg-danger-subtle px-2.5 text-xs font-semibold text-danger-text focus-visible:outline-2 focus-visible:outline-focus">
              <AlertTriangle aria-hidden className="size-3.5" />
              {overloads.length} over capacity
            </span>
          </Tooltip>
        ) : null}
        <CapacityPopover
          unit={unit}
          perWeek={settings.perWeek}
          perPerson={settings.perPerson}
          personIds={personIds.filter((id) => id !== UNASSIGNED)}
          personName={(id) => people.get(id)?.name ?? 'Former member'}
          canEdit={canSetCapacity}
          onSave={(change) => void saveCapacity(change)}
        />
        <OptionsMenu title="Workload options" testId="workload-options">
          <OptionSelect<WorkloadPrefs['weeks']>
            label="Weeks to show"
            value={prefs.weeks}
            onChange={(weeksValue) => setPrefs({ weeks: weeksValue })}
            options={[
              { value: '4', label: '4 weeks' },
              { value: '6', label: '6 weeks' },
              { value: '8', label: '8 weeks' },
              { value: '12', label: '12 weeks' },
            ]}
          />
          <OptionSwitch label="Hide people with no open work" checked={prefs.hideIdle} onChange={(hideIdle) => setPrefs({ hideIdle })} />
        </OptionsMenu>
        <ViewTips
          title="How workload works"
          testId="workload-tips"
          tips={[
            { icon: <Scale />, text: 'Each box shows how much open work someone has that week, compared with how much they can do. Red means too much.' },
            { icon: <Move />, text: 'Drag a task to another person or week to even things out. Drop it on “No date” to clear its dates.' },
            { icon: <Gauge />, text: 'Set how much each person can do in a week with Capacity. Count work in tasks, points or hours.' },
          ]}
        />
      </ViewToolbar>

      {unit !== 'tasks' && unestimated > 0 ? (
        <p role="status" className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-warning-subtle/60 px-4 py-1.5 text-xs text-warning-text sm:px-6">
          <AlertTriangle aria-hidden className="size-3.5" />
          {unestimated} open {unestimated === 1 ? 'task has' : 'tasks have'} no {unit === 'points' ? 'point estimate' : 'time estimate'}, so {unestimated === 1 ? 'it counts' : 'they count'} as zero here.
        </p>
      ) : null}

      {unit === 'tasks' && openTasks.length > 0 ? (
        <p role="status" className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border-subtle bg-muted px-4 py-1.5 text-xs text-fg-secondary sm:px-6" data-testid="workload-tasks-hint">
          <Gauge aria-hidden className="size-3.5 text-icon" />
          <span>
            Counting tasks, so a quick task weighs the same as a big one.{' '}
            {estimatedCount > 0 ? `${estimatedCount} of ${openTasks.length} open tasks have an estimate.` : 'No open task has an estimate yet.'}
          </span>
          {estimatedCount > 0 ? (
            <button type="button" onClick={() => setPrefs({ unit: hoursCount >= pointsCount ? 'hours' : 'points' })} className="rounded-xs font-medium text-fg-link hover:underline focus-visible:outline-2 focus-visible:outline-focus">
              Measure in {hoursCount >= pointsCount ? 'hours' : 'points'}
            </button>
          ) : null}
        </p>
      ) : null}

      {openTasks.length === 0 && personIds.length === 0 ? (
        <div className="flex flex-1 items-center justify-center bg-sunken p-6">
          <EmptyState illustration="board" title="No open work to balance" description="Assign tasks and add dates to see how work is spread across the team." />
        </div>
      ) : narrow ? (
        <PhoneWeek
          onSwipe={(delta) => setAnchor((a) => addDaysIso(a, delta * 7))}
          week={weeks[0] as IsoDate}
          isThisWeek={weeks[0] === thisWeek}
          teamLoad={[...rows.values()].reduce((sum, row) => sum + (row.cells.get(weeks[0] as IsoDate)?.load ?? 0), 0)}
          teamCapacity={teamCapacity}
          meter={meter}
          people={personIds.map((id) => {
            const row = rows.get(id);
            const cell = row?.cells.get(weeks[0] as IsoDate);
            const person = id === UNASSIGNED ? null : people.get(id);
            return {
              id,
              name: person?.name ?? (id === UNASSIGNED ? 'Unassigned' : null),
              image: person?.image ?? null,
              load: cell?.load ?? 0,
              capacity: id === UNASSIGNED ? null : capacityFor(settings, id),
              overdue: row?.cells.get(EARLIER)?.tasks.length ?? 0,
              noDate: row?.cells.get(NO_DATE)?.tasks.length ?? 0,
              chips: !collapsed.has(id) && cell ? cell.tasks.map((entry) => chip(entry, id, weeks[0] as IsoDate)) : [],
            };
          })}
        />
      ) : (
        <div ref={measureGrid} className="min-h-0 flex-1 overflow-auto bg-sunken" data-testid="workload-grid">
          <div role="grid" aria-label={`${project.name} workload`} className="grid min-w-full" style={{ gridTemplateColumns: gridTemplate, width: narrow ? 'max-content' : '100%' }}>
            {/* Header */}
            <div role="row" className="contents">
              <div role="columnheader" className="sticky top-0 left-0 z-[var(--z-header)] flex h-10 items-center justify-between border-r border-b border-border-default bg-panel px-3 text-xs font-semibold text-fg-muted">
                <span>Person</span>
                {personIds.length > 0 ? (
                  <IconButton
                    size="xs"
                    label={allCollapsed ? 'Show everyone’s tasks' : 'Hide everyone’s tasks'}
                    icon={allCollapsed ? <ChevronsUpDown aria-hidden /> : <ChevronsDownUp aria-hidden />}
                    onClick={() => setPrefs({ collapsed: allCollapsed ? [] : personIds })}
                  />
                ) : null}
              </div>
              {buckets.map((bucket) => (
                <div
                  role="columnheader"
                  key={bucket}
                  className={cn('sticky top-0 z-[var(--z-sticky)] flex h-10 items-center border-r border-b border-border-default bg-panel px-3', bucket === thisWeek && 'bg-highlight')}
                >
                  {bucketHeader(bucket)}
                </div>
              ))}
            </div>

            {/* Team total */}
            <div role="row" className="contents" data-testid="workload-team-row">
              <div role="rowheader" className="sticky left-0 z-[var(--z-sticky)] flex items-center gap-2 border-r border-b border-border-subtle bg-muted px-3 py-2.5">
                <Gauge aria-hidden className="size-4 text-icon" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-fg">Whole team</span>
                  <span className="block text-2xs text-fg-muted">
                    {unitText(teamCapacity, unit)} a week
                  </span>
                </span>
              </div>
              {buckets.map((bucket) => {
                let total = 0;
                for (const row of rows.values()) total += row.cells.get(bucket)?.load ?? 0;
                const isWeek = bucket !== EARLIER && bucket !== NO_DATE;
                return (
                  <div role="gridcell" key={bucket} className={cn('border-r border-b border-border-subtle bg-muted px-3 py-2.5', bucket === thisWeek && 'bg-highlight')}>
                    {isWeek ? meter(total, teamCapacity, true) : <span className={cn('text-xs tabular-nums', total > 0 ? 'font-semibold text-fg-secondary' : 'text-fg-muted')}>{total > 0 ? unitText(total, unit) : 'None'}</span>}
                  </div>
                );
              })}
            </div>

            {/* People */}
            {personIds.map((id) => {
              const row = rows.get(id);
              const person = id === UNASSIGNED ? null : people.get(id);
              const capacity = id === UNASSIGNED ? null : capacityFor(settings, id);
              const isCollapsed = collapsed.has(id);
              const custom = id !== UNASSIGNED && settings.perPerson[id] !== undefined;
              const openCount = openByPerson.get(id) ?? 0;
              return (
                <div role="row" key={id} className="group/row contents" data-testid="workload-row" data-person={id}>
                  <div role="rowheader" className="sticky left-0 z-[var(--z-sticky)] flex items-start gap-2 border-r border-b border-border-subtle bg-panel px-2 py-2.5">
                    <button
                      type="button"
                      aria-expanded={!isCollapsed}
                      aria-label={isCollapsed ? `Show tasks for ${person?.name ?? 'Unassigned'}` : `Hide tasks for ${person?.name ?? 'Unassigned'}`}
                      onClick={() => toggleRow(id)}
                      className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-xs text-icon hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus"
                    >
                      {isCollapsed ? <ChevronRight aria-hidden className="size-3.5" /> : <ChevronDown aria-hidden className="size-3.5" />}
                    </button>
                    {narrow ? null : person ? (
                      <Avatar name={person.name} src={person.image} size="sm" />
                    ) : (
                      <span aria-hidden className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-icon">
                        <UserRound className="size-3.5" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-sm font-medium text-fg', narrow ? 'line-clamp-2 break-words' : 'truncate')}>{person?.name ?? (id === UNASSIGNED ? 'Unassigned' : 'Former member')}</span>
                      <span className={cn('block text-2xs text-fg-muted', narrow ? 'break-words' : 'truncate')}>
                        {openCount} open{narrow ? '' : ` ${openCount === 1 ? 'task' : 'tasks'}`}
                        {capacity !== null ? (
                          <>
                            {' · '}
                            {canSetCapacity && !narrow ? (
                              <PersonCapacity
                                name={person?.name ?? 'this person'}
                                value={capacity}
                                custom={custom}
                                unit={unit}
                                teamDefault={settings.perWeek}
                                onSave={(value) => void saveCapacity({ person: { id, value } })}
                              />
                            ) : (
                              <span>
                                {formatLoad(capacity)}
                                {unitLabel.short ? ` ${unitLabel.short}` : ''} a week
                              </span>
                            )}
                          </>
                        ) : null}
                      </span>
                    </span>
                  </div>
                  {buckets.map((bucket) => {
                    const cell = row?.cells.get(bucket);
                    const load = cell?.load ?? 0;
                    const isWeek = bucket !== EARLIER && bucket !== NO_DATE;
                    const level = isWeek && capacity !== null ? loadLevel(load, capacity) : 'empty';
                    const key = `${id}|${bucket}`;
                    return (
                      <div
                        role="gridcell"
                        key={bucket}
                        data-testid="workload-cell"
                        data-bucket={bucket}
                        aria-label={`${person?.name ?? 'Unassigned'}, ${bucket === EARLIER ? 'overdue' : bucket === NO_DATE ? 'no date' : `week of ${SHORT.format(parseIsoDate(bucket))}`}: ${unitText(load, unit)}${isWeek && capacity !== null ? ` of ${unitText(capacity, unit)}` : ''}`}
                        {...dropProps(id, bucket)}
                        className={cn(
                          'flex min-w-0 flex-col gap-2 border-r border-b border-border-subtle bg-panel px-2.5 py-2.5 transition-colors',
                          bucket === thisWeek && 'bg-highlight',
                          level === 'over' && 'bg-[color-mix(in_srgb,var(--danger)_7%,var(--surface-panel))]',
                          bucket === EARLIER && load > 0 && 'bg-[color-mix(in_srgb,var(--danger)_4%,var(--surface-panel))]',
                          over === key && 'bg-primary-subtle shadow-[inset_0_0_0_2px_var(--focus-ring)]',
                        )}
                      >
                        {isWeek && (capacity !== null || load > 0) ? meter(load, capacity) : load > 0 ? <span className="text-xs font-semibold text-fg-secondary tabular-nums">{unitText(load, unit)}</span> : isWeek ? <span className="text-xs text-fg-muted">Nothing scheduled</span> : null}
                        {!isCollapsed && cell && cell.tasks.length > 0 ? <ul className="flex flex-col gap-1">{cell.tasks.map((entry) => chip(entry, id, bucket))}</ul> : null}
                        {!isCollapsed && (!cell || cell.tasks.length === 0) && canEdit && bucket !== EARLIER ? (
                          <span className="hidden text-2xs text-fg-muted group-hover/row:block">Drop a task here</span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {personIds.length === 0 ? (
            <p className="p-6 text-sm text-fg-muted">Nobody has open work in these weeks. Turn off “Hide people with no open work” to see everyone.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function CapacityPopover({
  unit,
  perWeek,
  perPerson,
  personIds,
  personName,
  canEdit,
  onSave,
}: {
  readonly unit: LoadUnit;
  readonly perWeek: number;
  readonly perPerson: Readonly<Record<string, number>>;
  readonly personIds: readonly string[];
  readonly personName: (id: string) => string;
  readonly canEdit: boolean;
  readonly onSave: (change: { perWeek?: number; person?: { id: string; value: number | null } }) => void;
}) {
  const label = UNIT_LABELS[unit];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" leadingIcon={<Gauge aria-hidden />} data-testid="workload-capacity" aria-label="Capacity">
          <span className="max-[639px]:sr-only">Capacity</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80" aria-label="Weekly capacity">
        <h3 className="text-sm font-semibold text-fg">Weekly capacity</h3>
        <p className="mt-1 mb-3 text-xs text-fg-muted">
          How many {label.many} each person can take on in a week. Weeks above this turn red.{canEdit ? '' : ' Only project editors can change it.'}
        </p>
        <CapacityField label="Everyone, by default" value={perWeek} unit={unit} disabled={!canEdit} onCommit={(value) => value !== null && value > 0 && onSave({ perWeek: value })} testId="workload-capacity-default" />
        {personIds.length > 0 ? (
          <>
            <h4 className="mt-4 mb-2 text-xs font-semibold text-fg-secondary">Different for someone?</h4>
            <ul className="flex max-h-60 flex-col gap-2 overflow-y-auto pr-1">
              {personIds.map((id) => (
                <li key={id}>
                  <CapacityField
                    label={personName(id)}
                    value={perPerson[id] ?? null}
                    placeholder={formatLoad(perWeek)}
                    unit={unit}
                    disabled={!canEdit}
                    onCommit={(value) => onSave({ person: { id, value } })}
                  />
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function CapacityField({
  label,
  value,
  placeholder,
  unit,
  disabled,
  onCommit,
  testId,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly placeholder?: string;
  readonly unit: LoadUnit;
  readonly disabled?: boolean;
  readonly onCommit: (value: number | null) => void;
  readonly testId?: string;
}) {
  const [text, setText] = useState(value === null ? '' : formatLoad(value));
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(value === null ? '' : formatLoad(value));
  }
  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === '') {
      if (value !== null) onCommit(null);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0 || n >= 1000) {
      setText(value === null ? '' : formatLoad(value));
      return;
    }
    const rounded = Math.round(n * 10) / 10;
    if (rounded !== value) onCommit(rounded);
  };
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-fg-secondary">
      <span className="min-w-0 truncate">{label}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        <Input
          size="sm"
          inputMode="decimal"
          aria-label={`${label}: ${UNIT_LABELS[unit].many} a week`}
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }
          }}
          containerClassName="w-16"
          className="text-right tabular-nums"
          data-testid={testId}
        />
        <span className="w-10 text-xs text-fg-muted">{UNIT_LABELS[unit].short || 'tasks'}</span>
      </span>
    </label>
  );
}

function PersonCapacity({
  name,
  value,
  custom,
  unit,
  teamDefault,
  onSave,
}: {
  readonly name: string;
  readonly value: number;
  readonly custom: boolean;
  readonly unit: LoadUnit;
  readonly teamDefault: number;
  readonly onSave: (value: number | null) => void;
}) {
  const label = UNIT_LABELS[unit];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="rounded-xs text-fg-muted underline decoration-dotted underline-offset-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-focus" data-testid="workload-person-capacity">
          {formatLoad(value)}
          {label.short ? ` ${label.short}` : ''} a week
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72" aria-label={`Capacity for ${name}`}>
        <h3 className="mb-1 text-sm font-semibold text-fg">{name}</h3>
        <p className="mb-3 text-xs text-fg-muted">How many {label.many} can they take on in a week?</p>
        <CapacityField label="Each week" value={value} unit={unit} onCommit={(next) => onSave(next)} />
        {custom ? (
          <Button variant="ghost" size="sm" className="mt-3" onClick={() => onSave(null)}>
            Use the team default ({formatLoad(teamDefault)})
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** Phones: one week as a list of people, each with a load bar and that week's tasks. Swipe sideways for other weeks. */
function PhoneWeek({
  week,
  isThisWeek,
  teamLoad,
  teamCapacity,
  people,
  meter,
  onSwipe,
}: {
  readonly week: IsoDate;
  readonly isThisWeek: boolean;
  readonly teamLoad: number;
  readonly teamCapacity: number;
  readonly people: readonly {
    readonly id: string;
    readonly name: string | null;
    readonly image: string | null;
    readonly load: number;
    readonly capacity: number | null;
    readonly overdue: number;
    readonly noDate: number;
    readonly chips: readonly ReactNode[];
  }[];
  readonly meter: (load: number, capacity: number | null, team?: boolean) => ReactNode;
  readonly onSwipe: (delta: 1 | -1) => void;
}) {
  const touch = useRef<{ x: number; y: number } | null>(null);
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto bg-sunken px-4 py-3 max-sm:pb-[calc(88px+env(safe-area-inset-bottom))]"
      data-testid="workload-phone"
      data-week={week}
      onTouchStart={(event) => {
        const t = event.touches[0];
        touch.current = t ? { x: t.clientX, y: t.clientY } : null;
      }}
      onTouchEnd={(event) => {
        const start = touch.current;
        const t = event.changedTouches[0];
        touch.current = null;
        if (!start || !t) return;
        const dx = t.clientX - start.x;
        if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(t.clientY - start.y)) onSwipe(dx < 0 ? 1 : -1);
      }}
    >
      <p className="mb-2 flex items-center gap-2 text-xs text-fg-muted">
        {isThisWeek ? <span className="rounded-full bg-primary px-1.5 text-2xs leading-4 font-semibold text-primary-fg">This week</span> : null}
        Swipe sideways for other weeks
      </p>
      <div className="mb-3 rounded-lg border border-border-subtle bg-muted px-3 py-2.5" data-testid="workload-team-row">
        <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-fg">
          <Gauge aria-hidden className="size-4 text-icon" />
          Whole team
        </p>
        {meter(teamLoad, teamCapacity, true)}
      </div>
      <ul className="flex flex-col gap-2">
        {people.map((person) => (
          <li key={person.id} className="rounded-lg border border-border-subtle bg-panel px-3 py-2.5" data-testid="workload-row" data-person={person.id}>
            <div className="mb-1.5 flex min-w-0 items-center gap-2">
              {person.name && person.id !== UNASSIGNED ? (
                <Avatar name={person.name} src={person.image} size="xs" />
              ) : person.id === UNASSIGNED ? (
                <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-icon">
                  <UserRound className="size-3" />
                </span>
              ) : (
                <Skeleton width={20} height={20} rounded="full" />
              )}
              {person.name ? <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{person.name}</span> : <Skeleton width={96} height={12} rounded="full" className="flex-1" />}
              {person.overdue ? <span className="shrink-0 text-2xs font-semibold text-danger-text">{person.overdue} overdue</span> : null}
              {person.noDate ? <span className="shrink-0 text-2xs text-fg-muted">{person.noDate} no date</span> : null}
            </div>
            {person.capacity !== null || person.load > 0 ? meter(person.load, person.capacity) : null}
            {person.chips.length ? <ul className="mt-2 flex flex-col gap-1">{person.chips}</ul> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
