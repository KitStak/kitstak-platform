'use client';
/**
 * Timeline (Gantt). Left: the task tree grouped by section, status or person. Right: a time grid
 * with Days / Weeks / Months / Quarters zoom, weekend shading and a Today line.
 *
 * - Drag a bar to move it, drag its edges to change start or due, arrow keys nudge (Shift resizes).
 * - Drag across an empty row (or a group's "add" row) to set dates or create a dated task.
 * - Drag from the dot at a bar's end onto another bar to say "this has to finish first"; click a
 *   line to remove it or fix a clash. Critical path highlights the tasks that set the end date.
 * - Tasks without dates sit in the "No dates" tray; drag them onto the grid.
 * Every change is optimistic (useTaskMutations) with an Undo toast.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ChevronDown, ChevronRight, Crosshair, Flag, Inbox, Keyboard, Link2, Maximize2, MousePointerClick, MoveHorizontal, Plus, Route, Trash2, X } from 'lucide-react';
import {
  Button,
  EmptyState,
  IconButton,
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  SearchInput,
  Select,
  Skeleton,
  ToggleGroup,
  Tooltip,
  cn,
  labelColorStyle,
  toast,
  type LabelColor,
} from '@/components/ui';
import { PersonAvatar, StatusIcon } from '@/components/pm';
import { addDaysIso, diffDays, formatRange, todayIso, type IsoDate } from '@/lib/dates';
import { qk } from '@/lib/query-keys';
import { useProjectDependencies, useProjectTasks, type DependencyRow } from '@/lib/hooks/use-data';
import { usePeopleMap } from '@/lib/hooks/use-people';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { useTaskMutations } from '@/lib/hooks/use-task-mutations';
import type { MilestoneDTO, TaskSummary } from '@/lib/types';
import { addDependencyAction, removeDependencyAction } from '@/server/actions/tasks';
import { updateMilestoneAction } from '@/server/actions/structure';
import { useCurrentProject } from '@/features/projects/project-context';
import { useShellStore } from '@/features/shell/store';
import {
  DROP_LENGTH_DAYS,
  PX_PER_DAY,
  TIMELINE_ZOOMS,
  ZOOM_LABELS,
  arrowPath,
  buildTicks,
  cascadeShifts,
  computeRange,
  criticalPath,
  dayToX,
  dragSpan,
  fitZoom,
  isConflict,
  rangeBetween,
  spanDays,
  spanPatch,
  taskSpan,
  weekendBands,
  xToDay,
  type DragMode,
  type Span,
  type TimelineZoom,
} from './timeline-model';
import { buildTimelineRows, type TimelineGroup, type TimelineGroupBy, type TimelineRow } from './timeline-rows';
import { isClosed, taskColor, type ColorBy } from './task-colors';
import { useIsNarrow, useViewPrefs } from './use-view-prefs';
import { SavedViewsMenu } from './saved-views';
import { TASK_MIME, UnscheduledTray } from './unscheduled-tray';
import { OptionSelect, OptionSwitch, OptionsDivider, OptionsMenu, ToolbarSpacer, ViewTips, ViewToolbar } from './view-toolbar';

const MIN_BAR_W = 28;
const ROW_H = 36;
const HEADER_H = 52;

interface TimelinePrefs {
  readonly zoom: TimelineZoom;
  readonly groupBy: TimelineGroupBy;
  readonly colorBy: ColorBy;
  readonly showDependencies: boolean;
  readonly showCritical: boolean;
  readonly showSubtasks: boolean;
  readonly showCompleted: boolean;
  readonly showWeekends: boolean;
  readonly trayOpen: boolean;
  readonly collapsed: readonly string[];
  readonly viewId: string | null;
}

/** The options a saved timeline view keeps. */
type TimelineViewOptions = Pick<TimelinePrefs, 'zoom' | 'groupBy' | 'colorBy' | 'showDependencies' | 'showCritical' | 'showSubtasks' | 'showCompleted' | 'showWeekends'>;

const DEFAULT_PREFS: TimelinePrefs = {
  zoom: 'week',
  groupBy: 'section',
  colorBy: 'status',
  showDependencies: true,
  showCritical: false,
  showSubtasks: true,
  showCompleted: true,
  showWeekends: true,
  trayOpen: false,
  collapsed: [],
  viewId: null,
};

function viewOptions(prefs: TimelinePrefs): TimelineViewOptions {
  const { zoom, groupBy, colorBy, showDependencies, showCritical, showSubtasks, showCompleted, showWeekends } = prefs;
  return { zoom, groupBy, colorBy, showDependencies, showCritical, showSubtasks, showCompleted, showWeekends };
}

type Gesture =
  | { readonly type: 'bar'; readonly taskId: string; readonly mode: DragMode; readonly originX: number; readonly delta: number; readonly moved: boolean }
  | { readonly type: 'link'; readonly fromId: string; readonly x0: number; readonly y0: number; readonly x: number; readonly y: number; readonly overId: string | null }
  | { readonly type: 'create'; readonly rowKey: string; readonly target: { kind: 'new'; group: TimelineGroup } | { kind: 'task'; taskId: string }; readonly anchor: IsoDate; readonly current: IsoDate }
  | { readonly type: 'milestone'; readonly id: string; readonly originX: number; readonly delta: number };

const RANGE_TEXT = (span: Span) => `${formatRange(span.start, span.end)} · ${spanDays(span)} ${spanDays(span) === 1 ? 'day' : 'days'}`;

export function TimelineSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading timeline" className="flex flex-1 flex-col gap-3 bg-panel p-5">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
        <div key={row} className="flex h-7 items-center gap-6">
          <Skeleton width={220} height={12} rounded="full" />
          <Skeleton height={22} width={`${18 + ((row * 17) % 36)}%`} rounded="sm" style={{ marginLeft: `${(row * 7) % 28}%` }} />
        </div>
      ))}
    </div>
  );
}

