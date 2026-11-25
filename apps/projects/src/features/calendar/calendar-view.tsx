'use client';
/**
 * Calendar: month and week views. Tasks sit on their dates (a task with a start and due date
 * stretches across those days), colored by status or priority.
 *
 * - Drag a task to another day to reschedule it (it keeps its length). Alt + arrow keys do the same.
 * - Click an empty spot on a day to add a task due that day.
 * - Busy days show "+3 more"; tasks without dates wait in the "No dates" tray.
 * Every change is optimistic (useTaskMutations) with an Undo toast.
 */
import { useCallback, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Inbox, Keyboard, MousePointerClick, Move, Plus } from 'lucide-react';
import {
  Button,
  EmptyState,
  IconButton,
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  SearchInput,
  Skeleton,
  ToggleGroup,
  Tooltip,
  cn,
  labelColorStyle,
  toast,
} from '@/components/ui';
import { PersonAvatar, PriorityIcon, StatusIcon } from '@/components/pm';
import { addDaysIso, diffDays, formatRange, parseIsoDate, todayIso, type IsoDate } from '@/lib/dates';
import { useTaskSource } from '@/features/views/task-source';
import { useCardExtras } from '@/features/views/card-extras';
import { usePeopleMap } from '@/lib/hooks/use-people';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { useTaskMutations } from '@/lib/hooks/use-task-mutations';
import type { TaskSummary } from '@/lib/types';
import { useCurrentProject } from '@/features/projects/project-context';
import { useShellStore } from '@/features/shell/store';
import { PRIORITY_LABEL_COLORS, isClosed, taskColor, type ColorBy } from '@/features/timeline/task-colors';
import { toLabelColor } from '@/components/ui/label-color';
import { PRIORITIES, PRIORITY_LABELS } from '@/lib/constants';
import { dragSpan, spanPatch, taskSpan, type Span } from '@/features/timeline/timeline-model';
import { SavedViewsMenu } from '@/features/timeline/saved-views';
import { TASK_MIME, UnscheduledTray } from '@/features/timeline/unscheduled-tray';
import { useIsNarrow, useViewPrefs } from '@/features/timeline/use-view-prefs';
import { OptionSelect, OptionSwitch, OptionsDivider, OptionsMenu, ToolbarSpacer, ViewTips, ViewToolbar } from '@/features/timeline/view-toolbar';
import { eventsOn, hiddenPerColumn, isSegmentVisible, isWeekendIso, layoutWeek, monthWeeks, shiftMonth, weekOf, type CalendarEvent, type WeekSegment } from './calendar-model';

type CalendarMode = 'month' | 'week';
type Plot = 'span' | 'due';

interface CalendarPrefs {
  readonly mode: CalendarMode;
  /** Phones have their own mode (week by default): a 7-column month is unreadable at 390px. */
  readonly phoneMode: CalendarMode;
  readonly colorBy: ColorBy;
  readonly plot: Plot;
  readonly showWeekends: boolean;
  readonly showCompleted: boolean;
  readonly showSubtasks: boolean;
  readonly trayOpen: boolean;
  readonly viewId: string | null;
}

type CalendarViewOptions = Pick<CalendarPrefs, 'mode' | 'colorBy' | 'plot' | 'showWeekends' | 'showCompleted' | 'showSubtasks'>;

const DEFAULT_PREFS: CalendarPrefs = { mode: 'month', phoneMode: 'week', colorBy: 'status', plot: 'span', showWeekends: true, showCompleted: false, showSubtasks: true, trayOpen: false, viewId: null };

function viewOptions(prefs: CalendarPrefs): CalendarViewOptions {
  const { mode, colorBy, plot, showWeekends, showCompleted, showSubtasks } = prefs;
  return { mode, colorBy, plot, showWeekends, showCompleted, showSubtasks };
}

const MONTH_TITLE = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
const WEEKDAY_SHORT = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
const WEEKDAY_LONG = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const MONTH_SHORT = new Intl.DateTimeFormat('en-US', { month: 'short' });
const DAY_HEADER_H = 30;
const SLOT_H = 24;
const MIN_ROW_H = 132;
const WEEK_SLOT_H = 52;
/** Tasks longer than a week draw as slim bands above the day's lanes, so one-day tasks keep room. */
const BAND_H = 16;
const MAX_BANDS = 3;
const isLongEvent = (event: { readonly start: IsoDate; readonly end: IsoDate }) => diffDays(event.start, event.end) >= 7;

type TaskEvent = CalendarEvent<TaskSummary>;

interface DragPayload {
  readonly taskId: string;
  /** The day of the task that was grabbed (so that day lands where it's dropped). */
  readonly grabbed: IsoDate;
}

function weekTitle(days: readonly IsoDate[]): string {
  const first = days[0] as IsoDate;
  const last = days[days.length - 1] as IsoDate;
  const a = parseIsoDate(first);
  const b = parseIsoDate(last);
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  return sameMonth
    ? `${MONTH_SHORT.format(a)} ${a.getDate()} to ${b.getDate()}, ${b.getFullYear()}`
    : `${MONTH_SHORT.format(a)} ${a.getDate()} to ${MONTH_SHORT.format(b)} ${b.getDate()}, ${b.getFullYear()}`;
}

export function CalendarSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading calendar" className="flex flex-1 flex-col gap-3 p-4 sm:px-6">
      <Skeleton height={28} width={260} />
      <div className="grid flex-1 grid-cols-7 gap-px">
        {Array.from({ length: 35 }, (_, i) => (
          <Skeleton key={i} height={96} rounded="sm" />
        ))}
      </div>
    </div>
  );
}

