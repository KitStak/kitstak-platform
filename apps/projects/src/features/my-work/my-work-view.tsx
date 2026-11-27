'use client';
/**
 * My work: every task on your plate across projects, grouped by when it's due (Overdue, Today,
 * Upcoming, Later, No date) or by project. Sort, filter, check off in one click, reschedule in
 * place or by dragging a task onto another group, and Focus mode for one-at-a-time work.
 * Layout choices live in the URL (?scope=&group=&sort=&done=1&project=&when=) so they're shareable.
 * `when` narrows the list to one due-date group (Home's number tiles link here with it).
 * Keys: J/K move · Enter open · D done · T due today · M due tomorrow.
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useRef, useState, type DragEvent } from 'react';
import { ChevronDown, Crosshair, Plus } from 'lucide-react';
import {
  Button,
  Checkbox,
  EmptyState,
  Kbd,
  useModKey,
  SearchInput,
  Select,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  Tooltip,
  cn,
  toast,
} from '@/components/ui';
import { EntityIcon } from '@/components/pm';
import { Page } from '@/components/layout/page';
import { addDaysIso, todayIso } from '@/lib/dates';
import { useMyTasks, useProjects } from '@/lib/hooks/use-data';
import { useHotkey } from '@/lib/hooks/use-hotkeys';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { useTaskMutations } from '@/lib/hooks/use-task-mutations';
import type { TaskSummary } from '@/lib/types';
import { useShell } from '@/features/shell/shell-context';
import { useShellStore } from '@/features/shell/store';
import { FocusMode } from './focus-mode';
import {
  SORT_LABELS,
  WHEN_GROUPS,
  dueDateForDrop,
  WHEN_FILTERS,
  focusQueue,
  groupByProject,
  groupByWhen,
  matchesText,
  matchesWhen,
  type MyWorkSort,
  type TaskGroup,
  type WhenGroup,
} from './my-work-model';
import { MyWorkRow, TASK_DRAG_TYPE } from './my-work-row';
import { copyTaskLink, letterKeysPaused, setDateWithUndo, writeWithUndo } from '@/features/task/task-keys';
import { useCompleteTask } from './use-complete-task';
import { MyWorkBuilds } from './my-work-builds';

type Scope = 'assigned' | 'created' | 'watching';

const SCOPES: readonly { value: Scope; label: string }[] = [
  { value: 'assigned', label: 'Assigned to me' },
  { value: 'created', label: 'Created by me' },
  { value: 'watching', label: 'Following' },
];
const SORTS = Object.keys(SORT_LABELS) as MyWorkSort[];

const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);

export function MyWorkView({ initialTasks }: { readonly initialTasks: TaskSummary[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { user } = useShell();
  const openQuickAdd = useShellStore((state) => state.openQuickAdd);
  const { openTask } = useTaskDrawer();
  const { updateTask } = useTaskMutations();
  const mod = useModKey();
  const complete = useCompleteTask();

  const scope = pick(params.get('scope'), ['assigned', 'created', 'watching'] as const, 'assigned');
  const grouping = pick(params.get('group'), ['when', 'project'] as const, 'when');
  const sort = pick(params.get('sort'), SORTS, 'due');
  const whenFilter = pick(params.get('when'), WHEN_FILTERS.map((entry) => entry.value), 'all');
  const showDone = params.get('done') === '1' || whenFilter === 'done';
  const projectFilter = params.get('project');

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const tasks = useMyTasks(scope, undefined, { initialData: scope === 'assigned' ? initialTasks : undefined });
  const projects = useProjects();
  const projectMap = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p])), [projects.data]);
  const projectName = useCallback((id: string) => projectMap.get(id)?.name ?? '', [projectMap]);
  const [text, setText] = useState('');
  const [sessionStart] = useState(() => new Date(Date.now() - 1000).toISOString());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<WhenGroup | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusOpen, setFocusOpen] = useState(false);
  const [focusSnapshot, setFocusSnapshot] = useState<readonly TaskSummary[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const today = todayIso();

  // Builds have their own group below (by run); task groups and Focus mode hold tasks only.
  const all = useMemo(() => (tasks.data ?? []).filter((task) => task.kind !== 'build'), [tasks.data]);
  const showBuilds = params.get('builds') !== '0';
  const keepIds = useMemo(
    () => new Set(all.filter((t) => t.statusCategory === 'done' && t.completedAt && t.completedAt >= sessionStart).map((t) => t.id)),
    [all, sessionStart],
  );
  const filtered = useMemo(
    () =>
      all.filter(
        (task) =>
          (!projectFilter || task.projectId === projectFilter) && matchesText(task, text, projectName) && matchesWhen(task, whenFilter, today, keepIds),
      ),
    [all, projectFilter, text, projectName, whenFilter, today, keepIds],
  );
  const groups: TaskGroup[] = useMemo(() => {
    if (grouping === 'project') return groupByProject(filtered, projectName, { sort, showDone, keepIds });
    const list: TaskGroup[] = groupByWhen(filtered, { today, sort, showDone, keepIds, projectName });
    // Keep an (empty) Today group as a drop target so any task can be pulled into today.
    if (whenFilter === 'all' && list.length && !list.some((g) => g.key === 'today')) {
      const at = list.findIndex((g) => g.key !== 'overdue');
      list.splice(at === -1 ? list.length : at, 0, { key: 'today', label: 'Today', tasks: [] });
    }
    return list;
  }, [grouping, filtered, projectName, sort, showDone, keepIds, today, whenFilter]);
  const visibleTasks = useMemo(() => groups.flatMap((g) => (collapsed.has(g.key) ? [] : g.tasks)), [groups, collapsed]);
  const openCount = all.filter((t) => t.statusCategory !== 'done' && t.statusCategory !== 'cancelled').length;
  const queue = useMemo(() => focusQueue(scope === 'assigned' ? all : all.filter((t) => t.assigneeId === user.id), today), [all, scope, today, user.id]);
  const active = visibleTasks.find((t) => t.id === activeId) ?? null;

  const reschedule = useCallback(
    async (task: TaskSummary, date: string | null) => {
      if (date === task.dueDate) return;
      // Same rule as the drawer and List: a due date before the start moves the start along, with
      // Undo, instead of failing on save; a refused save turns this toast into the error.
      await setDateWithUndo({ task, field: 'dueDate', value: date, save: (patch, options) => updateTask(task.id, patch, options) });
    },
    [updateTask],
  );

  const startFocus = () => {
    if (!queue.length) {
      toast.info('Nothing to focus on', 'Focus mode works through tasks due today or overdue.');
      return;
    }
    setFocusSnapshot(queue);
    setFocusOpen(true);
  };

  // --- Keyboard -------------------------------------------------------------------------------
  const focusRow = (direction: 1 | -1) => {
    const titles = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-mywork-title]') ?? [])];
    if (!titles.length) return;
    const current = titles.findIndex((el) => el === document.activeElement);
    const next = titles[current === -1 ? 0 : Math.max(0, Math.min(titles.length - 1, current + direction))];
    next?.focus();
    next?.scrollIntoView({ block: 'nearest' });
  };
  useHotkey(['j', 'ArrowDown'], () => focusRow(1), { enabled: visibleTasks.length > 0 && !focusOpen });
  useHotkey(['k', 'ArrowUp'], () => focusRow(-1), { enabled: visibleTasks.length > 0 && !focusOpen });
  // The shared task key map (task-keys.ts): D due date, T today, Shift+T tomorrow,
  // Ctrl/Cmd+Enter done or reopen, Ctrl/Cmd+. copy link, I assign to me. Same keys as List and Board.
  const keysOn = Boolean(active) && !focusOpen;
  useHotkey('mod+Enter', () => active && void complete(active, active.statusCategory !== 'done'), { enabled: keysOn });
  useHotkey('mod+.', () => active && void copyTaskLink(active), { enabled: keysOn });
  useHotkey('d', () => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-task-id="${active?.id ?? ''}"]`);
    row?.querySelector<HTMLButtonElement>('[data-testid="my-work-due"]:not(:disabled)')?.click();
  }, { enabled: keysOn });
  // Keyboard writes wait for the previous one to save and for a closing dialog to settle.
  useHotkey('t', () => active && !letterKeysPaused({ writes: true }) && void reschedule(active, today), { enabled: keysOn });
  useHotkey('shift+t', () => active && !letterKeysPaused({ writes: true }) && void reschedule(active, addDaysIso(today, 1)), { enabled: keysOn });
  useHotkey('i', () => {
    if (!active || active.assigneeId === user.id || letterKeysPaused({ writes: true })) return;
    void writeWithUndo({
      taskKey: active.key,
      message: `Assigned ${active.key} to you`,
      patch: { assigneeId: user.id },
      undo: { assigneeId: active.assigneeId },
      save: (patch, options) => updateTask(active.id, patch, options),
    });
  }, { enabled: keysOn });
  useHotkey('f', () => startFocus(), { enabled: queue.length > 0 && !focusOpen });


  // --- Drag to reschedule -----------------------------------------------------------------------
  const dropHandlers = (group: string) => {
    const when = WHEN_GROUPS.some((g) => g.key === group) ? (group as WhenGroup) : null;
    if (grouping !== 'when' || !when || when === 'overdue' || when === 'done') return {};
    return {
      onDragOver: (event: DragEvent) => {
        if (!event.dataTransfer.types.includes(TASK_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (dropTarget !== when) setDropTarget(when);
      },
      onDragLeave: (event: DragEvent) => {
        if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) setDropTarget(null);
      },
      onDrop: (event: DragEvent) => {
        event.preventDefault();
        setDropTarget(null);
        const id = event.dataTransfer.getData(TASK_DRAG_TYPE);
        const task = all.find((t) => t.id === id);
        if (!task) return;
        const date = dueDateForDrop(when, task, today);
        if (date !== undefined) void reschedule(task, date);
      },
    };
  };

  const toggleGroup = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const filtersActive = Boolean(text || projectFilter || whenFilter !== 'all');

  return (
    <Page
      title="My work"
      actions={
        <>
          <Tooltip content={queue.length ? `Work through ${queue.length} task${queue.length === 1 ? '' : 's'} due today or overdue (F)` : 'Nothing due today or overdue'}>
            <span>
              <Button variant="secondary" leadingIcon={<Crosshair aria-hidden />} onClick={startFocus} disabled={!queue.length} data-testid="focus-start">
                Focus mode{queue.length ? <span className="ml-0.5 text-fg-muted tabular-nums">{queue.length}</span> : null}
              </Button>
            </span>
          </Tooltip>
          <Button leadingIcon={<Plus aria-hidden />} onClick={() => openQuickAdd({ assigneeId: user.id })} data-testid="my-work-new">
            New task
          </Button>
        </>
      }
      tabs={
        <Tabs value={scope} onValueChange={(value) => setParam({ scope: value === 'assigned' ? null : value })}>
          <TabsList aria-label="Which tasks">
            {SCOPES.map((entry) => (
              <TabsTrigger key={entry.value} value={entry.value} data-testid={`my-work-scope-${entry.value}`} count={entry.value === scope && tasks.data ? openCount : undefined}>
                {entry.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="my-work-toolbar">
        <SearchInput value={text} onValueChange={setText} placeholder="Filter tasks" aria-label="Filter tasks" containerClassName="w-full sm:w-56" />
        <Select
          aria-label="Project"
          className="w-full sm:w-52"
          value={projectFilter ?? 'all'}
          onValueChange={(value) => setParam({ project: value === 'all' ? null : value })}
          options={[
            { value: 'all', label: 'All projects' },
            ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name, icon: <EntityIcon icon={p.icon} color={p.color} size={16} /> })),
          ]}
        />
        <Select
          aria-label="Due"
          className="w-full sm:w-40"
          value={whenFilter}
          onValueChange={(value) => setParam({ when: value === 'all' ? null : value })}
          options={WHEN_FILTERS.map((entry) => ({ value: entry.value, label: entry.label }))}
        />
        <ToggleGroup
          label="Group by"
          size="sm"
          value={grouping}
          onValueChange={(value) => setParam({ group: value === 'when' ? null : value })}
          options={[
            { value: 'when', label: 'By due date' },
            { value: 'project', label: 'By project' },
          ]}
        />
        <Select
          aria-label="Sort by"
          className="w-44"
          value={sort}
          onValueChange={(value) => setParam({ sort: value === 'due' ? null : value })}
          options={SORTS.map((value) => ({ value, label: `Sort: ${SORT_LABELS[value]}` }))}
        />
        <Checkbox label="Show done" checked={showDone} onCheckedChange={(value) => setParam({ done: value === true ? '1' : null })} className="ml-1" />
        {scope === 'assigned' ? <Checkbox label="Show builds" checked={showBuilds} onCheckedChange={(value) => setParam({ builds: value === true ? null : '0' })} className="ml-1" /> : null}
      </div>

      {tasks.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} height={40} rounded="md" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <EmptyState
          illustration="board"
          title={scope === 'assigned' ? 'You’re all clear' : scope === 'created' ? 'You haven’t created any tasks yet' : 'You’re not following any tasks'}
          description={
            scope === 'watching'
              ? 'Follow a task from its details panel to keep an eye on it here.'
              : 'Add a task and it shows up here. Try typing “Call the supplier tomorrow !high”.'
          }
          actions={<Button leadingIcon={<Plus aria-hidden />} onClick={() => openQuickAdd({ assigneeId: user.id })}>Add a task</Button>}
        />
      ) : groups.length === 0 ? (
        <EmptyState
          size="sm"
          illustration="search"
          title={filtersActive ? 'No tasks match' : 'Nothing open right now'}
          description={filtersActive ? 'Try a different word, project or due date.' : 'Turn on “Show done” to see what you finished this week.'}
          actions={
            filtersActive ? (
              <Button variant="secondary" onClick={() => { setText(''); setParam({ project: null, when: null }); }}>
                Clear filters
              </Button>
            ) : null
          }
        />
      ) : (
        <div ref={listRef} className="flex flex-col gap-5" data-testid="my-work-groups">
          {groups.map((group) => {
            const meta = WHEN_GROUPS.find((g) => g.key === group.key);
            const project = grouping === 'project' ? projectMap.get(group.key) : undefined;
            const isCollapsed = collapsed.has(group.key);
            const handlers = dropHandlers(group.key);
            const droppable = 'onDrop' in handlers;
            return (
              <section key={group.key} aria-labelledby={`group-${group.key}`} data-testid={`my-work-group-${group.key}`} {...handlers}>
                <h2 id={`group-${group.key}`} className="mb-1 flex items-center gap-2 px-1">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    aria-expanded={!isCollapsed}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-sm text-xs font-semibold tracking-[0.06em] uppercase outline-none focus-visible:ring-2 focus-visible:ring-focus',
                      group.key === 'overdue' ? 'text-danger-text' : group.key === 'today' ? 'text-warning-text' : 'text-fg-muted',
                    )}
                  >
                    <ChevronDown aria-hidden className={cn('size-3.5 transition-transform', isCollapsed && '-rotate-90')} />
                    {project ? <EntityIcon icon={project.icon} color={project.color} size={16} /> : null}
                    {group.label}
                    <span className="font-normal tabular-nums">{group.tasks.length}</span>
                  </button>
                  {meta && meta.key !== 'overdue' && meta.key !== 'done' ? <span className="hidden text-xs text-fg-disabled sm:inline">{meta.hint}</span> : null}
                </h2>
                {!isCollapsed ? (
                  <ul
                    className={cn(
                      'overflow-hidden rounded-xl border bg-panel shadow-xs transition-[border-color,box-shadow]',
                      droppable && dropTarget === group.key ? 'border-border-strong ring-2 ring-[var(--focus-ring-soft)]' : 'border-border-subtle',
                    )}
                  >
                    {group.tasks.length === 0 ? (
                      <li className="flex min-h-11 items-center gap-2 px-4 py-2 text-sm text-fg-muted">
                        Nothing due today. <span className="hidden sm:inline">Drag a task here, or press T on one, to do it today.</span>
                      </li>
                    ) : null}
                    {group.tasks.map((task) => (
                      <MyWorkRow
                        key={task.id}
                        task={task}
                        project={projectMap.get(task.projectId)}
                        showAssignee={scope !== 'assigned'}
                        showProject={grouping !== 'project'}
                        active={task.id === activeId}
                        onFocusRow={() => setActiveId(task.id)}
                        onComplete={(done) => void complete(task, done)}
                        onOpen={() => openTask(task.key)}
                        onReschedule={(date) => void reschedule(task, date)}
                      />
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })}
          {showBuilds && scope === 'assigned' ? <MyWorkBuilds userId={user.id} collapsed={collapsed.has('builds')} onToggle={() => toggleGroup('builds')} /> : null}
          <p className="hidden flex-wrap items-center gap-1 px-1 text-xs text-fg-muted md:flex">
            <Kbd>J</Kbd>
            <Kbd>K</Kbd> move · <Kbd>Enter</Kbd> open · <Kbd>{mod}</Kbd>
            <Kbd>Enter</Kbd> done · <Kbd>D</Kbd> due date · <Kbd>T</Kbd> due today · <Kbd>Shift</Kbd>
            <Kbd>T</Kbd> due tomorrow · <Kbd>F</Kbd> focus mode · <Kbd>?</Kbd> all shortcuts · drag a task onto a group to reschedule it
          </p>
        </div>
      )}

      <FocusMode
        open={focusOpen}
        onOpenChange={setFocusOpen}
        queue={focusSnapshot}
        projects={projectMap}
        onComplete={(task) => complete(task, true, { quiet: true })}
        onReschedule={(task, date) => reschedule(task, date)}
        onOpenTask={(task) => {
          setFocusOpen(false);
          openTask(task.key);
        }}
      />
    </Page>
  );
}