export function TimelineView() {
  const { project, statuses, statusById, capabilities } = useCurrentProject();
  const tasksQuery = useProjectTasks(project.key);
  const depsQuery = useProjectDependencies(project.key);
  const people = usePeopleMap();
  const queryClient = useQueryClient();
  const { openTask } = useTaskDrawer();
  const openQuickAdd = useShellStore((state) => state.openQuickAdd);
  const { updateTask, createTask } = useTaskMutations({ statusCategory: (id) => statusById.get(id)?.category });
  const [prefs, setPrefs] = useViewPrefs<TimelinePrefs>(`timeline:${project.key}`, DEFAULT_PREFS);
  const narrow = useIsNarrow();
  const markerId = useId().replace(/:/g, '');
  const today = todayIso();
  const canEdit = capabilities['task:update'];
  const canCreate = capabilities['task:create'];
  const canMoveMilestones = capabilities['structure:manage'];

  const [search, setSearch] = useState('');
  /** The one bar tooltip that's open (controlled, so a click or drag closes it for good). */
  const [tipFor, setTipFor] = useState<string | null>(null);
  /** A bar you just pressed stays quiet until the pointer leaves it. */
  const tipMuted = useRef<string | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [draft, setDraft] = useState<{ group: TimelineGroup; span: Span; rowKey: string } | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [selectedDep, setSelectedDep] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dropPreview, setDropPreview] = useState<{ day: IsoDate; y: number } | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  /** Left edge of the visible track (in track pixels): keeps header labels and bar labels readable. */
  const [viewX, setViewX] = useState(0);
  const scrollRaf = useRef(0);
  const onGridScroll = useCallback(() => {
    if (scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0;
      setViewX(scroller.current?.scrollLeft ?? 0);
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(scrollRaf.current), []);
  const autoScroll = useRef<{ raf: number; speed: number }>({ raf: 0, speed: 0 });

  const zoom = prefs.zoom;
  const px = PX_PER_DAY[zoom];
  const nameWidth = narrow ? 148 : 300;
  const collapsed = useMemo(() => new Set(prefs.collapsed), [prefs.collapsed]);

  const allTasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const tasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allTasks.filter((task) => {
      if (!prefs.showCompleted && isClosed(task)) return false;
      if (!prefs.showSubtasks && task.parentTaskId) return false;
      if (q && !task.title.toLowerCase().includes(q) && !task.key.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allTasks, prefs.showCompleted, prefs.showSubtasks, search]);
  const taskById = useMemo(() => new Map(allTasks.map((task) => [task.id, task])), [allTasks]);

  // Saved spans (from the server/cache) and the live spans while a gesture is in progress.
  const savedSpans = useMemo(() => {
    const map = new Map<string, Span>();
    for (const task of tasks) {
      const span = taskSpan(task);
      if (span) map.set(task.id, span);
    }
    return map;
  }, [tasks]);
  const spans = useMemo(() => {
    if (!gesture) return savedSpans;
    if (gesture.type === 'bar' && gesture.delta !== 0) {
      const base = savedSpans.get(gesture.taskId);
      if (!base) return savedSpans;
      const next = new Map(savedSpans);
      next.set(gesture.taskId, dragSpan(base, gesture.mode, gesture.delta));
      return next;
    }
    if (gesture.type === 'create' && gesture.target.kind === 'task') {
      const next = new Map(savedSpans);
      next.set(gesture.target.taskId, rangeBetween(gesture.anchor, gesture.current));
      return next;
    }
    return savedSpans;
  }, [gesture, savedSpans]);

  const milestones = useMemo(
    () => project.milestones.filter((m): m is MilestoneDTO & { dueDate: string } => Boolean(m.dueDate)).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [project.milestones],
  );
  const [viewportWidth, setViewportWidth] = useState(0);
  const range = useMemo(() => {
    // Built from saved data only, so it doesn't jump while dragging.
    const base = computeRange(savedSpans.values(), today, [project.startDate, project.dueDate, ...milestones.map((m) => m.dueDate)]);
    // Always fill the screen, even when zoomed far out.
    const minDays = Math.ceil(Math.max(0, viewportWidth - nameWidth) / px) + 1;
    if (base.days >= minDays) return base;
    const end = addDaysIso(base.start, minDays - 1);
    return { start: base.start, end, days: minDays };
  }, [savedSpans, today, project.startDate, project.dueDate, milestones, viewportWidth, nameWidth, px]);
  const trackWidth = range.days * px;
  const ticks = useMemo(() => buildTicks(range, zoom), [range, zoom]);
  const weekends = useMemo(() => (prefs.showWeekends ? weekendBands(range, zoom) : []), [prefs.showWeekends, range, zoom]);

  const rows = useMemo(
    () =>
      buildTimelineRows({
        tasks,
        spans: savedSpans,
        groupBy: prefs.groupBy,
        statuses,
        sections: project.sections,
        personName: (id) => people.get(id)?.name ?? 'Former member',
        collapsed,
        milestonesRow: milestones.length > 0,
        canCreate: canCreate && !search,
      }),
    [tasks, savedSpans, prefs.groupBy, statuses, project.sections, people, collapsed, milestones.length, canCreate, search],
  );
  const rowIndex = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => {
      if (row.kind === 'task') map.set(row.task.id, index);
    });
    return map;
  }, [rows]);

  const unscheduled = useMemo(() => tasks.filter((task) => !savedSpans.has(task.id)), [tasks, savedSpans]);
  const deps = useMemo(() => depsQuery.data ?? [], [depsQuery.data]);
  const critical = useMemo(
    () => (prefs.showCritical ? criticalPath(spans, deps) : { tasks: new Set<string>(), edges: new Set<string>() }),
    [prefs.showCritical, spans, deps],
  );

  // --- Scrolling ------------------------------------------------------------------------------

  const scrollToDay = useCallback(
    (day: IsoDate, behavior: ScrollBehavior = 'smooth') => {
      const node = scroller.current;
      if (!node) return;
      node.scrollTo({ left: Math.max(0, dayToX(range, day, px) - (node.clientWidth - nameWidth) / 3), behavior });
    },
    [nameWidth, px, range],
  );

  const hasGrid = !tasksQuery.isLoading && allTasks.length > 0;
  useEffect(() => {
    const node = scroller.current;
    if (!hasGrid || !node) return;
    const observer = new ResizeObserver(([entry]) => setViewportWidth(Math.round(entry?.contentRect.width ?? 0)));
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasGrid]);

  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (didInitialScroll.current || !tasksQuery.data || !scroller.current) return;
    didInitialScroll.current = true;
    scrollToDay(today, 'auto');
  }, [tasksQuery.data, scrollToDay, today]);

  const setZoom = useCallback(
    (next: TimelineZoom) => {
      const node = scroller.current;
      const centerDay = node ? (node.scrollLeft + (node.clientWidth - nameWidth) / 2) / px : 0;
      setPrefs({ zoom: next });
      requestAnimationFrame(() => {
        if (node) node.scrollLeft = centerDay * PX_PER_DAY[next] - (node.clientWidth - nameWidth) / 2;
      });
    },
    [nameWidth, px, setPrefs],
  );

  const fitAll = useCallback(() => {
    const list = [...savedSpans.values()];
    const node = scroller.current;
    if (list.length === 0 || !node) return;
    const start = list.reduce((min, s) => (s.start < min ? s.start : min), list[0]?.start ?? today);
    const end = list.reduce((max, s) => (s.end > max ? s.end : max), list[0]?.end ?? today);
    const next = fitZoom(diffDays(start, end) + 10, node.clientWidth - nameWidth - 24);
    setPrefs({ zoom: next });
    requestAnimationFrame(() => node.scrollTo({ left: Math.max(0, dayToX(range, addDaysIso(start, -4), PX_PER_DAY[next])), behavior: 'smooth' }));
  }, [nameWidth, range, savedSpans, setPrefs, today]);

  /** Pointer x → px from the start of the track (accounts for horizontal scroll). */
  const trackX = useCallback(
    (clientX: number) => {
      const node = scroller.current;
      if (!node) return 0;
      return clientX - node.getBoundingClientRect().left + node.scrollLeft - nameWidth;
    },
    [nameWidth],
  );
  const trackY = useCallback((clientY: number) => {
    const node = scroller.current;
    if (!node) return 0;
    return clientY - node.getBoundingClientRect().top + node.scrollTop - HEADER_H;
  }, []);

  // Auto-scroll while dragging near the left/right edge.
  const updateAutoScroll = useCallback(
    (clientX: number) => {
      const node = scroller.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const edge = 48;
      const left = rect.left + nameWidth;
      let speed = 0;
      if (clientX < left + edge) speed = -Math.ceil((left + edge - clientX) / 4);
      else if (clientX > rect.right - edge) speed = Math.ceil((clientX - (rect.right - edge)) / 4);
      autoScroll.current.speed = speed;
      if (speed !== 0 && !autoScroll.current.raf) {
        const step = () => {
          const current = scroller.current;
          if (!current || autoScroll.current.speed === 0) {
            autoScroll.current.raf = 0;
            return;
          }
          current.scrollLeft += autoScroll.current.speed;
          autoScroll.current.raf = requestAnimationFrame(step);
        };
        autoScroll.current.raf = requestAnimationFrame(step);
      }
    },
    [nameWidth],
  );
  const stopAutoScroll = () => {
    autoScroll.current.speed = 0;
    if (autoScroll.current.raf) cancelAnimationFrame(autoScroll.current.raf);
    autoScroll.current.raf = 0;
  };

  // --- Writes ---------------------------------------------------------------------------------

  const applyShifts = useCallback(
    async (shifts: ReadonlyMap<string, Span>) => {
      const results = await Promise.all(
        [...shifts].map(([id, span]) => {
          const task = taskById.get(id);
          return task ? updateTask(id, spanPatch(task, span)) : Promise.resolve(undefined);
        }),
      );
      const moved = results.filter(Boolean).length;
      if (moved) toast.success(`Moved ${moved} waiting ${moved === 1 ? 'task' : 'tasks'}`);
    },
    [taskById, updateTask],
  );

  const reschedule = useCallback(
    async (task: TaskSummary, next: Span, verb = 'Moved') => {
      const before = { startDate: task.startDate, dueDate: task.dueDate };
      const patch = spanPatch(task, next);
      const saved = await updateTask(task.id, patch);
      if (!saved) return;
      const after = new Map(savedSpans);
      const savedSpan = taskSpan(saved);
      if (savedSpan) after.set(task.id, savedSpan);
      const shifts = cascadeShifts(after, deps, task.id);
      if (shifts.size > 0) {
        toast.undo(`${verb} “${task.title}”`, {
          description: `${shifts.size} waiting ${shifts.size === 1 ? 'task now starts' : 'tasks now start'} too early.`,
          undoLabel: `Move ${shifts.size === 1 ? 'it' : 'them'} too`,
          onUndo: () => applyShifts(shifts),
        });
        return;
      }
      toast.undo(`${verb} “${task.title}”`, {
        description: savedSpan ? formatRange(savedSpan.start, savedSpan.end) : undefined,
        onUndo: async () => {
          await updateTask(task.id, before);
        },
      });
    },
    [applyShifts, deps, savedSpans, updateTask],
  );

  const setDepsCache = (update: (list: DependencyRow[]) => DependencyRow[]) =>
    queryClient.setQueryData<DependencyRow[]>(qk.projectDependencies(project.key), (list) => update(Array.isArray(list) ? list : []));
  const refreshDeps = () => {
    void queryClient.invalidateQueries({ queryKey: qk.projectDependencies(project.key) });
    void queryClient.invalidateQueries({ queryKey: qk.projectTasks(project.key) });
  };

  const linkTasks = async (blockingTaskId: string, blockedTaskId: string) => {
    if (blockingTaskId === blockedTaskId) return;
    if (deps.some((d) => d.blockingTaskId === blockingTaskId && d.blockedTaskId === blockedTaskId)) return;
    const previous = queryClient.getQueryData<DependencyRow[]>(qk.projectDependencies(project.key));
    setDepsCache((list) => [...list, { id: `pending-${blockingTaskId}-${blockedTaskId}`, blockingTaskId, blockedTaskId, kind: 'finish_to_start', lagDays: 0 }]);
    const result = await addDependencyAction({ blockingTaskId, blockedTaskId });
    if (!result.ok) {
      queryClient.setQueryData(qk.projectDependencies(project.key), previous);
      toast.error("Couldn't link those tasks", result.error.message);
      return;
    }
    refreshDeps();
    const a = taskById.get(blockingTaskId);
    const b = taskById.get(blockedTaskId);
    const aSpan = savedSpans.get(blockingTaskId);
    const bSpan = savedSpans.get(blockedTaskId);
    if (a && b && aSpan && bSpan && isConflict(aSpan, bSpan)) {
      const fixed = dragSpan(bSpan, 'move', diffDays(bSpan.start, addDaysIso(aSpan.end, 1)));
      toast.undo(`“${b.title}” now waits on “${a.title}”`, {
        description: 'It starts before the first task is done.',
        undoLabel: 'Move it later',
        onUndo: () => reschedule(b, fixed),
      });
    } else if (a && b) {
      toast.success(`“${b.title}” now waits on “${a.title}”`);
    }
  };

  const unlink = async (dep: DependencyRow) => {
    setSelectedDep(null);
    const previous = queryClient.getQueryData<DependencyRow[]>(qk.projectDependencies(project.key));
    setDepsCache((list) => list.filter((d) => d.id !== dep.id));
    const result = await removeDependencyAction({ dependencyId: dep.id });
    if (!result.ok) {
      queryClient.setQueryData(qk.projectDependencies(project.key), previous);
      toast.error("Couldn't remove that link", result.error.message);
      return;
    }
    refreshDeps();
    toast.undo('Link removed', {
      onUndo: async () => {
        const again = await addDependencyAction({ blockingTaskId: dep.blockingTaskId, blockedTaskId: dep.blockedTaskId, lagDays: dep.lagDays });
        if (!again.ok) throw new Error(again.error.message);
        refreshDeps();
      },
    });
  };

  const moveMilestone = async (milestone: MilestoneDTO & { dueDate: string }, delta: number) => {
    const dueDate = addDaysIso(milestone.dueDate, delta);
    const previous = milestone.dueDate;
    const result = await updateMilestoneAction({ milestoneId: milestone.id, patch: { dueDate } });
    if (!result.ok) {
      toast.error("Couldn't move that milestone", result.error.message);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: qk.project(project.key) });
    toast.undo(`Moved milestone “${milestone.name}”`, {
      description: formatRange(null, dueDate),
      onUndo: async () => {
        const back = await updateMilestoneAction({ milestoneId: milestone.id, patch: { dueDate: previous } });
        if (!back.ok) throw new Error(back.error.message);
        void queryClient.invalidateQueries({ queryKey: qk.project(project.key) });
      },
    });
  };

  const createFromDraft = async () => {
    if (!draft) return;
    const title = draftTitle.trim();
    if (!title) {
      setDraft(null);
      return;
    }
    const { group, span } = draft;
    setDraft(null);
    setDraftTitle('');
    const created = await createTask(
      {
        projectId: project.id,
        title,
        startDate: span.start,
        dueDate: span.end,
        ...(group.defaults.sectionId !== undefined ? { sectionId: group.defaults.sectionId } : {}),
        ...(group.defaults.statusId ? { statusId: group.defaults.statusId } : {}),
        ...(group.defaults.assigneeId !== undefined ? { assigneeId: group.defaults.assigneeId } : {}),
      },
      project.key,
    );
    if (created) toast.success(`Added “${created.title}”`, formatRange(span.start, span.end));
  };

  // --- Gestures -------------------------------------------------------------------------------

  const begin = (next: Gesture) => {
    setTipFor(null);
    gestureRef.current = next;
    setGesture(next);
    setSelectedDep(null);
  };
  const update = (next: Gesture) => {
    gestureRef.current = next;
    setGesture(next);
  };

  const gestureActive = gesture !== null;
  useEffect(() => {
    if (!gestureActive) return;
    const onMove = (event: PointerEvent) => {
      const current = gestureRef.current;
      if (!current) return;
      updateAutoScroll(event.clientX);
      if (current.type === 'bar' || current.type === 'milestone') {
        const dx = trackX(event.clientX) - current.originX;
        const delta = Math.round(dx / px);
        const moved = current.type === 'bar' ? current.moved || Math.abs(dx) > 3 : true;
        if (delta !== current.delta || (current.type === 'bar' && moved !== current.moved)) update({ ...current, delta, ...(current.type === 'bar' ? { moved } : {}) } as Gesture);
      } else if (current.type === 'link') {
        const hit = document
          .elementsFromPoint(event.clientX, event.clientY)
          .map((el) => el.closest<HTMLElement>('[data-bar-id]'))
          .find((el): el is HTMLElement => Boolean(el));
        const overId = hit?.dataset.barId && hit.dataset.barId !== current.fromId ? hit.dataset.barId : null;
        update({ ...current, x: trackX(event.clientX), y: trackY(event.clientY), overId });
      } else if (current.type === 'create') {
        const day = xToDay(range, trackX(event.clientX), px);
        if (day !== current.current) update({ ...current, current: day });
      }
    };
    const onUp = () => {
      stopAutoScroll();
      const current = gestureRef.current;
      gestureRef.current = null;
      setGesture(null);
      if (!current) return;
      if (current.type === 'bar') {
        const task = taskById.get(current.taskId);
        const base = savedSpans.get(current.taskId);
        if (!task || !base) return;
        if (current.delta === 0) {
          if (!current.moved) openTask(task.key);
          return;
        }
        void reschedule(task, dragSpan(base, current.mode, current.delta), current.mode === 'move' ? 'Moved' : 'Changed dates for');
      } else if (current.type === 'link') {
        if (current.overId) void linkTasks(current.fromId, current.overId);
      } else if (current.type === 'create') {
        const span = rangeBetween(current.anchor, current.current);
        if (current.target.kind === 'task') {
          const task = taskById.get(current.target.taskId);
          if (task) void reschedule(task, span, 'Scheduled');
        } else {
          setDraftTitle('');
          setDraft({ group: current.target.group, span, rowKey: current.rowKey });
        }
      } else if (current.type === 'milestone') {
        const milestone = milestones.find((m) => m.id === current.id);
        if (milestone && current.delta !== 0) void moveMilestone(milestone, current.delta);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      stopAutoScroll();
      gestureRef.current = null;
      setGesture(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
    };
    // Gesture identity changes on every step; listeners read the latest from gestureRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gestureActive]);

  const startBarDrag = (event: ReactPointerEvent, task: TaskSummary, mode: DragMode) => {
    if (event.button !== 0) return;
    tipMuted.current = task.id;
    setTipFor(null);
    event.stopPropagation();
    if (!canEdit) {
      if (mode === 'move') openTask(task.key);
      return;
    }
    event.preventDefault();
    begin({ type: 'bar', taskId: task.id, mode, originX: trackX(event.clientX), delta: 0, moved: false });
  };

  const unmute = (id: string) => {
    if (tipMuted.current === id) tipMuted.current = null;
  };

  const startLink = (event: ReactPointerEvent, task: TaskSummary) => {
    if (event.button !== 0 || !canEdit) return;
    event.stopPropagation();
    event.preventDefault();
    const span = spans.get(task.id);
    const index = rowIndex.get(task.id);
    if (!span || index === undefined) return;
    const x0 = dayToX(range, span.end, px) + px;
    const y0 = index * ROW_H + ROW_H / 2;
    begin({ type: 'link', fromId: task.id, x0, y0, x: x0, y: y0, overId: null });
  };

  const startCreate = (event: ReactPointerEvent, rowKey: string, target: { kind: 'new'; group: TimelineGroup } | { kind: 'task'; taskId: string }) => {
    // On touch screens a drag across the grid scrolls it; creating needs a mouse or pen.
    if (event.button !== 0 || event.pointerType === 'touch') return;
    if (target.kind === 'new' ? !canCreate : !canEdit) return;
    event.preventDefault();
    const day = xToDay(range, trackX(event.clientX), px);
    setDraft(null);
    begin({ type: 'create', rowKey, target, anchor: day, current: day });
  };

  const onBarKey = (event: ReactKeyboardEvent, task: TaskSummary) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setTipFor(null);
      openTask(task.key);
      return;
    }
    if (!canEdit || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    const base = savedSpans.get(task.id);
    if (!base) return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? -1 : 1;
    void reschedule(task, dragSpan(base, event.shiftKey && !task.isMilestone ? 'end' : 'move', delta), event.shiftKey ? 'Changed dates for' : 'Moved');
  };

  const toggleCollapsed = (key: string) =>
    setPrefs({ collapsed: collapsed.has(key) ? prefs.collapsed.filter((k) => k !== key) : [...prefs.collapsed, key] });

  // Tray → grid (HTML5 drag; the tray is a separate panel).
  const onGridDragOver = (event: React.DragEvent) => {
    if (!canEdit || !event.dataTransfer.types.includes(TASK_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const day = xToDay(range, trackX(event.clientX), px);
    const y = trackY(event.clientY);
    if (!dropPreview || dropPreview.day !== day || Math.abs(dropPreview.y - y) > ROW_H / 2) setDropPreview({ day, y });
  };
  const onGridDrop = (event: React.DragEvent) => {
    const id = event.dataTransfer.getData(TASK_MIME);
    setDropPreview(null);
    if (!id) return;
    event.preventDefault();
    const task = taskById.get(id);
    if (!task) return;
    const day = xToDay(range, trackX(event.clientX), px);
    void reschedule(task, { start: day, end: addDaysIso(day, DROP_LENGTH_DAYS[zoom] - 1) }, 'Scheduled');
  };

  // --- Render ---------------------------------------------------------------------------------

  if (tasksQuery.isLoading) return <TimelineSkeleton />;

  if (allTasks.length === 0) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center bg-sunken p-6" data-testid="timeline-view">
        <EmptyState
          illustration="board"
          title="Plan your work on a timeline"
          description="Tasks with start and due dates show up here as bars."
          actions={
            canCreate ? (
              <Button leadingIcon={<Plus aria-hidden />} onClick={() => openQuickAdd({ projectId: project.id })}>
                Add a task
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const todayX = dayToX(range, today, px);
  const showToday = today >= range.start && today <= range.end;
  const bodyHeight = rows.length * ROW_H;
  const selected = selectedDep ? deps.find((d) => d.id === selectedDep.id) : undefined;
  const scheduledCount = tasks.length - unscheduled.length;
  const projectEnd = [...spans.values()].reduce<IsoDate | null>((max, span) => (!max || span.end > max ? span.end : max), null);

  const renderBar = (task: TaskSummary, span: Span) => {
    const color: LabelColor = taskColor(task, prefs.colorBy, statusById);
    const left = dayToX(range, span.start, px);
    const width = spanDays(span) * px;
    const dragging = gesture?.type === 'bar' && gesture.taskId === task.id && gesture.moved;
    const linkTarget = gesture?.type === 'link' && gesture.overId === task.id;
    const isCritical = critical.tasks.has(task.id);
    const dimmed = prefs.showCritical && !isCritical;
    const done = isClosed(task);
    const overdue = !done && span.end < today;
    const assignee = task.assigneeId ? people.get(task.assigneeId)?.name : null;
    const status = statusById.get(task.statusId);
    const progress = task.subtaskCount > 0 ? Math.round((task.subtaskDoneCount / task.subtaskCount) * 100) : done ? 100 : 0;
    const label = `${task.key} ${task.title}, ${RANGE_TEXT(span)}${canEdit ? '. Arrow keys move it, Shift and arrow keys change the due date' : ''}`;
    const tip = (
      <span className="flex max-w-72 flex-col gap-0.5 py-0.5">
        <span className="font-semibold">{task.title}</span>
        <span className="opacity-80">
          {task.key} · {status?.name ?? 'No status'}
          {assignee ? ` · ${assignee}` : ''}
        </span>
        <span className="opacity-80 tabular-nums">{task.isMilestone ? `Milestone · ${formatRange(null, span.end)}` : RANGE_TEXT(span)}</span>
        {task.blockedByCount > 0 ? <span className="opacity-80">Waiting on {task.blockedByCount} {task.blockedByCount === 1 ? 'task' : 'tasks'}</span> : null}
        {isCritical ? <span className="opacity-80">On the critical path</span> : null}
        {overdue ? <span className="font-medium">Past its due date</span> : null}
      </span>
    );
    const live = gesture?.type === 'bar' && gesture.taskId === task.id && gesture.delta !== 0 ? RANGE_TEXT(span) : null;
    const handle =
      canEdit && prefs.showDependencies && !task.isMilestone ? (
        <span
          aria-hidden
          data-testid="timeline-link-handle"
          onPointerDown={(event) => startLink(event, task)}
          className="absolute top-1/2 -right-4 z-[3] flex size-4 -translate-y-1/2 cursor-crosshair touch-none items-center justify-center opacity-0 transition-opacity group-hover/bar:opacity-100"
        >
          <span className="size-2.5 rounded-full border-2 border-[var(--lc-bg)] bg-panel shadow-xs" />
        </span>
      ) : null;

    if (task.isMilestone) {
      const cx = left + width / 2;
      return (
        <div className="group/bar absolute top-1/2 z-[3] -translate-y-1/2" style={{ left: cx - 9, ...labelColorStyle(color) }} onPointerLeave={() => unmute(task.id)}>
          {live ? <LiveLabel text={live} /> : null}
          <Tooltip content={tip} open={!gesture && tipFor === task.id} onOpenChange={(open) => setTipFor(open && tipMuted.current !== task.id ? task.id : null)} side="top" delayDuration={300}>
            <button
              type="button"
              data-bar-id={task.id}
              data-testid="timeline-milestone"
              aria-label={`Milestone: ${label}`}
              onPointerDown={(event) => startBarDrag(event, task, 'move')}
              onKeyDown={(event) => onBarKey(event, task)}
              onClick={(event) => event.preventDefault()}
              className={cn(
                'block size-[18px] touch-none rotate-45 rounded-[4px] border-2 border-panel bg-[var(--lc-bg)] shadow-sm outline-none transition-[filter,opacity]',
                'hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                canEdit ? 'cursor-grab' : 'cursor-pointer',
                dragging && 'cursor-grabbing ring-2 ring-focus/50',
                linkTarget && 'ring-2 ring-primary',
                isCritical && prefs.showCritical && 'ring-2 ring-danger',
                dimmed && 'opacity-40',
                done && 'opacity-60',
              )}
            />
          </Tooltip>
          <span className={cn('pointer-events-none absolute top-1/2 left-7 -translate-y-1/2 text-xs font-medium whitespace-nowrap text-fg', dimmed && 'opacity-50')}>{task.title}</span>
        </div>
      );
    }

    const inside = width >= Math.min(task.title.length * 6.4 + 28, 160);
    return (
      // Very short tasks still get a bar wide enough to see, grab and read (at least 28px).
      <div className="group/bar absolute top-1/2 z-[3] -translate-y-1/2" style={{ left, width: Math.max(width, MIN_BAR_W), ...labelColorStyle(color) }} onPointerLeave={() => unmute(task.id)}>
        {live ? <LiveLabel text={live} /> : null}
        <Tooltip content={tip} open={!gesture && tipFor === task.id} onOpenChange={(open) => setTipFor(open && tipMuted.current !== task.id ? task.id : null)} side="top" delayDuration={300}>
          <button
            type="button"
            data-bar-id={task.id}
            data-testid="timeline-bar"
            aria-label={label}
            onPointerDown={(event) => startBarDrag(event, task, 'move')}
            onKeyDown={(event) => onBarKey(event, task)}
            onClick={(event) => event.preventDefault()}
            className={cn(
              'relative flex h-6 w-full touch-none items-center overflow-hidden rounded-md bg-[var(--lc-bg)] text-left text-xs font-medium text-[var(--lc-fg)] shadow-xs outline-none',
              'transition-[filter,box-shadow,opacity] duration-[var(--duration-fast)] hover:shadow-md hover:brightness-[0.98]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
              canEdit ? 'cursor-grab' : 'cursor-pointer',
              dragging && 'cursor-grabbing shadow-lg ring-2 ring-focus/50',
              linkTarget && 'ring-2 ring-primary ring-offset-1 ring-offset-panel',
              isCritical && prefs.showCritical && 'ring-2 ring-danger ring-offset-1 ring-offset-panel',
              dimmed && 'opacity-35',
              done && !dimmed && 'opacity-70',
            )}
          >
            {progress > 0 && progress < 100 ? (
              <span aria-hidden className="absolute inset-y-0 left-0 bg-[color-mix(in_srgb,var(--lc-bg),black_18%)]" style={{ width: `${progress}%` }} />
            ) : null}
            {inside ? (
              <span className={cn('relative flex min-w-0 items-center gap-1.5 pr-2 pl-2.5', done && 'line-through decoration-1')}>
                {overdue ? <span aria-label="Past its due date" className="size-1.5 shrink-0 rounded-full bg-danger ring-1 ring-panel" /> : null}
                <span className="truncate">{task.title}</span>
              </span>
            ) : null}
            {canEdit ? (
              <>
                <span
                  aria-hidden
                  data-testid="timeline-resize-start"
                  onPointerDown={(event) => startBarDrag(event, task, 'start')}
                  className="absolute inset-y-0 left-0 w-2 cursor-ew-resize opacity-0 group-hover/bar:opacity-100 after:absolute after:inset-y-1.5 after:left-[3px] after:w-0.5 after:rounded-full after:bg-[var(--lc-fg)]/60"
                />
                <span
                  aria-hidden
                  data-testid="timeline-resize-end"
                  onPointerDown={(event) => startBarDrag(event, task, 'end')}
                  className="absolute inset-y-0 right-0 w-2 cursor-ew-resize opacity-0 group-hover/bar:opacity-100 after:absolute after:inset-y-1.5 after:right-[3px] after:w-0.5 after:rounded-full after:bg-[var(--lc-fg)]/60"
                />
              </>
            ) : null}
          </button>
        </Tooltip>
        {handle}
        {!inside && left + Math.max(width, MIN_BAR_W) > viewX - 4 ? (
          <span className={cn('pointer-events-none absolute top-1/2 left-full z-[3] ml-4 flex max-w-64 -translate-y-1/2 items-center gap-1.5 rounded-sm bg-[color-mix(in_srgb,var(--surface-panel)_90%,transparent)] px-1 text-xs leading-5 font-medium whitespace-nowrap text-fg', dimmed && 'opacity-50', done && 'text-fg-muted')}>
            {overdue ? <span aria-label="Past its due date" className="size-1.5 shrink-0 rounded-full bg-danger" /> : null}
            <span className="truncate">{task.title}</span>
          </span>
        ) : null}
      </div>
    );
  };

  const renderRow = (row: TimelineRow) => {
    if (row.kind === 'milestones') {
      return (
        <div key={row.key} role="row" className="flex" style={{ height: ROW_H }}>
          <div role="rowheader" className="sticky left-0 z-[var(--z-sticky)] flex shrink-0 items-center gap-2 border-r border-b border-border-subtle bg-panel px-3 text-xs font-semibold text-fg-muted" style={{ width: nameWidth }}>
            <Flag aria-hidden className="size-3.5" /> Milestones
          </div>
          <div role="gridcell" className="relative border-b border-border-subtle" style={{ width: trackWidth }}>
            {milestones.map((milestone, index) => {
              const next = milestones[index + 1];
              const room = next ? diffDays(milestone.dueDate, next.dueDate) * px : Infinity;
              const showName = room > milestone.name.length * 6.6 + 34;
              const delta = gesture?.type === 'milestone' && gesture.id === milestone.id ? gesture.delta : 0;
              const day = addDaysIso(milestone.dueDate, delta);
              const x = dayToX(range, day, px) + px / 2;
              const complete = Boolean(milestone.completedAt);
              return (
                <div key={milestone.id} className="absolute top-1/2 z-[3] -translate-y-1/2" style={{ left: x - 8 }}>
                  {delta !== 0 ? <LiveLabel text={formatRange(null, day)} /> : null}
                  <Tooltip
                    open={!gesture && tipFor === milestone.id}
                    onOpenChange={(open) => setTipFor(open && tipMuted.current !== milestone.id ? milestone.id : null)}
                    side="top"
                    content={
                      <span className="flex flex-col gap-0.5">
                        <span className="font-semibold">{milestone.name}</span>
                        <span className="opacity-80">{formatRange(null, milestone.dueDate)}</span>
                        <span className="opacity-80">
                          {milestone.doneCount} of {milestone.taskCount} tasks done{complete ? ' · Reached' : ''}
                        </span>
                      </span>
                    }
                  >
                    <button
                      type="button"
                      data-testid="timeline-project-milestone"
                      aria-label={`Milestone ${milestone.name}, ${formatRange(null, milestone.dueDate)}${canMoveMilestones ? '. Drag to move it' : ''}`}
                      onPointerLeave={() => unmute(milestone.id)}
                      onPointerDown={(event) => {
                        tipMuted.current = milestone.id;
                        setTipFor(null);
                        if (event.button !== 0 || !canMoveMilestones) return;
                        event.preventDefault();
                        begin({ type: 'milestone', id: milestone.id, originX: trackX(event.clientX), delta: 0 });
                      }}
                      onKeyDown={(event) => {
                        if (!canMoveMilestones || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
                        event.preventDefault();
                        void moveMilestone(milestone, event.key === 'ArrowLeft' ? -1 : 1);
                      }}
                      className={cn(
                        'block size-4 rotate-45 rounded-[3px] border-2 border-panel shadow-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                        complete ? 'bg-success' : 'bg-fg',
                        canMoveMilestones ? 'cursor-grab' : 'cursor-default',
                      )}
                    />
                  </Tooltip>
                  {showName || delta !== 0 ? (
                    // Above the today line (z-[2]) on a panel chip, so a milestone just before today stays readable.
                    <span className="pointer-events-none absolute top-1/2 left-5 -translate-y-1/2 rounded-xs bg-panel px-1 text-xs leading-5 font-semibold whitespace-nowrap text-fg-secondary">{milestone.name}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    if (row.kind === 'group') {
      const { group } = row;
      return (
        <div key={row.key} role="row" className="flex" style={{ height: ROW_H, ...labelColorStyle(group.color) }} data-testid="timeline-group">
          <div
            role="rowheader"
            className="sticky left-0 z-[var(--z-sticky)] flex shrink-0 items-center gap-1 border-r border-b border-border-subtle bg-muted pr-1.5"
            style={{ width: nameWidth, boxShadow: 'inset 3px 0 0 var(--lc-bg)' }}
          >
            <button
              type="button"
              aria-expanded={!row.collapsed}
              onClick={() => toggleCollapsed(row.key)}
              className="ml-1.5 flex h-7 min-w-0 flex-1 items-center gap-1 rounded-sm px-1 text-left text-sm font-semibold text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
            >
              {row.collapsed ? <ChevronRight aria-hidden className="size-4 shrink-0 text-icon" /> : <ChevronDown aria-hidden className="size-4 shrink-0 text-icon" />}
              <span className="truncate">{group.title}</span>
              <span
                className="shrink-0 text-xs font-normal text-fg-muted tabular-nums"
                title={row.subtasks ? `${row.count} ${row.count === 1 ? 'task' : 'tasks'}, ${row.subtasks} ${row.subtasks === 1 ? 'subtask' : 'subtasks'}` : `${row.count} ${row.count === 1 ? 'task' : 'tasks'}`}
                data-testid="timeline-group-count"
              >
                {row.count}
              </span>
            </button>
            {canCreate ? (
              <IconButton
                size="xs"
                label={`Add a task to ${group.title}`}
                icon={<Plus aria-hidden />}
                onClick={() => openQuickAdd({ projectId: project.id, ...group.defaults })}
              />
            ) : null}
          </div>
          <div role="gridcell" className="relative border-b border-border-subtle bg-[color-mix(in_srgb,var(--surface-muted)_60%,transparent)]" style={{ width: trackWidth }}>
            {row.summary ? (
              <span
                aria-hidden
                data-testid="timeline-summary"
                className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[var(--lc-bg)] opacity-70"
                style={{ left: dayToX(range, row.summary.start, px), width: Math.max(6, spanDays(row.summary) * px) }}
              />
            ) : null}
          </div>
        </div>
      );
    }
    if (row.kind === 'add') {
      const creating = gesture?.type === 'create' && gesture.rowKey === row.key ? rangeBetween(gesture.anchor, gesture.current) : null;
      const pending = draft?.rowKey === row.key ? draft.span : null;
      const ghost = creating ?? pending;
      return (
        <div key={row.key} role="row" className="group/add flex" style={{ height: ROW_H }}>
          <div role="rowheader" className="sticky left-0 z-[var(--z-sticky)] flex shrink-0 items-center border-r border-b border-border-subtle bg-panel px-2" style={{ width: nameWidth }}>
            <button
              type="button"
              data-testid="timeline-add-task"
              onClick={() => openQuickAdd({ projectId: project.id, ...row.group.defaults })}
              className="flex h-7 items-center gap-1.5 rounded-sm px-1.5 text-xs font-medium text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
            >
              <Plus aria-hidden className="size-3.5" /> Add task
            </button>
          </div>
          <div
            role="gridcell"
            data-testid="timeline-create-lane"
            aria-label={`Drag across to add a task with dates${row.group.id !== 'all' ? ` in ${row.group.title}` : ''}`}
            onPointerDown={(event) => startCreate(event, row.key, { kind: 'new', group: row.group })}
            className="relative cursor-crosshair border-b border-border-subtle"
            style={{ width: trackWidth }}
          >
            {!ghost ? (
              <span className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-xs text-fg-muted opacity-0 transition-opacity group-hover/add:opacity-100 max-[639px]:hidden" style={{ left: todayX + 8 }}>
                Drag here to add a task with dates
              </span>
            ) : null}
            {ghost ? (
              <Popover
                open={Boolean(pending)}
                onOpenChange={(open) => {
                  if (!open) setDraft(null);
                }}
              >
                <PopoverAnchor asChild>
                  <span
                    data-testid="timeline-draft"
                    className="absolute top-1/2 h-6 -translate-y-1/2 rounded-md border-2 border-dashed border-primary bg-primary-subtle"
                    style={{ left: dayToX(range, ghost.start, px), width: spanDays(ghost) * px }}
                  >
                    {creating ? <LiveLabel text={RANGE_TEXT(creating)} /> : null}
                  </span>
                </PopoverAnchor>
                <PopoverContent align="start" className="w-80" aria-label="New task" onOpenAutoFocus={(event) => event.preventDefault()}>
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void createFromDraft();
                    }}
                  >
                    <p className="text-xs text-fg-muted tabular-nums">{pending ? RANGE_TEXT(pending) : ''}</p>
                    <Input autoFocus aria-label="Task name" placeholder="What needs to get done?" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} data-testid="timeline-draft-title" />
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>
                        Cancel
                      </Button>
                      <Button type="submit" size="sm" disabled={!draftTitle.trim()}>
                        Add task
                      </Button>
                    </div>
                  </form>
                </PopoverContent>
              </Popover>
            ) : null}
          </div>
        </div>
      );
    }
    const { task, depth } = row;
    const span = spans.get(task.id);
    const creating = gesture?.type === 'create' && gesture.target.kind === 'task' && gesture.target.taskId === task.id;
    return (
      <div key={row.key} role="row" className="group/row flex" style={{ height: ROW_H }} data-testid="timeline-row" data-task-key={task.key}>
        <div
          role="rowheader"
          className="sticky left-0 z-[var(--z-sticky)] flex shrink-0 items-center gap-1.5 border-r border-b border-border-subtle bg-panel pr-2 group-hover/row:bg-muted"
          style={{ width: nameWidth, paddingLeft: 8 + depth * (narrow ? 10 : 18) }}
        >
          {row.hasChildren ? (
            <button
              type="button"
              aria-label={row.collapsed ? `Show subtasks of ${task.title}` : `Hide subtasks of ${task.title}`}
              aria-expanded={!row.collapsed}
              onClick={() => toggleCollapsed(row.key)}
              className="flex size-5 shrink-0 items-center justify-center rounded-xs text-icon hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus"
            >
              {row.collapsed ? <ChevronRight aria-hidden className="size-3.5" /> : <ChevronDown aria-hidden className="size-3.5" />}
            </button>
          ) : (
            <span aria-hidden className="w-5 shrink-0" />
          )}
          <StatusIcon category={task.statusCategory} color={statusById.get(task.statusId)?.color} />
          <button
            type="button"
            onClick={() => openTask(task.key)}
            title={task.title}
            className={cn(
              'min-w-0 flex-1 truncate rounded-xs text-left text-sm text-fg hover:text-primary-text focus-visible:outline-2 focus-visible:outline-focus',
              isClosed(task) && 'text-fg-muted line-through decoration-1',
            )}
          >
            {task.title}
          </button>
          {!narrow ? <PersonAvatar userId={task.assigneeId} size="xs" /> : null}
        </div>
        <div
          role="gridcell"
          className={cn('relative border-b border-border-subtle group-hover/row:bg-[color-mix(in_srgb,var(--surface-hover)_55%,transparent)]', !span && canEdit && 'cursor-crosshair')}
          style={{ width: trackWidth }}
          onPointerDown={span ? undefined : (event) => startCreate(event, row.key, { kind: 'task', taskId: task.id })}
        >
          {span ? renderBar(task, span) : null}
          {!span && !creating && canEdit ? (
            <span className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-xs text-fg-muted opacity-0 group-hover/row:opacity-100 max-[639px]:hidden" style={{ left: todayX + 8 }}>
              No dates yet. Drag across to set them.
            </span>
          ) : null}
        </div>
      </div>
    );
  };

  // Dependency arrows (only between bars that are on screen in the tree).
  const arrows = prefs.showDependencies
    ? deps.flatMap((dep) => {
        const a = spans.get(dep.blockingTaskId);
        const b = spans.get(dep.blockedTaskId);
        const ia = rowIndex.get(dep.blockingTaskId);
        const ib = rowIndex.get(dep.blockedTaskId);
        if (!a || !b || ia === undefined || ib === undefined) return [];
        const ta = taskById.get(dep.blockingTaskId);
        const tb = taskById.get(dep.blockedTaskId);
        const x1 = ta?.isMilestone ? dayToX(range, a.end, px) + px / 2 + 10 : dayToX(range, a.end, px) + px;
        const x2 = tb?.isMilestone ? dayToX(range, b.start, px) + px / 2 - 10 : dayToX(range, b.start, px);
        const y1 = ia * ROW_H + ROW_H / 2;
        const y2 = ib * ROW_H + ROW_H / 2;
        const conflict = isConflict(a, b, dep.lagDays);
        const crit = critical.edges.has(dep.id);
        return [{ dep, d: arrowPath(x1, y1, x2, y2, ROW_H), conflict, crit, mid: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 } }];
      })
    : [];

  return (
    <div className="flex h-full min-h-[460px] flex-col" data-testid="timeline-view">
      <ViewToolbar testId="timeline-toolbar">
        <SavedViewsMenu<TimelineViewOptions>
          kind="timeline"
          options={viewOptions(prefs)}
          defaults={viewOptions(DEFAULT_PREFS)}
          activeId={prefs.viewId}
          onApply={(options, viewId) => setPrefs({ ...options, viewId, collapsed: [] })}
        />
        <Button variant="secondary" size="sm" leadingIcon={<Crosshair aria-hidden />} onClick={() => scrollToDay(today)} aria-label="Jump to today" data-testid="timeline-today-button">
          <span className="max-[639px]:sr-only">Today</span>
        </Button>
        {narrow ? (
          <span className="w-28">
            <Select size="sm" aria-label="Zoom" value={zoom} onValueChange={(value) => setZoom(value as TimelineZoom)} options={TIMELINE_ZOOMS.map((z) => ({ value: z, label: ZOOM_LABELS[z] }))} />
          </span>
        ) : (
          <ToggleGroup size="sm" label="Zoom" value={zoom} onValueChange={setZoom} options={TIMELINE_ZOOMS.map((z) => ({ value: z, label: ZOOM_LABELS[z] }))} />
        )}
        <Button variant="ghost" size="sm" leadingIcon={<Maximize2 aria-hidden />} onClick={fitAll} disabled={savedSpans.size === 0} aria-label="Fit all bars on screen">
          <span className="max-[1535px]:sr-only">Fit</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<Route aria-hidden />}
          data-pressed={prefs.showCritical}
          aria-pressed={prefs.showCritical}
          onClick={() => setPrefs({ showCritical: !prefs.showCritical })}
          data-testid="timeline-critical"
          title="Highlight the tasks that decide when the project ends"
        >
          <span className="max-[1279px]:sr-only">Critical path</span>
        </Button>
        <ToolbarSpacer />
        <span className="hidden text-xs whitespace-nowrap text-fg-muted tabular-nums 2xl:inline">
          {scheduledCount} of {tasks.length} scheduled
        </span>
        <span className="w-40 max-[639px]:w-32 2xl:w-48">
          <SearchInput size="sm" value={search} onValueChange={setSearch} placeholder="Find a task" aria-label="Find a task" />
        </span>
        <OptionsMenu title="Timeline options" testId="timeline-options">
          <OptionSelect<TimelineGroupBy>
            label="Group by"
            value={prefs.groupBy}
            onChange={(groupBy) => setPrefs({ groupBy, collapsed: [] })}
            options={[
              { value: 'section', label: 'Section' },
              { value: 'status', label: 'Status' },
              { value: 'assignee', label: 'Person' },
              { value: 'none', label: 'No groups' },
            ]}
          />
          <OptionSelect<ColorBy>
            label="Color bars by"
            value={prefs.colorBy}
            onChange={(colorBy) => setPrefs({ colorBy })}
            options={[
              { value: 'status', label: 'Status' },
              { value: 'priority', label: 'Priority' },
            ]}
          />
          <OptionsDivider />
          <OptionSwitch label="Show links between tasks" description="Arrows from a task to the tasks waiting on it." checked={prefs.showDependencies} onChange={(showDependencies) => setPrefs({ showDependencies })} />
          <OptionSwitch label="Show subtasks" checked={prefs.showSubtasks} onChange={(showSubtasks) => setPrefs({ showSubtasks })} />
          <OptionSwitch label="Show finished tasks" checked={prefs.showCompleted} onChange={(showCompleted) => setPrefs({ showCompleted })} />
          <OptionSwitch label="Shade weekends" checked={prefs.showWeekends} onChange={(showWeekends) => setPrefs({ showWeekends })} />
        </OptionsMenu>
        <Button
          variant={prefs.trayOpen ? 'secondary' : 'ghost'}
          size="sm"
          leadingIcon={<Inbox aria-hidden />}
          data-pressed={prefs.trayOpen}
          aria-pressed={prefs.trayOpen}
          aria-controls="timeline-tray"
          onClick={() => setPrefs({ trayOpen: !prefs.trayOpen })}
          data-testid="timeline-tray-toggle"
        >
          <span className="max-[639px]:sr-only">No dates</span>
          <span className="rounded-full bg-muted px-1.5 text-2xs font-semibold text-fg-secondary tabular-nums">{unscheduled.length}</span>
        </Button>
        <ViewTips
          title="How the timeline works"
          testId="timeline-tips"
          tips={[
            { icon: <MoveHorizontal />, text: 'Drag a bar to move it. Drag either end to change the start or due date.' },
            { icon: <MousePointerClick />, text: 'Drag across an empty row to give a task dates, or across an “Add task” row to make a new one.' },
            { icon: <Link2 />, text: 'Drag the dot at the end of a bar onto another bar to say “this has to finish first”. Click a line to remove it.' },
            { icon: <Route />, text: 'Critical path shows the tasks that decide when the project ends.' },
            { icon: <Keyboard />, text: 'With a bar selected, arrow keys move it a day. Hold Shift to change its due date.' },
          ]}
        />
      </ViewToolbar>
      {prefs.showCritical ? (
        <div role="status" data-testid="timeline-critical-banner" className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border-subtle bg-danger-subtle/60 px-4 py-1.5 text-xs text-fg-secondary sm:px-6">
          <Route aria-hidden className="size-3.5 text-danger-text" />
          <span className="font-semibold text-danger-text">Critical path</span>
          <span>
            {critical.tasks.size === 0
              ? 'Give tasks dates to see which ones decide the end date.'
              : `${critical.tasks.size} ${critical.tasks.size === 1 ? 'task decides' : 'tasks decide'} when this project ends${projectEnd ? ` (${formatRange(null, projectEnd).replace('Due ', '')})` : ''}. ${critical.tasks.size === 1 ? 'If it slips' : 'If one of them slips'}, the end date slips too.`}
            {deps.length === 0 && critical.tasks.size > 0 ? ' Link tasks to see the full chain.' : ''}
          </span>
          <button type="button" onClick={() => setPrefs({ showCritical: false })} className="ml-auto rounded-xs font-medium text-fg-secondary hover:text-fg focus-visible:outline-2 focus-visible:outline-focus">
            Turn off
          </button>
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1">
        <div
          ref={scroller}
          role="grid"
          aria-label={`${project.name} timeline`}
          aria-rowcount={rows.length}
          data-testid="timeline-grid"
          onDragOver={onGridDragOver}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropPreview(null);
          }}
          onDrop={onGridDrop}
          onScroll={onGridScroll}
          className={cn('relative min-h-0 flex-1 overflow-auto overscroll-contain bg-panel', gesture && 'select-none', gesture?.type === 'bar' && gesture.mode !== 'move' && 'cursor-ew-resize')}
        >
          <div className="relative" style={{ width: nameWidth + trackWidth, minHeight: '100%' }}>
            {/* Background: weekends, gridlines, today, milestone markers. */}
            <div aria-hidden className="pointer-events-none absolute top-0 bottom-0" style={{ left: nameWidth, width: trackWidth }}>
              {weekends.map((band) => (
                <span key={band.key} className="absolute bottom-0 bg-[color-mix(in_srgb,var(--surface-sunken)_85%,transparent)]" style={{ left: band.x, width: band.width, top: HEADER_H }} />
              ))}
              {ticks.minor.map((tick) =>
                tick.width >= 18 ? <span key={`m${tick.key}`} className="absolute bottom-0 w-px bg-[color-mix(in_srgb,var(--border-subtle)_60%,transparent)]" style={{ left: tick.x, top: HEADER_H }} /> : null,
              )}
              {ticks.major.map((tick) => (
                <span key={`M${tick.key}`} className="absolute bottom-0 w-px bg-border-subtle" style={{ left: tick.x, top: HEADER_H }} />
              ))}
              {milestones.map((m) => (
                <span key={m.id} className="absolute bottom-0 w-0 border-l border-dashed border-border-strong" style={{ left: dayToX(range, m.dueDate, px) + px / 2, top: HEADER_H }} />
              ))}
              {project.dueDate ? (
                <span className="absolute bottom-0 w-0 border-l-2 border-dotted border-fg-muted/60" style={{ left: dayToX(range, project.dueDate, px) + px, top: HEADER_H }} title="Project due date" />
              ) : null}
              {showToday ? <span className="absolute bottom-0 z-[2] w-0.5 bg-primary" style={{ left: todayX + px / 2 - 1, top: HEADER_H }} data-testid="timeline-today-line" /> : null}
              {dropPreview ? (
                <span
                  className="absolute z-[2] h-6 rounded-md border-2 border-dashed border-primary bg-primary-subtle"
                  style={{ left: dayToX(range, dropPreview.day, px), width: DROP_LENGTH_DAYS[zoom] * px, top: HEADER_H + Math.max(0, dropPreview.y) - 12 }}
                />
              ) : null}
            </div>

            {/* Header */}
            <div role="row" className="sticky top-0 z-[var(--z-header)] flex" style={{ height: HEADER_H }}>
              <div role="columnheader" className="sticky left-0 z-[1] flex shrink-0 items-end justify-between border-r border-b border-border-default bg-panel px-3 pb-2 text-xs font-semibold text-fg-muted" style={{ width: nameWidth }}>
                <span>Task</span>
                {!narrow && rows.some((r) => r.kind === 'group') ? (
                  <button
                    type="button"
                    onClick={() =>
                      setPrefs({
                        collapsed: rows.some((r) => r.kind === 'group' && !r.collapsed) ? rows.filter((r) => r.kind === 'group').map((r) => r.key) : [],
                      })
                    }
                    className="rounded-xs font-medium text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    {rows.some((r) => r.kind === 'group' && !r.collapsed) ? 'Collapse all' : 'Expand all'}
                  </button>
                ) : null}
              </div>
              <div role="columnheader" className="relative shrink-0 border-b border-border-default bg-panel" style={{ width: trackWidth }}>
                <div className="relative h-6 border-b border-border-subtle">
                  {ticks.major.map((tick) => {
                    // The label sits at the left of the visible part of its month, and shortens
                    // ("Oct") or hides when too little of the month is on screen, instead of clipping.
                    const start = Math.max(tick.x, viewX);
                    // Stop before the Today flag that shares this row (about 48px wide, centred on today).
                    const flag = showToday ? todayX + px / 2 - 26 : Infinity;
                    const room = Math.min(tick.x + tick.width, flag > start ? flag : Infinity) - start;
                    // Under ~72px of a month on screen, its name is left out (it reads as a clipped sliver).
                    const text = room >= tick.label.length * 7.5 + 20 ? tick.label : room >= 72 ? tick.label.slice(0, 3) : '';
                    return (
                      <div key={tick.key} title={text ? undefined : tick.label} className="absolute top-0 h-6 border-l border-border-subtle text-xs leading-6 font-semibold text-fg" style={{ left: tick.x, width: tick.width }}>
                        <span className="absolute top-0 block truncate px-2" style={{ left: start - tick.x, maxWidth: Math.max(0, room) }}>
                          {text}
                        </span>
                      </div>
                    );
                  })}
                  {showToday ? (
                    <span className="absolute top-1 z-[1] -translate-x-1/2 rounded-sm bg-primary px-1.5 text-2xs leading-4 font-semibold text-primary-fg shadow-xs" style={{ left: todayX + px / 2 }} data-testid="timeline-today-flag">
                      Today
                    </span>
                  ) : null}
                </div>
                <div className="relative h-[27px]">
                  {ticks.minor.map((tick) => (
                    <div
                      key={tick.key}
                      className={cn('absolute top-0 h-full truncate border-l border-border-subtle text-center text-2xs leading-[27px] text-fg-muted tabular-nums', tick.weekend && 'bg-sunken')}
                      style={{ left: tick.x, width: tick.width }}
                    >
                      {tick.width >= 16 && tick.x >= viewX - 2 ? tick.label : ''}
                    </div>
                  ))}
                  {/* A short tick under the Today flag; the line itself starts below the week labels so it never cuts through them. */}
                  {showToday ? <span aria-hidden className="absolute top-0 z-[1] h-1.5 w-0.5 bg-primary" style={{ left: todayX + px / 2 - 1 }} /> : null}
                </div>
              </div>
            </div>

            {/* Body */}
            <div role="rowgroup" className="relative">
              {rows.map(renderRow)}
              {rows.length === 0 ? (
                <div className="sticky left-0 flex flex-col items-start gap-2 p-6 text-sm text-fg-muted" style={{ width: `min(100%, 520px)` }}>
                  {search ? (
                    <>
                      <p>No scheduled tasks match “{search}”.</p>
                      <Button variant="secondary" size="sm" onClick={() => setSearch('')}>
                        Clear search
                      </Button>
                    </>
                  ) : (
                    <p>None of the tasks you can see have dates yet. Open “No dates” and drag a task onto the timeline.</p>
                  )}
                </div>
              ) : null}

              {/* Dependency arrows */}
              {arrows.length > 0 || gesture?.type === 'link' ? (
                <svg aria-hidden={arrows.length === 0} className="pointer-events-none absolute top-0 z-[2] overflow-visible" style={{ left: nameWidth, width: trackWidth, height: bodyHeight }} data-testid="timeline-arrows">
                  <defs>
                    {(['normal', 'conflict', 'critical'] as const).map((kind) => (
                      <marker key={kind} id={`${markerId}-${kind}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                        <path d="M 0 0 L 8 4 L 0 8 z" fill={kind === 'conflict' ? 'var(--warning)' : kind === 'critical' ? 'var(--danger)' : 'var(--icon-default)'} />
                      </marker>
                    ))}
                  </defs>
                  {arrows.map(({ dep, d, conflict, crit, mid }) => {
                    const kind = crit ? 'critical' : conflict ? 'conflict' : 'normal';
                    const active = selectedDep?.id === dep.id;
                    const from = taskById.get(dep.blockingTaskId);
                    const to = taskById.get(dep.blockedTaskId);
                    return (
                      <g key={dep.id} data-testid="timeline-arrow" data-conflict={conflict || undefined}>
                        <path
                          d={d}
                          fill="none"
                          stroke={kind === 'conflict' ? 'var(--warning)' : kind === 'critical' ? 'var(--danger)' : 'var(--icon-default)'}
                          strokeWidth={active || crit ? 2 : 1.4}
                          strokeDasharray={conflict && !crit ? '4 3' : undefined}
                          opacity={prefs.showCritical && !crit ? 0.35 : active ? 1 : 0.8}
                          markerEnd={`url(#${markerId}-${kind})`}
                        />
                        <path
                          d={d}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={10}
                          className="pointer-events-[stroke] cursor-pointer focus-visible:outline-none"
                          style={{ pointerEvents: 'stroke' }}
                          role="button"
                          tabIndex={0}
                          aria-label={`${to?.title ?? 'Task'} waits on ${from?.title ?? 'task'}${conflict ? ', but starts too early' : ''}. Press Enter for options`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedDep({ id: dep.id, x: trackX(event.clientX), y: trackY(event.clientY) });
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setSelectedDep({ id: dep.id, x: mid.x, y: mid.y });
                            }
                          }}
                        />
                      </g>
                    );
                  })}
                  {gesture?.type === 'link' ? (
                    <path
                      d={`M ${gesture.x0} ${gesture.y0} C ${gesture.x0 + 40} ${gesture.y0}, ${gesture.x - 40} ${gesture.y}, ${gesture.x} ${gesture.y}`}
                      fill="none"
                      stroke="var(--primary)"
                      strokeWidth={2}
                      strokeDasharray="5 4"
                      markerEnd={`url(#${markerId}-normal)`}
                    />
                  ) : null}
                </svg>
              ) : null}

              {selected && selectedDep ? (
                <DependencyPopover
                  x={nameWidth + selectedDep.x}
                  y={selectedDep.y}
                  dep={selected}
                  from={taskById.get(selected.blockingTaskId)}
                  to={taskById.get(selected.blockedTaskId)}
                  fromSpan={savedSpans.get(selected.blockingTaskId)}
                  toSpan={savedSpans.get(selected.blockedTaskId)}
                  canEdit={canEdit}
                  onClose={() => setSelectedDep(null)}
                  onOpen={(key) => {
                    setSelectedDep(null);
                    openTask(key);
                  }}
                  onRemove={() => void unlink(selected)}
                  onFix={(task, span) => {
                    setSelectedDep(null);
                    void reschedule(task, span);
                  }}
                />
              ) : null}
            </div>
          </div>
        </div>

        {prefs.trayOpen ? (
          <UnscheduledTray
            tasks={unscheduled}
            canEdit={canEdit}
            onClose={() => setPrefs({ trayOpen: false })}
            onOpen={(key) => openTask(key)}
            onSchedule={(task) => void reschedule(task, { start: today, end: addDaysIso(today, DROP_LENGTH_DAYS[zoom] - 1) }, 'Scheduled')}
            statusColor={(task) => statusById.get(task.statusId)?.color}
          />
        ) : null}
      </div>
      {gesture?.type === 'link' ? (
        <p role="status" className="sr-only">
          {gesture.overId ? `Release to make ${taskById.get(gesture.overId)?.title ?? 'that task'} wait on this one` : 'Drag onto another bar to link them'}
        </p>
      ) : null}
    </div>
  );
}

function LiveLabel({ text }: { readonly text: string }) {
  return (
    <span role="status" className="pointer-events-none absolute bottom-full left-0 z-[var(--z-popover)] mb-2 rounded-sm bg-inverse px-2 py-1 text-xs font-medium whitespace-nowrap text-fg-inverse shadow-md tabular-nums">
      {text}
    </span>
  );
}

function DependencyPopover({
  x,
  y,
  dep,
  from,
  to,
  fromSpan,
  toSpan,
  canEdit,
  onClose,
  onOpen,
  onRemove,
  onFix,
}: {
  readonly x: number;
  readonly y: number;
  readonly dep: DependencyRow;
  readonly from: TaskSummary | undefined;
  readonly to: TaskSummary | undefined;
  readonly fromSpan: Span | undefined;
  readonly toSpan: Span | undefined;
  readonly canEdit: boolean;
  readonly onClose: () => void;
  readonly onOpen: (key: string) => void;
  readonly onRemove: () => void;
  readonly onFix: (task: TaskSummary, span: Span) => void;
}) {
  const conflict = fromSpan && toSpan ? isConflict(fromSpan, toSpan, dep.lagDays) : false;
  const fixed = fromSpan && toSpan ? dragSpan(toSpan, 'move', diffDays(toSpan.start, addDaysIso(fromSpan.end, 1 + dep.lagDays))) : null;
  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor asChild>
        <span aria-hidden className="absolute size-px" style={{ left: x, top: y }} />
      </PopoverAnchor>
      <PopoverContent className="w-80" aria-label="Link between tasks" data-testid="timeline-dependency-popover">
        <div className="flex items-start gap-2">
          <Link2 aria-hidden className="mt-0.5 size-4 shrink-0 text-icon" />
          <p className="min-w-0 flex-1 text-sm text-fg">
            <button type="button" className="inline rounded-xs text-left font-semibold hover:underline" onClick={() => from && onOpen(from.key)}>
              {from?.title ?? 'A task'}
            </button>{' '}
            has to finish before{' '}
            <button type="button" className="inline rounded-xs text-left font-semibold hover:underline" onClick={() => to && onOpen(to.key)}>
              {to?.title ?? 'another task'}
            </button>{' '}
            can start.
          </p>
          <IconButton size="xs" label="Close" icon={<X aria-hidden />} onClick={onClose} />
        </div>
        {conflict ? (
          <p className="mt-2 rounded-md bg-warning-subtle px-2.5 py-2 text-xs text-warning-text">
            Heads up: “{to?.title}” starts before “{from?.title}” is done.
          </p>
        ) : null}
        {canEdit ? (
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            {conflict && to && fixed ? (
              <Button size="sm" variant="secondary" leadingIcon={<CalendarClock aria-hidden />} onClick={() => onFix(to, fixed)}>
                Move it later
              </Button>
            ) : null}
            <Button size="sm" variant="danger" leadingIcon={<Trash2 aria-hidden />} onClick={onRemove} data-testid="timeline-remove-link">
              Remove link
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