export function CalendarView() {
  const { project, statuses, statusById, capabilities } = useCurrentProject();
  const tasksQuery = useTaskSource();
  const extras = useCardExtras();
  const extraFilter = extras.filter;
  const people = usePeopleMap();
  const { openTask } = useTaskDrawer();
  const openQuickAdd = useShellStore((state) => state.openQuickAdd);
  const { updateTask, createTask } = useTaskMutations({ statusCategory: (id) => statusById.get(id)?.category });
  const [prefs, setPrefs] = useViewPrefs<CalendarPrefs>(`calendar:${project.key}`, DEFAULT_PREFS);
  const narrow = useIsNarrow();
  const today = todayIso();
  const canEdit = capabilities['task:update'];
  const canCreate = capabilities['task:create'] && !extras.hideCreate;
  /** A page (Programs) supplies its own lead and trail: one compact row without task-only controls. */
  const pageToolbar = Boolean(extras.toolbarLead);

  const [anchor, setAnchor] = useState<IsoDate>(today);
  const [search, setSearch] = useState('');
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [overDay, setOverDay] = useState<IsoDate | null>(null);
  const [composer, setComposer] = useState<IsoDate | null>(null);
  const [moreDay, setMoreDay] = useState<IsoDate | null>(null);
  const dragRef = useRef<DragPayload | null>(null);
  const [gridHeight, setGridHeight] = useState(0);
  const gridObserver = useRef<ResizeObserver | null>(null);
  // Fit as many task lanes per day as the screen allows (at least two, plus "+N more").
  const measureGrid = useCallback((node: HTMLDivElement | null) => {
    gridObserver.current?.disconnect();
    if (!node) return;
    gridObserver.current = new ResizeObserver(([entry]) => setGridHeight(Math.round(entry?.contentRect.height ?? 0)));
    gridObserver.current.observe(node);
  }, []);

  const mode: CalendarMode = narrow ? prefs.phoneMode : prefs.mode;
  const allTasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const tasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allTasks.filter((task) => {
      if (!prefs.showCompleted && isClosed(task)) return false;
      if (!prefs.showSubtasks && task.parentTaskId) return false;
      if (q && !task.title.toLowerCase().includes(q) && !task.key.toLowerCase().includes(q)) return false;
      if (extraFilter && !extraFilter(task)) return false;
      return true;
    });
  }, [allTasks, extraFilter, prefs.showCompleted, prefs.showSubtasks, search]);
  const taskById = useMemo(() => new Map(allTasks.map((task) => [task.id, task])), [allTasks]);

  const events = useMemo<TaskEvent[]>(() => {
    const out: TaskEvent[] = [];
    for (const task of tasks) {
      const span = taskSpan(task);
      if (!span) continue;
      const plotted = prefs.plot === 'due' ? { start: span.end, end: span.end } : span;
      out.push({ id: task.id, start: plotted.start, end: plotted.end, item: task });
    }
    return out;
  }, [tasks, prefs.plot]);
  const longEvents = useMemo(() => events.filter(isLongEvent), [events]);
  const shortEvents = useMemo(() => events.filter((event) => !isLongEvent(event)), [events]);
  // Legend: what each color means (statuses with their Board icon, or priorities).
  const legend = useMemo(() => {
    if (prefs.colorBy === 'priority')
      return PRIORITIES.map((priority) => ({ id: priority, label: PRIORITY_LABELS[priority], color: PRIORITY_LABEL_COLORS[priority], icon: priority === 'none' ? null : <PriorityIcon priority={priority} size={12} /> }));
    return statuses
      .filter((status) => prefs.showCompleted || (status.category !== 'done' && status.category !== 'cancelled'))
      .map((status) => ({ id: status.id, label: status.name, color: toLabelColor(status.color, 'blue'), icon: <StatusIcon category={status.category} color={status.color} size={12} /> }));
  }, [prefs.colorBy, prefs.showCompleted, statuses]);
  const unscheduled = useMemo(() => tasks.filter((task) => !task.startDate && !task.dueDate), [tasks]);

  const weeks = useMemo(() => {
    const raw = mode === 'month' ? monthWeeks(anchor) : [weekOf(anchor)];
    return prefs.showWeekends ? raw : raw.map((days) => days.filter((day) => !isWeekendIso(day)));
  }, [anchor, mode, prefs.showWeekends]);
  const columns = weeks[0]?.length ?? 7;
  // The 32px weekday header and the 30px color key share the height with the week rows.
  const rowHeight = Math.max(MIN_ROW_H, Math.floor((gridHeight - 32 - 30) / Math.max(1, weeks.length)));
  const title = mode === 'month' ? MONTH_TITLE.format(parseIsoDate(anchor)) : weekTitle(weekOf(anchor));
  const visibleCount = useMemo(() => {
    const first = weeks[0]?.[0];
    const last = weeks.at(-1)?.at(-1);
    if (!first || !last) return 0;
    return events.filter((event) => event.end >= first && event.start <= last).length;
  }, [events, weeks]);

  const go = (delta: number) => {
    setAnchor((current) => (mode === 'month' ? shiftMonth(current, delta) : addDaysIso(current, delta * 7)));
  };

  // --- Writes ---------------------------------------------------------------------------------

  const reschedule = async (task: TaskSummary, next: Span) => {
    const before = { startDate: task.startDate, dueDate: task.dueDate };
    const saved = await updateTask(task.id, spanPatch(task, next));
    if (!saved) return;
    const span = taskSpan(saved);
    toast.undo(`Moved “${task.title}”`, {
      description: span ? formatRange(span.start === span.end ? null : span.start, span.end) : undefined,
      onUndo: async () => {
        await updateTask(task.id, before);
      },
    });
  };

  const moveTaskBy = (task: TaskSummary, delta: number) => {
    const span = taskSpan(task);
    if (!span || delta === 0) return;
    void reschedule(task, dragSpan(span, 'move', delta));
  };

  const scheduleOn = (task: TaskSummary, day: IsoDate) => {
    const span = taskSpan(task);
    void reschedule(task, span ? dragSpan(span, 'move', diffDays(span.end, day)) : { start: day, end: day });
  };

  const clearDates = async (taskId: string) => {
    const task = taskById.get(taskId);
    if (!task || (!task.startDate && !task.dueDate)) return;
    const before = { startDate: task.startDate, dueDate: task.dueDate };
    const saved = await updateTask(task.id, { startDate: null, dueDate: null });
    if (!saved) return;
    toast.undo(`Cleared the dates on “${task.title}”`, {
      onUndo: async () => {
        await updateTask(task.id, before);
      },
    });
  };

  const addTask = async (day: IsoDate, title: string) => {
    const created = await createTask({ projectId: project.id, title, dueDate: day }, project.key);
    if (created) toast.success(`Added “${created.title}”`, formatRange(null, day));
  };

  // --- Drag and drop (HTML5: works between the grid, the "+ more" list and the tray) -----------

  const onChipDragStart = (event: DragEvent<HTMLElement>, task: TaskSummary, days: readonly IsoDate[], segment?: WeekSegment<TaskSummary>) => {
    let grabbed = task.dueDate ?? task.startDate ?? today;
    const row = event.currentTarget.closest<HTMLElement>('[data-week-row]');
    if (row && segment) {
      const rect = row.getBoundingClientRect();
      const col = Math.min(days.length - 1, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * days.length)));
      const day = days[col];
      if (day) grabbed = day < segment.event.start ? segment.event.start : day > segment.event.end ? segment.event.end : day;
    }
    const payload: DragPayload = { taskId: task.id, grabbed };
    dragRef.current = payload;
    setDragging(payload);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(TASK_MIME, task.id);
    event.dataTransfer.setData('text/plain', task.key);
  };
  const onChipDragEnd = () => {
    dragRef.current = null;
    setDragging(null);
    setOverDay(null);
  };

  const dayDropProps = (day: IsoDate) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!canEdit || !event.dataTransfer.types.includes(TASK_MIME)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (overDay !== day) setOverDay(day);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      const id = event.dataTransfer.getData(TASK_MIME);
      setOverDay(null);
      if (!id || !canEdit) return;
      event.preventDefault();
      const task = taskById.get(id);
      const payload = dragRef.current;
      dragRef.current = null;
      setDragging(null);
      if (!task) return;
      if (extras.moveToDate && task.kind === 'build') {
        const current = task.dueDate ?? task.startDate;
        if (current === day) return;
        const refused = extras.refuseDate?.(task, day) ?? null;
        if (refused) {
          toast.error(`Couldn't move ${task.key}`, refused);
          return;
        }
        void extras.moveToDate(task, day);
        return;
      }
      const span = taskSpan(task);
      if (!span) {
        void reschedule(task, { start: day, end: day });
        return;
      }
      if (payload && payload.taskId === id) {
        // In "due date only" mode the chip sits on the due date; the grabbed day is that date.
        moveTaskBy(task, diffDays(payload.grabbed, day));
      } else {
        scheduleOn(task, day);
      }
    },
  });

  // --- Render ---------------------------------------------------------------------------------

  if (tasksQuery.isLoading) return <CalendarSkeleton />;

  const look = (task: TaskSummary) => labelColorStyle(taskColor(task, prefs.colorBy, statusById));

  const chip = (task: TaskSummary, options: { days: readonly IsoDate[]; segment?: WeekSegment<TaskSummary>; style?: CSSProperties; className?: string; variant: 'chip' | 'band' | 'card' | 'list'; label?: string }) => {
    const { segment, variant } = options;
    const done = isClosed(task);
    const span = taskSpan(task);
    const overdue = !done && Boolean(task.dueDate) && (task.dueDate as string) < today;
    const assignee = task.assigneeId ? people.get(task.assigneeId)?.name : null;
    const status = statusById.get(task.statusId);
    const dateText = span ? (span.start === span.end ? WEEKDAY_LONG.format(parseIsoDate(span.end)) : formatRange(span.start, span.end)) : 'No date';
    // One bar style for every task, keyed to its status color (the same color and icon as the
    // Board column): a light tint with readable text, and a solid left edge where the task starts.
    // A segment that continues from the week before starts with an arrow instead of the edge.
    const starts = !segment?.continuesBefore;
    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
      if (!canEdit || !event.altKey) return;
      const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -7 : event.key === 'ArrowDown' ? 7 : 0;
      if (!delta) return;
      event.preventDefault();
      moveTaskBy(task, delta);
    };
    const tip = (
      <span className="flex max-w-72 flex-col gap-0.5 py-0.5">
        <span className="font-semibold">{task.title}</span>
        <span className="opacity-80">
          {task.key} · {status?.name ?? 'No status'}
          {assignee ? ` · ${assignee}` : ''}
        </span>
        <span className="opacity-80">{dateText}</span>
        {overdue ? <span className="font-medium">Past its due date</span> : null}
      </span>
    );
    return (
      <Tooltip key={`${task.id}-${segment?.startCol ?? variant}`} content={tip} disabled={variant === 'list'} open={dragging ? false : undefined} side="top" delayDuration={350}>
        <button
          type="button"
          data-testid="calendar-task"
          data-task-key={task.key}
          draggable={canEdit}
          onDragStart={(event) => onChipDragStart(event, task, options.days, segment)}
          onDragEnd={onChipDragEnd}
          onClick={(event) => {
            event.stopPropagation();
            setMoreDay(null);
            openTask(task.key);
          }}
          onKeyDown={onKeyDown}
          aria-label={`${task.title}, ${dateText}${overdue ? ', past its due date' : ''}${canEdit ? '. Alt and arrow keys move it' : ''}`}
          style={{ ...look(task), ...options.style }}
          className={cn(
            'group/chip flex min-w-0 items-center gap-1.5 overflow-hidden text-left text-xs font-medium outline-none',
            'transition-[filter,box-shadow,opacity] duration-[var(--duration-fast)] hover:shadow-sm hover:brightness-[0.97] active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
            variant === 'chip' && 'h-[22px] rounded-sm bg-[color-mix(in_srgb,var(--lc-bg)_18%,var(--surface-panel))] px-1.5 text-fg',
            variant === 'chip' && starts && 'border-l-[3px] border-[var(--lc-bg)] pl-1',
            variant === 'band' && 'h-[14px] gap-1 rounded-full bg-[color-mix(in_srgb,var(--lc-bg)_24%,var(--surface-panel))] px-1.5 text-2xs leading-none font-medium text-fg-secondary',
            variant === 'band' && starts && 'shadow-[inset_3px_0_0_var(--lc-bg)]',
            variant === 'card' &&
              'flex-col items-stretch justify-center gap-0.5 rounded-md border border-l-[3px] border-[color-mix(in_srgb,var(--lc-bg)_45%,transparent)] border-l-[var(--lc-bg)] bg-[color-mix(in_srgb,var(--lc-bg)_14%,var(--surface-panel))] px-2 py-1.5 text-fg',
            variant === 'list' && 'h-8 w-full rounded-md border-l-[3px] border-[var(--lc-bg)] px-2 text-fg hover:bg-hover',
            segment?.continuesBefore && 'rounded-l-none',
            segment?.continuesBefore && variant === 'card' && 'border-l',
            segment?.continuesAfter && 'rounded-r-none',
            canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
            dragging?.taskId === task.id && 'opacity-40',
            done && variant !== 'chip' && 'text-fg-muted',
            done && (variant === 'chip' || variant === 'band') && 'text-fg-muted hover:text-fg',
            options.className,
          )}
        >
          {variant === 'card' ? (
            <>
              <span className="flex min-w-0 items-center gap-1.5">
                <StatusIcon category={task.statusCategory} color={status?.color} size={12} />
                <span className={cn('truncate', done && !options.label && 'line-through decoration-1', options.label && 'tabular-nums')}>{options.label ?? task.title}</span>
              </span>
              <span className="flex min-w-0 items-center gap-1.5 text-2xs font-normal text-fg-muted">
                <span className="font-key">{task.key}</span>
                {task.priority !== 'none' ? <PriorityIcon priority={task.priority} size={12} /> : null}
                {overdue ? <span className="font-medium text-danger-text">Overdue</span> : null}
                <span className="ml-auto">
                  <PersonAvatar userId={task.assigneeId} size="xs" />
                </span>
              </span>
            </>
          ) : (
            <>
              {segment?.continuesBefore ? (
                <ArrowLeft aria-label="Continued from the week before" className={cn('shrink-0 opacity-70', variant === 'band' ? 'size-2.5' : 'size-3')} />
              ) : (
                <StatusIcon category={task.statusCategory} color={status?.color} size={variant === 'band' ? 10 : 12} />
              )}
              {overdue ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-danger" /> : null}
              <span className={cn('truncate', done && variant === 'list' && 'line-through decoration-1')}>{options.label ?? task.title}</span>
              {variant === 'list' && !options.label ? (
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  <span className="font-key text-2xs font-normal text-fg-muted">{task.key}</span>
                  <PersonAvatar userId={task.assigneeId} size="xs" />
                </span>
              ) : null}
            </>
          )}
        </button>
      </Tooltip>
    );
  };

  const dayLabel = (day: IsoDate) => {
    const n = Number(day.slice(8, 10));
    return n === 1 ? `${MONTH_SHORT.format(parseIsoDate(day))} 1` : String(n);
  };

  const composerPopover = (day: IsoDate) => (
    <PopoverContent align="start" className="w-80" aria-label={`Add a task on ${WEEKDAY_LONG.format(parseIsoDate(day))}`} onOpenAutoFocus={(event) => event.preventDefault()}>
      <DayComposer
        day={day}
        onCancel={() => setComposer(null)}
        onAdd={(text) => {
          setComposer(null);
          void addTask(day, text);
        }}
        onMore={() => {
          setComposer(null);
          openQuickAdd({ projectId: project.id, dueDate: day });
        }}
      />
    </PopoverContent>
  );

  // The color key is the last thing inside the scrolling month (never a bar pinned over it), so it
  // can't cover the bottom week's bands when the month is taller than the screen.
  const legendKey = (
    <ul className="mt-auto flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border-subtle bg-panel px-3 py-1.5 text-xs text-fg-secondary" aria-label="Color key" data-testid="calendar-legend">
      {legend.map((entry) => (
        <li key={entry.id} className="inline-flex items-center gap-1.5" style={labelColorStyle(entry.color)}>
          {entry.icon ?? <span aria-hidden className="size-2.5 rounded-full bg-[var(--lc-bg)]" />}
          {entry.label}
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5 text-fg-muted max-sm:hidden">
        <span aria-hidden className="h-1.5 w-6 rounded-full bg-sunken shadow-[inset_0_0_0_1px_var(--border-default)]" />
        Slim bands run longer than a week
      </li>
    </ul>
  );

  const summaryMode = Boolean(extras.renderDaySummary) && mode === 'month';
  // Day stacks count every build of the day, done ones included (the ring shows how many are done).
  const summaryByDay = new Map<string, TaskSummary[]>();
  if (summaryMode) {
    for (const task of allTasks) {
      if (!task.dueDate || (extraFilter && !extraFilter(task))) continue;
      summaryByDay.set(task.dueDate, [...(summaryByDay.get(task.dueDate) ?? []), task]);
    }
  }
  const monthGrid = (
    <div ref={measureGrid} className="flex min-h-0 flex-1 flex-col overflow-auto" data-testid="calendar-month">
      <div role="grid" aria-label={title} className="flex shrink-0 flex-col">
      <div role="row" className="sticky top-0 z-[var(--z-sticky)] grid shrink-0 border-b border-border-subtle bg-panel" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {(weeks[0] ?? []).map((day) => (
          <div role="columnheader" key={day} className="h-8 px-2 text-xs leading-8 font-semibold text-fg-muted">
            {narrow ? WEEKDAY_SHORT.format(parseIsoDate(day)).charAt(0) : WEEKDAY_SHORT.format(parseIsoDate(day))}
          </div>
        ))}
      </div>
      {weeks.map((days) => {
        // Every task, long or short, is one bar style at full height in the lanes. A task that runs
        // across weeks repeats its title on every week row (with an arrow when it started earlier),
        // so a continuation is never an unlabeled strip.
        // Tasks longer than a week are slim labelled bands under the day numbers; everything else
        // gets the full-height lanes below them.
        const bandSegments = summaryMode ? [] : layoutWeek(days, longEvents);
        const bandLanes = Math.min(MAX_BANDS, bandSegments.reduce((max, segment) => Math.max(max, segment.slot + 1), 0));
        const shownBands = bandSegments.filter((segment) => segment.slot < bandLanes);
        const segments = summaryMode ? [] : layoutWeek(days, shortEvents);
        const lanesTop = DAY_HEADER_H + (bandLanes ? bandLanes * BAND_H + 4 : 0);
        // Rows grow to show up to 5 lanes before folding into "+N more" (the grid scrolls instead).
        const lanesNeeded = segments.reduce((max, segment) => Math.max(max, segment.slot + 1), 0);
        const height = Math.max(rowHeight, lanesTop + Math.max(3, Math.min(5, lanesNeeded)) * SLOT_H + 6);
        const slots = Math.max(3, Math.floor((height - lanesTop - 6) / SLOT_H));
        const hiddenShort = hiddenPerColumn(segments, days.length, slots);
        const hidden = hiddenShort;
        // Bands past MAX_BANDS still count in the day's "+N more".
        const extraOnly = days.map((_, col) => bandSegments.filter((segment) => segment.slot >= bandLanes && col >= segment.startCol && col < segment.startCol + segment.span).length);
        return (
          <div role="row" key={days[0]} data-week-row className="relative grid shrink-0" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, height }}>
            {days.map((day, col) => {
              const outside = day.slice(0, 7) !== anchor.slice(0, 7);
              const isToday = day === today;
              const dayEvents = eventsOn(day, events);
              return (
                <Popover key={day} open={composer === day} onOpenChange={(open) => setComposer(open ? day : null)}>
                  <PopoverAnchor asChild>
                    <div
                      role="gridcell"
                      data-testid="calendar-day"
                      data-date={day}
                      aria-label={`${WEEKDAY_LONG.format(parseIsoDate(day))}${dayEvents.length ? `, ${dayEvents.length} ${dayEvents.length === 1 ? 'task' : 'tasks'}` : ''}`}
                      {...dayDropProps(day)}
                      onClick={(event) => {
                        if (!canCreate || event.target !== event.currentTarget) return;
                        setComposer(day);
                      }}
                      className={cn(
                        'group/day relative min-w-0 border-r border-b border-border-subtle transition-colors duration-[var(--duration-fast)] last:border-r-0',
                        outside ? 'bg-sunken' : isWeekendIso(day) ? 'bg-muted' : 'bg-panel',
                        canCreate && 'cursor-pointer hover:bg-[color-mix(in_srgb,var(--surface-hover)_45%,transparent)]',
                        overDay === day && 'bg-primary-subtle shadow-[inset_0_0_0_2px_var(--focus-ring)]',
                      )}
                    >
                      <div className="pointer-events-none flex h-[30px] items-center justify-between px-1.5">
                        <span
                          aria-current={isToday ? 'date' : undefined}
                          className={cn(
                            'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-medium whitespace-nowrap tabular-nums',
                            isToday ? 'bg-primary font-semibold text-primary-fg' : outside ? 'text-fg-muted' : 'text-fg-secondary',
                          )}
                        >
                          {dayLabel(day)}
                        </span>
                        {canCreate ? (
                          <button
                            type="button"
                            aria-label={`Add a task on ${WEEKDAY_LONG.format(parseIsoDate(day))}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setComposer(day);
                            }}
                            className="pointer-events-auto inline-flex size-6 items-center justify-center rounded-sm text-icon opacity-0 transition-opacity group-hover/day:opacity-100 hover:bg-hover hover:text-icon-strong focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus max-[767px]:hidden"
                          >
                            <Plus aria-hidden className="size-3.5" />
                          </button>
                        ) : null}
                      </div>
                      {summaryMode && extras.renderDaySummary ? (
                        <div className="relative z-[1] px-1.5 pb-1.5">{extras.renderDaySummary(day, summaryByDay.get(day) ?? [])}</div>
                      ) : null}
                      {(hidden[col] ?? 0) > 0 || (extraOnly[col] ?? 0) > 0 ? (
                        <Popover open={moreDay === day} onOpenChange={(open) => setMoreDay(open ? day : null)}>
                          <PopoverAnchor asChild>
                            <button
                              type="button"
                              data-testid="calendar-more"
                              onClick={(event) => {
                                event.stopPropagation();
                                setMoreDay(day);
                              }}
                              style={(hidden[col] ?? 0) > 0 ? { top: lanesTop + (slots - 1) * SLOT_H } : { bottom: 2 }}
                              className="absolute right-1 left-1 z-[2] flex h-[22px] items-center rounded-sm px-1.5 text-xs font-semibold text-fg-secondary hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
                            >
                              +{(hidden[col] ?? 0) + (extraOnly[col] ?? 0)}
                              <span className={cn(narrow && 'sr-only')}>&nbsp;more</span>
                            </button>
                          </PopoverAnchor>
                          <PopoverContent className="w-72" aria-label={`Everything on ${WEEKDAY_LONG.format(parseIsoDate(day))}`} data-testid="calendar-more-list">
                            <h3 className="mb-2 text-sm font-semibold text-fg">{WEEKDAY_LONG.format(parseIsoDate(day))}</h3>
                            <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
                              {dayEvents.map((event) => (
                                <li key={event.id}>{chip(event.item, { days, variant: 'list' })}</li>
                              ))}
                            </ul>
                          </PopoverContent>
                        </Popover>
                      ) : null}
                    </div>
                  </PopoverAnchor>
                  {composerPopover(day)}
                </Popover>
              );
            })}
            {shownBands.map((segment) =>
              chip(segment.event.item, {
                days,
                segment,
                variant: 'band',
                className: 'absolute z-[1]',
                style: {
                  top: DAY_HEADER_H + segment.slot * BAND_H,
                  left: `calc(${(segment.startCol / columns) * 100}% + ${segment.continuesBefore ? 0 : 4}px)`,
                  width: `calc(${(segment.span / columns) * 100}% - ${(segment.continuesBefore ? 0 : 4) + (segment.continuesAfter ? 0 : 4)}px)`,
                },
              }),
            )}
            {segments
              .filter((segment) => isSegmentVisible(segment, hiddenShort, slots))
              .map((segment) =>
                chip(segment.event.item, {
                  days,
                  segment,
                  variant: 'chip',
                  className: 'absolute z-[1]',
                  style: {
                    top: lanesTop + segment.slot * SLOT_H,
                    left: `calc(${(segment.startCol / columns) * 100}% + ${segment.continuesBefore ? 0 : 4}px)`,
                    width: `calc(${(segment.span / columns) * 100}% - ${(segment.continuesBefore ? 0 : 4) + (segment.continuesAfter ? 0 : 4)}px)`,
                  },
                }),
              )}
          </div>
        );
      })}
      </div>
      {legendKey}
    </div>
  );

  const weekDays = weeks[0] ?? [];
  const summaryByWeekDay = new Map<string, TaskSummary[]>();
  if (extras.renderDaySummary && mode === 'week') {
    for (const task of allTasks) {
      if (!task.dueDate || !weekDays.includes(task.dueDate) || (extraFilter && !extraFilter(task))) continue;
      summaryByWeekDay.set(task.dueDate, [...(summaryByWeekDay.get(task.dueDate) ?? []), task]);
    }
  }
  const weekSegments = layoutWeek(weekDays, events);
  const weekSlots = weekSegments.reduce((max, segment) => Math.max(max, segment.slot + 1), 0);
  // Phones: the week as an agenda, one day per row with full-width task lines (Google Calendar's
  // schedule view). Seven columns at 390px leave about 45px per task, too little to read.
  const agendaList = (
    <div role="list" aria-label={title} className="flex min-h-0 flex-1 flex-col overflow-auto max-sm:pb-[calc(88px+env(safe-area-inset-bottom))]" data-testid="calendar-agenda">
      {weekDays.map((day) => {
        const isToday = day === today;
        const dayEvents = eventsOn(day, events);
        return (
          <section role="listitem" key={day} data-date={day} {...dayDropProps(day)} className={cn('border-b border-border-subtle px-3 py-2', isWeekendIso(day) ? 'bg-sunken' : 'bg-panel', overDay === day && 'bg-primary-subtle')}>
            <div className="flex items-center gap-2">
              <span aria-current={isToday ? 'date' : undefined} className={cn('inline-flex size-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums', isToday ? 'bg-primary text-primary-fg' : 'text-fg')}>
                {Number(day.slice(8, 10))}
              </span>
              <h3 className="text-sm font-semibold text-fg">{WEEKDAY_LONG.format(parseIsoDate(day))}</h3>
              {canCreate ? (
                <button type="button" onClick={() => openQuickAdd({ projectId: project.id, dueDate: day })} aria-label={`Add a task on ${WEEKDAY_LONG.format(parseIsoDate(day))}`} className="ml-auto inline-flex size-8 items-center justify-center rounded-sm text-icon outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus">
                  <Plus aria-hidden className="size-4" />
                </button>
              ) : null}
            </div>
            {dayEvents.length ? (
              <ul className="mt-1 flex flex-col gap-1">
                {dayEvents.map((event) => (
                  <li key={event.id}>{chip(event.item, { days: weekDays, variant: 'list' })}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-0.5 pl-9 text-xs text-fg-muted">Nothing scheduled</p>
            )}
          </section>
        );
      })}
    </div>
  );

  // Builds: the week shows one row per variant (SPEC 5.7), days as columns, builds in the cells.
  const rowGroup = extras.timelineGroup;
  // Every build of the week shows in its row, done ones included (the header ring counts them too).
  const weekRowTasks = rowGroup ? allTasks.filter((task) => task.dueDate && weekDays.includes(task.dueDate) && (!extraFilter || extraFilter(task)) && (!search.trim() || `${task.title} ${task.key}`.toLowerCase().includes(search.trim().toLowerCase()))) : [];
  const weekRowKeys = rowGroup ? rowGroup.order(weekRowTasks) : [];
  const variantWeek = rowGroup ? (
    <div role="grid" aria-label={title} className="flex min-h-0 flex-1 flex-col overflow-auto" data-testid="calendar-week-rows">
      <div role="row" className="sticky top-0 z-[var(--z-sticky)] grid shrink-0 border-b border-border-subtle bg-panel" style={{ gridTemplateColumns: `180px repeat(${columns}, minmax(0, 1fr))` }}>
        <div role="columnheader" className="flex items-center border-r border-border-subtle px-3 text-xs font-semibold text-fg-muted">
          {rowGroup.label}
        </div>
        {weekDays.map((day) => {
          const isToday = day === today;
          const dayTasks = summaryByWeekDay.get(day) ?? [];
          return (
            <div role="columnheader" key={day} className="flex flex-col gap-1 border-r border-border-subtle px-2 py-1.5 last:border-r-0">
              <span className="flex items-center gap-2">
                <span className="text-xs font-semibold text-fg-muted">{WEEKDAY_SHORT.format(parseIsoDate(day))}</span>
                <span aria-current={isToday ? 'date' : undefined} className={cn('inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums', isToday ? 'bg-primary text-primary-fg' : 'text-fg')}>
                  {Number(day.slice(8, 10))}
                </span>
              </span>
              {extras.renderDaySummary && dayTasks.length ? extras.renderDaySummary(day, dayTasks) : null}
            </div>
          );
        })}
      </div>
      {weekRowKeys.length === 0 ? (
        <p className="px-6 py-12 text-center text-sm text-fg-muted">Nothing planned this week.</p>
      ) : (
        weekRowKeys.map((rowKey) => (
          <div role="row" key={rowKey} className="grid shrink-0 border-b border-border-subtle" style={{ gridTemplateColumns: `180px repeat(${columns}, minmax(0, 1fr))` }} data-testid="calendar-week-row">
            <div role="rowheader" className="flex min-w-0 items-start border-r border-border-subtle bg-panel px-3 py-2.5 text-sm font-medium text-fg">
              <span className="truncate">{rowGroup.title(rowKey)}</span>
            </div>
            {weekDays.map((day) => {
              const cellTasks = weekRowTasks.filter((task) => task.dueDate === day && rowGroup.keyOf(task) === rowKey);
              return (
                <div
                  role="gridcell"
                  key={day}
                  data-date={day}
                  {...dayDropProps(day)}
                  className={cn('flex min-h-14 min-w-0 flex-col gap-1 border-r border-border-subtle p-1.5 last:border-r-0', isWeekendIso(day) ? 'bg-sunken' : 'bg-panel', overDay === day && 'bg-primary-subtle')}
                >
                  {cellTasks.map((task) => chip(task, { days: weekDays, variant: 'card', label: extras.calendarChipLabel?.(task) }))}
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  ) : null;

  const weekGrid = (
    <div role="grid" aria-label={title} className="flex min-h-0 flex-1 flex-col overflow-auto" data-testid="calendar-week">
      <div role="row" className="sticky top-0 z-[var(--z-sticky)] grid shrink-0 border-b border-border-subtle bg-panel" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {weekDays.map((day) => {
          const isToday = day === today;
          return (
            <div role="columnheader" key={day} className="flex items-center gap-2 border-r border-border-subtle px-2 py-2 last:border-r-0 max-[639px]:flex-col max-[639px]:gap-0.5 max-[639px]:px-0.5">
              <span className="text-xs font-semibold text-fg-muted">{narrow ? WEEKDAY_SHORT.format(parseIsoDate(day)).charAt(0) : WEEKDAY_SHORT.format(parseIsoDate(day))}</span>
              <span
                aria-current={isToday ? 'date' : undefined}
                className={cn('inline-flex size-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums', isToday ? 'bg-primary text-primary-fg' : 'text-fg')}
              >
                {Number(day.slice(8, 10))}
              </span>
            </div>
          );
        })}
      </div>
      <div role="row" data-week-row className="relative grid flex-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, minHeight: Math.max(420, 12 + weekSlots * WEEK_SLOT_H + 80) }}>
        {weekDays.map((day) => (
          <Popover key={day} open={composer === day} onOpenChange={(open) => setComposer(open ? day : null)}>
            <PopoverAnchor asChild>
              <div
                role="gridcell"
                data-testid="calendar-day"
                data-date={day}
                aria-label={WEEKDAY_LONG.format(parseIsoDate(day))}
                {...dayDropProps(day)}
                onClick={(event) => {
                  if (!canCreate || event.target !== event.currentTarget) return;
                  setComposer(day);
                }}
                className={cn(
                  'group/day relative border-r border-border-subtle transition-colors last:border-r-0',
                  isWeekendIso(day) ? 'bg-sunken' : 'bg-panel',
                  canCreate && 'cursor-pointer hover:bg-[color-mix(in_srgb,var(--surface-hover)_45%,transparent)]',
                  overDay === day && 'bg-primary-subtle shadow-[inset_0_0_0_2px_var(--focus-ring)]',
                )}
              >
                {canCreate ? (
                  <span className="pointer-events-none absolute inset-x-2 bottom-3 text-center text-xs text-fg-muted opacity-0 transition-opacity group-hover/day:opacity-100 max-[767px]:hidden">
                    Click to add a task
                  </span>
                ) : null}
              </div>
            </PopoverAnchor>
            {composerPopover(day)}
          </Popover>
        ))}
        {weekSegments.map((segment) =>
          chip(segment.event.item, {
            days: weekDays,
            segment,
            variant: narrow ? 'chip' : 'card',
            className: 'absolute z-[1]',
            style: {
              top: 8 + segment.slot * (narrow ? SLOT_H + 2 : WEEK_SLOT_H),
              height: narrow ? 22 : WEEK_SLOT_H - 6,
              left: `calc(${(segment.startCol / columns) * 100}% + ${segment.continuesBefore ? 0 : 4}px)`,
              width: `calc(${(segment.span / columns) * 100}% - ${(segment.continuesBefore ? 0 : 4) + (segment.continuesAfter ? 0 : 4)}px)`,
            },
          }),
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-[520px] flex-col" data-testid="calendar-view">
      <ViewToolbar testId="calendar-toolbar" className={pageToolbar ? 'h-12 flex-nowrap py-0' : undefined}>
        {extras.toolbarLead ? (
          <>
            {extras.toolbarLead}
            <span aria-hidden className="mx-0.5 h-5 w-px bg-border-subtle" />
          </>
        ) : null}
        {pageToolbar ? null : (
          <SavedViewsMenu<CalendarViewOptions>
            kind="calendar"
            options={viewOptions(prefs)}
            defaults={viewOptions(DEFAULT_PREFS)}
            activeId={prefs.viewId}
            onApply={(options, viewId) => setPrefs({ ...options, viewId })}
          />
        )}
        <Button variant="secondary" size="sm" onClick={() => setAnchor(today)} data-testid="calendar-today">
          Today
        </Button>
        <span className="flex items-center">
          <IconButton size="sm" label={mode === 'month' ? 'Previous month' : 'Previous week'} icon={<ChevronLeft aria-hidden />} onClick={() => go(-1)} data-testid="calendar-prev" />
          <IconButton size="sm" label={mode === 'month' ? 'Next month' : 'Next week'} icon={<ChevronRight aria-hidden />} onClick={() => go(1)} data-testid="calendar-next" />
        </span>
        <h2 className={cn('min-w-0 truncate font-semibold text-fg', pageToolbar ? 'text-sm whitespace-nowrap' : 'text-md')} aria-live="polite" data-testid="calendar-title">
          {title}
        </h2>
        <ToggleGroup<CalendarMode>
          size="sm"
          label="Calendar view"
          value={mode}
          onValueChange={(next) => setPrefs(narrow ? { phoneMode: next } : { mode: next })}
          options={[
            { value: 'month', label: 'Month' },
            { value: 'week', label: 'Week' },
          ]}
        />
        <ToolbarSpacer />
        <span className={cn('hidden text-xs whitespace-nowrap text-fg-muted tabular-nums', !pageToolbar && '2xl:inline')}>
          {visibleCount} {extras.noun ? (visibleCount === 1 ? extras.noun.singular : extras.noun.plural) : visibleCount === 1 ? 'task' : 'tasks'} this {mode}
        </span>
        <span className={cn('w-40 max-[639px]:w-[100px]', pageToolbar ? 'shrink-0 max-xl:hidden' : '2xl:w-48')}>
          <SearchInput size="sm" value={search} onValueChange={setSearch} placeholder={extras.noun ? `Search ${extras.noun.plural}` : 'Find a task'} aria-label={extras.noun ? `Search ${extras.noun.plural}` : 'Find a task'} />
        </span>
        {extras.toolbarTrail}
        <OptionsMenu title="Calendar options" testId="calendar-options" iconOnly={pageToolbar}>
          {pageToolbar ? null : (
          <>
          <OptionSelect<ColorBy>
            label="Color by"
            value={prefs.colorBy}
            onChange={(colorBy) => setPrefs({ colorBy })}
            options={[
              { value: 'status', label: 'Status' },
              { value: 'priority', label: 'Priority' },
            ]}
          />
          <OptionSelect<Plot>
            label="Show tasks on"
            value={prefs.plot}
            onChange={(plot) => setPrefs({ plot })}
            options={[
              { value: 'span', label: 'Start to due' },
              { value: 'due', label: 'Due date only' },
            ]}
          />
          <OptionsDivider />
          </>
          )}
          <OptionSwitch label="Show weekends" checked={prefs.showWeekends} onChange={(showWeekends) => setPrefs({ showWeekends })} />
          {pageToolbar ? null : <OptionSwitch label="Show subtasks" checked={prefs.showSubtasks} onChange={(showSubtasks) => setPrefs({ showSubtasks })} />}
          <OptionSwitch label={`Hide done ${extras.noun?.plural ?? 'tasks'}`} checked={!prefs.showCompleted} onChange={(hide) => setPrefs({ showCompleted: !hide })} />
        </OptionsMenu>
        {pageToolbar ? null : (
        <Button
          variant={prefs.trayOpen ? 'secondary' : 'ghost'}
          size="sm"
          leadingIcon={<Inbox aria-hidden />}
          data-pressed={prefs.trayOpen}
          aria-pressed={prefs.trayOpen}
          aria-controls="timeline-tray"
          onClick={() => setPrefs({ trayOpen: !prefs.trayOpen })}
          data-testid="calendar-tray-toggle"
        >
          <span className="max-[639px]:sr-only">No dates</span>
          <span className="rounded-full bg-muted px-1.5 text-2xs font-semibold text-fg-secondary tabular-nums">{unscheduled.length}</span>
        </Button>
        )}
        {pageToolbar ? null : (
        <ViewTips
          title="How the calendar works"
          testId="calendar-tips"
          tips={[
            { icon: <Move />, text: 'Drag a task to another day to move it. It keeps the same number of days.' },
            { icon: <MousePointerClick />, text: 'Click an empty spot on any day to add a task that’s due then.' },
            { icon: <Inbox />, text: 'Tasks without dates wait in “No dates”. Drag them onto a day, or drop a task there to clear its dates.' },
            { icon: <Keyboard />, text: 'With a task selected, Alt and the arrow keys move it by a day or a week.' },
          ]}
        />
        )}
      </ViewToolbar>
      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {allTasks.length === 0 ? (
            <div className="flex flex-1 items-center justify-center bg-sunken p-6">
              <EmptyState
                illustration="board"
                title="Nothing on the calendar yet"
                description="Tasks with a due date show up here."
                actions={
                  canCreate ? (
                    <Button leadingIcon={<Plus aria-hidden />} onClick={() => openQuickAdd({ projectId: project.id, dueDate: today })}>
                      Add a task for today
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : mode === 'month' ? (
            monthGrid
          ) : narrow ? (
            agendaList
          ) : (
            variantWeek ?? weekGrid
          )}
        </div>
        {prefs.trayOpen ? (
          <UnscheduledTray
            tasks={unscheduled}
            canEdit={canEdit}
            scheduleLabel="today"
            onClose={() => setPrefs({ trayOpen: false })}
            onOpen={(key) => openTask(key)}
            onSchedule={(task) => void reschedule(task, { start: today, end: today })}
            statusColor={(task) => statusById.get(task.statusId)?.color}
            onDropTask={(id) => void clearDates(id)}
          />
        ) : null}
      </div>
    </div>
  );
}

function DayComposer({ day, onAdd, onCancel, onMore }: { readonly day: IsoDate; readonly onAdd: (title: string) => void; readonly onCancel: () => void; readonly onMore: () => void }) {
  const [text, setText] = useState('');
  return (
    <form
      className="flex flex-col gap-2"
      data-testid="calendar-composer"
      onSubmit={(event) => {
        event.preventDefault();
        const title = text.trim();
        if (title) onAdd(title);
      }}
    >
      <p className="text-xs font-medium text-fg-muted">Due {WEEKDAY_LONG.format(parseIsoDate(day))}</p>
      <Input autoFocus aria-label="Task name" placeholder="What needs to get done?" value={text} onChange={(event) => setText(event.target.value)} data-testid="calendar-composer-title" />
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onMore}>
          More options
        </Button>
        <span className="flex-1" />
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!text.trim()}>
          Add task
        </Button>
      </div>
    </form>
  );
}
