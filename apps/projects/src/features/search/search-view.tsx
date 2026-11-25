'use client';
/**
 * /search: one box that finds tasks (title, description, or a key like OPS-12), comments,
 * projects, people and goals. Tabs narrow the type; task filters narrow by project, state and
 * assignee. The URL keeps the whole search so it can be shared or bookmarked.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight, Clock, FolderKanban, History, MessageSquare, Repeat2, Search, Target, UserRound, X } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  Kbd,
  ProgressBar,
  SearchInput,
  Select,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  cn,
  useModKey,
} from '@/components/ui';
import { DueDate, EntityIcon, PersonAvatar, PriorityIcon, StatusIcon } from '@/components/pm';
import { Page } from '@/components/layout/page';
import { apiGet, apiPath } from '@/lib/api-client';
import { GOAL_HEALTH_LABELS } from '@/lib/constants';
import { healthProgressTone } from '@/lib/health';
import { ProjectHealthMark } from '@/features/projects/health';
import { formatRelative } from '@/lib/dates';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { usePeople, useProjects } from '@/lib/hooks/use-data';
import { usePeopleMap } from '@/lib/hooks/use-people';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { routes } from '@/lib/routes';
import type { CommentSearchHit, FullSearchResults, FullSearchTypeWithPrograms as FullSearchType, GoalDTO, OrgPerson, ProgramSearchHit, ProjectSummary, TaskSummary } from '@/lib/types';
import { ProgramIcon, ProgramStatusPill } from '@/features/programs/kit/chips';
import { qtyOfText } from '@/features/programs/kit/format';
import { useHydrated } from '@/features/programs/kit/use-hydrated';
import { programHref } from '@/features/programs/kit/live-pages';
import { usePrograms } from '@/lib/hooks/use-programs';
import { formatQty } from '@kitstak/programs-engine';
import type { UnitLabel } from '@/lib/program-types';
import { useShell } from '@/features/shell/shell-context';
import { Highlight } from './highlight';
import { searchParamsToQuery, type SearchParamsState } from './search-params';

const RECENT_KEY = 'kitstak-projects:recent-searches';

const RECENT_EVENT = 'kitstak-projects:recent-searches';

function readRecentRaw(): string {
  try {
    return window.localStorage.getItem(RECENT_KEY) ?? '[]';
  } catch {
    return '[]';
  }
}

function parseRecent(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

function writeRecent(list: readonly string[]) {
  try {
    if (list.length) window.localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    else window.localStorage.removeItem(RECENT_KEY);
  } catch {
    // storage unavailable
  }
  window.dispatchEvent(new Event(RECENT_EVENT));
}

function subscribeRecent(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(RECENT_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(RECENT_EVENT, onChange);
  };
}

/** Recent searches in this browser (empty on the server, so hydration matches). */
function useRecentSearches(): readonly string[] {
  const raw = useSyncExternalStore(subscribeRecent, readRecentRaw, () => '[]');
  return useMemo(() => parseRecent(raw), [raw]);
}

function saveRecent(q: string) {
  const current = parseRecent(readRecentRaw());
  writeRecent([q, ...current.filter((item) => item.toLowerCase() !== q.toLowerCase())].slice(0, 8));
}

const TYPE_LABEL: Record<FullSearchType, string> = {
  all: 'All',
  tasks: 'Tasks',
  comments: 'Comments',
  projects: 'Projects',
  programs: 'Programs',
  people: 'People',
  goals: 'Goals',
};

const HEALTH_TONE = { on_track: 'success', at_risk: 'warning', off_track: 'danger', achieved: 'success', missed: 'danger' } as const;

function useFullSearch(state: SearchParamsState, type: FullSearchType, initial: FullSearchResults | null, initialState: SearchParamsState) {
  const isInitial = initial !== null && searchParamsToQuery({ ...state, type }) === searchParamsToQuery({ ...initialState, type: initialState.type }) && type === initialState.type;
  return useQuery({
    queryKey: ['search-full', state.q, type, state.projectId, state.status, state.assignee],
    queryFn: () =>
      apiGet<FullSearchResults>(
        apiPath('search/full', {
          q: state.q,
          type,
          project: state.projectId,
          status: state.status === 'any' ? undefined : state.status,
          assignee: state.assignee,
        }),
      ),
    enabled: state.q.length > 0 || Boolean(state.assignee || state.projectId),
    initialData: isInitial ? initial : undefined,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

/** Up/Down (or J/K) moves between results; the search box hands focus to the first one. */
function focusResult(from: Element | null, direction: 1 | -1, root: HTMLElement | null) {
  if (!root) return;
  const items = [...root.querySelectorAll<HTMLElement>('[data-search-result]')];
  if (!items.length) return;
  const index = from ? items.indexOf(from as HTMLElement) : -1;
  const next = items[Math.min(Math.max(index + direction, 0), items.length - 1)];
  next?.focus();
}

export function SearchView({ initialParams, initial }: { readonly initialParams: SearchParamsState; readonly initial: FullSearchResults | null }) {
  const { user } = useShell();
  const mod = useModKey();
  const [filters, setFilters] = useState<Omit<SearchParamsState, 'q'>>(() => ({
    type: initialParams.type,
    projectId: initialParams.projectId,
    status: initialParams.status,
    assignee: initialParams.assignee,
  }));
  const [input, setInput] = useState(initialParams.q);
  const recent = useRecentSearches();
  const debounced = useDebouncedValue(input.trim(), 220);
  const state: SearchParamsState = useMemo(() => ({ ...filters, q: debounced }), [filters, debounced]);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const projects = useProjects();
  const people = usePeople();

  // Keep the URL in sync without a navigation (other params like ?task= stay).
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const key of ['q', 'type', 'project', 'status', 'assignee']) url.searchParams.delete(key);
    const own = new URLSearchParams(searchParamsToQuery(state));
    own.forEach((value, key) => url.searchParams.set(key, value));
    const next = `${url.pathname}${url.search}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', next);
  }, [state]);

  // Remember a search once it has settled for a moment.
  useEffect(() => {
    if (!state.q || state.q.length < 2) return;
    const timer = window.setTimeout(() => saveRecent(state.q), 1500);
    return () => window.clearTimeout(timer);
  }, [state.q]);

  const overview = useFullSearch(state, 'all', initial, initialParams);
  const focused = useFullSearch(state, state.type === 'all' ? 'all' : state.type, initial, initialParams);
  const data = state.type === 'all' ? overview.data : focused.data;
  const counts = overview.data?.counts;
  // Program hits always show. Only their link waits for the program page (features/programs/kit/live-pages.ts).
  const total = counts ? counts.tasks + counts.comments + counts.projects + (counts.programs ?? 0) + counts.people + counts.goals : 0;
  const searching = state.q.length > 0 || Boolean(state.assignee || state.projectId);
  const loading = searching && (state.type === 'all' ? overview.isPending : focused.isPending);
  const fetching = overview.isFetching || focused.isFetching;
  const filtersApply = state.type === 'all' || state.type === 'tasks' || state.type === 'comments';
  const filtered = Boolean(state.projectId || state.status !== 'any' || state.assignee);

  const set = useCallback((patch: Partial<Omit<SearchParamsState, 'q'>>) => setFilters((current) => ({ ...current, ...patch })), []);
  const searchFor = (q: string) => {
    setInput(q);
    inputRef.current?.focus();
  };

  const onResultsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === 'ArrowDown' || event.key === 'j') {
      event.preventDefault();
      focusResult(document.activeElement, 1, resultsRef.current);
    } else if (event.key === 'ArrowUp' || event.key === 'k') {
      event.preventDefault();
      const items = resultsRef.current?.querySelectorAll('[data-search-result]');
      if (items?.[0] === document.activeElement) inputRef.current?.focus();
      else focusResult(document.activeElement, -1, resultsRef.current);
    }
  };

  const projectOptions = useMemo(
    () => (projects.data ?? []).map((p) => ({ value: p.id, label: p.name, icon: <EntityIcon icon={p.icon} color={p.color} size={16} /> })),
    [projects.data],
  );
  const assigneeOptions = useMemo(
    () => [
      { value: 'anyone', label: 'Anyone' },
      { value: 'me', label: 'Me' },
      { value: 'none', label: 'No one' },
      ...(people.data ?? []).filter((p) => p.id !== user.id).map((p) => ({ value: p.id, label: p.name, icon: <Avatar name={p.name} src={p.image} size="xs" /> })),
    ],
    [people.data, user.id],
  );

  return (
    <Page title="Search" width="narrow">
      <div className="flex flex-col gap-4" onKeyDown={onResultsKeyDown} ref={resultsRef}>
        <SearchInput
          ref={inputRef}
          autoFocus
          size="lg"
          value={input}
          onValueChange={setInput}
          loading={fetching && searching}
          placeholder="Search by words, a task key like OPS-12, or a person"
          aria-label="Search everything"
          data-testid="search-input"
          containerClassName="h-11 text-md"
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              focusResult(null, 1, resultsRef.current);
            }
          }}
        />

        {searching ? (
          <div className="flex flex-col gap-3">
            <Tabs value={state.type} onValueChange={(value) => set({ type: value as FullSearchType })}>
              <div className="-mx-1 overflow-x-auto px-1">
                <TabsList aria-label="Result type" className="min-w-max">
                  {(['all', 'tasks', 'comments', 'projects', 'programs', 'people', 'goals'] as const).map((type) => (
                    <TabsTrigger key={type} value={type} data-testid={`search-tab-${type}`} count={counts ? (type === 'all' ? total : (counts[type] ?? 0)) : undefined}>
                      {TYPE_LABEL[type]}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
            </Tabs>
            {filtersApply ? (
              <div className="flex flex-wrap items-center gap-2" data-testid="search-filters">
                <Select
                  aria-label="Project"
                  className="w-full sm:w-56"
                  value={state.projectId ?? 'all'}
                  onValueChange={(value) => set({ projectId: value === 'all' ? null : value })}
                  options={[{ value: 'all', label: 'All projects' }, ...projectOptions]}
                />
                {state.type !== 'comments' ? (
                  <ToggleGroup
                    label="Task state"
                    size="sm"
                    value={state.status}
                    onValueChange={(value) => set({ status: value })}
                    options={[
                      { value: 'any', label: 'Any state' },
                      { value: 'open', label: 'Open' },
                      { value: 'done', label: 'Done' },
                    ]}
                  />
                ) : null}
                {state.type !== 'comments' ? (
                  <Select
                    aria-label="Assignee"
                    className="w-44"
                    value={state.assignee ?? 'anyone'}
                    onValueChange={(value) => set({ assignee: value === 'anyone' ? null : value })}
                    options={assigneeOptions}
                  />
                ) : null}
                {filtered ? (
                  <Button variant="ghost" size="sm" leadingIcon={<X aria-hidden />} onClick={() => set({ projectId: null, status: 'any', assignee: null })}>
                    Clear filters
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {!searching ? (
          <StartState recent={recent} onPick={searchFor} onClear={() => writeRecent([])} mod={mod} />
        ) : loading ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Searching">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} height={44} rounded="md" />
            ))}
          </div>
        ) : !data || (state.type === 'all' ? total === 0 : (data.counts[state.type as Exclude<FullSearchType, 'all'>] ?? 0) === 0) ? (
          <EmptyState
            illustration="search"
            title={state.q ? `Nothing found for “${state.q}”` : 'No tasks match these filters'}
            description={
              filtered
                ? 'Try clearing the filters, or use fewer or different words.'
                : 'Check the spelling, use fewer words, or search for a task key like OPS-12.'
            }
            actions={
              filtered ? (
                <Button variant="secondary" onClick={() => set({ projectId: null, status: 'any', assignee: null })}>
                  Clear filters
                </Button>
              ) : null
            }
          />
        ) : (
          <Results data={data} type={state.type} q={state.q} onShowAll={(type) => set({ type })} onPersonTasks={(id) => {
              setInput('');
              set({ type: 'tasks', assignee: id, status: 'open' });
            }} />
        )}
      </div>
    </Page>
  );
}

function StartState({ recent, onPick, onClear, mod }: { readonly recent: readonly string[]; readonly onPick: (q: string) => void; readonly onClear: () => void; readonly mod: string }) {
  return (
    <div className="flex flex-col gap-6">
      {recent.length ? (
        <section aria-labelledby="recent-searches">
          <div className="mb-1 flex items-center justify-between px-1">
            <h2 id="recent-searches" className="text-xs font-semibold tracking-[0.06em] text-fg-muted uppercase">
              Recent searches
            </h2>
            <Button variant="ghost" size="sm" onClick={onClear}>
              Clear
            </Button>
          </div>
          <ul className="overflow-hidden rounded-xl border border-border-subtle bg-panel">
            {recent.map((q) => (
              <li key={q} className="border-b border-border-subtle last:border-b-0">
                <button
                  type="button"
                  data-search-result
                  onClick={() => onPick(q)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-fg outline-none hover:bg-hover focus-visible:bg-hover"
                >
                  <History aria-hidden className="size-4 text-icon" />
                  <span className="min-w-0 flex-1 truncate">{q}</span>
                  <ArrowRight aria-hidden className="size-4 text-fg-muted" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="rounded-xl border border-border-subtle bg-panel p-5" aria-labelledby="search-tips">
        <h2 id="search-tips" className="text-base font-semibold text-fg">
          What you can search
        </h2>
        <ul className="mt-3 grid gap-3 text-sm text-fg-secondary sm:grid-cols-2">
          <Tip icon={<Search aria-hidden className="size-4" />} title="Words in a task" example="invoice" onPick={onPick}>
            Matches task names and descriptions.
          </Tip>
          <Tip icon={<span className="text-xs font-semibold">#</span>} title="A task key" example="OPS-1" onPick={onPick}>
            Jump straight to one task.
          </Tip>
          <Tip icon={<MessageSquare aria-hidden className="size-4" />} title="Something someone said" example="approved" onPick={onPick}>
            Finds words inside comments.
          </Tip>
          <Tip icon={<UserRound aria-hidden className="size-4" />} title="A teammate" example="Maya" onPick={onPick}>
            Then see everything on their plate.
          </Tip>
        </ul>
        <p className="mt-4 flex flex-wrap items-center gap-1 text-xs text-fg-muted">
          Tip: press <Kbd>{mod}</Kbd>
          <Kbd>K</Kbd> anywhere for quick search, or <Kbd>/</Kbd> to start typing.
        </p>
      </section>
    </div>
  );
}

function Tip({ icon, title, example, onPick, children }: { readonly icon: ReactNode; readonly title: string; readonly example: string; readonly onPick: (q: string) => void; readonly children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-sunken text-icon">{icon}</span>
      <span className="min-w-0">
        <span className="block font-medium text-fg">{title}</span>
        <span className="block text-fg-muted">
          {children}{' '}
          <button type="button" onClick={() => onPick(example)} className="font-medium text-fg-link hover:underline focus-visible:outline-2 focus-visible:outline-focus">
            Try “{example}”
          </button>
        </span>
      </span>
    </li>
  );
}

function Section({
  title,
  icon,
  count,
  shown,
  onShowAll,
  children,
}: {
  readonly title: string;
  readonly icon: ReactNode;
  readonly count: number;
  readonly shown: number;
  readonly onShowAll?: () => void;
  readonly children: ReactNode;
}) {
  return (
    <section aria-label={title}>
      <div className="mb-1 flex items-center justify-between gap-2 px-1">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold tracking-[0.06em] text-fg-muted uppercase">
          {icon} {title} <span className="font-normal tabular-nums">{count}</span>
        </h2>
        {onShowAll && count > shown ? (
          <button type="button" onClick={onShowAll} className="inline-flex items-center gap-1 text-xs font-medium text-fg-link hover:underline">
            See all {count} <ArrowRight aria-hidden className="size-3" />
          </button>
        ) : null}
      </div>
      <ul className="overflow-hidden rounded-xl border border-border-subtle bg-panel">{children}</ul>
    </section>
  );
}

function Results({
  data,
  type,
  q,
  onShowAll,
  onPersonTasks,
}: {
  readonly data: FullSearchResults;
  readonly type: FullSearchType;
  readonly q: string;
  readonly onShowAll: (type: FullSearchType) => void;
  readonly onPersonTasks: (id: string) => void;
}) {
  const projects = useProjects();
  const projectNames = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p.name])), [projects.data]);
  const all = type === 'all';
  const show = (t: Exclude<FullSearchType, 'all'>) => (all || type === t) && (data.counts[t] ?? 0) > 0;
  return (
    <div className="flex flex-col gap-5" data-testid="search-results">
      {show('tasks') ? (
        <Section title="Tasks" icon={<StatusIcon category="todo" size={12} />} count={data.counts.tasks} shown={data.tasks.length} onShowAll={all ? () => onShowAll('tasks') : undefined}>
          {data.tasks.map((task) => (
            <TaskResult key={task.id} task={task} q={q} projectName={projectNames.get(task.projectId)} />
          ))}
        </Section>
      ) : null}
      {show('comments') ? (
        <Section title="Comments" icon={<MessageSquare aria-hidden className="size-3.5" />} count={data.counts.comments} shown={data.comments.length} onShowAll={all ? () => onShowAll('comments') : undefined}>
          {data.comments.map((hit) => (
            <CommentResult key={hit.id} hit={hit} q={q} />
          ))}
        </Section>
      ) : null}
      {show('projects') ? (
        <Section title="Projects" icon={<FolderKanban aria-hidden className="size-3.5" />} count={data.counts.projects} shown={data.projects.length} onShowAll={all ? () => onShowAll('projects') : undefined}>
          {data.projects.map((project) => (
            <ProjectResult key={project.id} project={project} q={q} />
          ))}
        </Section>
      ) : null}
      {show('programs') && data.programs?.length ? (
        <Section title="Programs" icon={<Repeat2 aria-hidden className="size-3.5" />} count={data.counts.programs ?? 0} shown={data.programs.length} onShowAll={all ? () => onShowAll('programs') : undefined}>
          {data.programs.map((program) => (
            <ProgramResult key={program.id} program={program} q={q} />
          ))}
        </Section>
      ) : null}
      {show('people') ? (
        <Section title="People" icon={<UserRound aria-hidden className="size-3.5" />} count={data.counts.people} shown={data.people.length} onShowAll={all ? () => onShowAll('people') : undefined}>
          {data.people.map((person) => (
            <PersonResult key={person.id} person={person} q={q} onTasks={() => onPersonTasks(person.id)} />
          ))}
        </Section>
      ) : null}
      {show('goals') ? (
        <Section title="Goals" icon={<Target aria-hidden className="size-3.5" />} count={data.counts.goals} shown={data.goals.length} onShowAll={all ? () => onShowAll('goals') : undefined}>
          {data.goals.map((goal) => (
            <GoalResult key={goal.id} goal={goal} q={q} />
          ))}
        </Section>
      ) : null}
    </div>
  );
}

const ROW = 'flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none hover:bg-hover focus-visible:bg-hover focus-visible:shadow-[inset_2px_0_0_var(--color-primary)]';

/** "Small Brown · 60 of 100 kits" for a build result. */
function buildMeta(build: NonNullable<TaskSummary['build']>, unit: UnitLabel | undefined): string {
  const qty = unit ? qtyOfText(build.builtQty, build.plannedQty, unit) : `${formatQty(build.builtQty)} of ${formatQty(build.plannedQty)} built`;
  return [build.variantName, qty].filter(Boolean).join(' · ');
}

function TaskResult({ task, q, projectName }: { readonly task: TaskSummary; readonly q: string; readonly projectName?: string }) {
  const { openTask } = useTaskDrawer();
  const hydrated = useHydrated();
  const programs = usePrograms({}, { staleTime: 60_000, enabled: task.kind === 'build' });
  const unit = task.kind === 'build' && hydrated ? programs.data?.find((program) => program.id === task.projectId)?.unit : undefined;
  const done = task.statusCategory === 'done' || task.statusCategory === 'cancelled';
  return (
    <li className="border-b border-border-subtle last:border-b-0">
      <button type="button" data-search-result data-testid="search-task" onClick={() => openTask(task.key)} className={ROW}>
        <StatusIcon category={task.statusCategory} size={16} />
        <span className="flex min-w-0 flex-1 flex-col">
          <Highlight text={task.title} query={q} className={cn('truncate text-sm', done ? 'text-fg-muted line-through' : 'text-fg')} />
          <span className="truncate text-xs text-fg-muted">
            <Highlight text={task.key} query={q} /> · {task.build ? buildMeta(task.build, unit) : (projectName ?? task.projectKey)}
          </span>
        </span>
        {task.kind === 'build' ? (
          <Badge tone="info" size="sm" className="shrink-0">
            Build
          </Badge>
        ) : null}
        {task.priority !== 'none' ? <PriorityIcon priority={task.priority} /> : null}
        <DueDate date={task.dueDate} done={done} className="hidden sm:inline-flex" />
        <PersonAvatar userId={task.assigneeId} size="xs" />
      </button>
    </li>
  );
}

function CommentResult({ hit, q }: { readonly hit: CommentSearchHit; readonly q: string }) {
  const { openTask } = useTaskDrawer();
  const people = usePeopleMap();
  const author = hit.authorId ? people.get(hit.authorId) : undefined;
  return (
    <li className="border-b border-border-subtle last:border-b-0">
      <button type="button" data-search-result data-testid="search-comment" onClick={() => openTask(hit.taskKey)} className={cn(ROW, 'items-start')}>
        <PersonAvatar userId={hit.authorId} size="sm" className="mt-0.5" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-xs text-fg-muted">
            <span className="font-medium text-fg-secondary">{author?.name ?? 'Someone'}</span> commented on{' '}
            <span className="font-medium text-fg-secondary">{hit.taskKey}</span> · {hit.taskTitle}
          </span>
          <Highlight text={hit.excerpt} query={q} className="line-clamp-2 text-sm text-fg" />
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs text-fg-muted">
          <Clock aria-hidden className="size-3" />
          {formatRelative(hit.createdAt)}
        </span>
      </button>
    </li>
  );
}

function ProjectResult({ project, q }: { readonly project: ProjectSummary; readonly q: string }) {
  return (
    <li className="border-b border-border-subtle last:border-b-0">
      <Link href={routes.project(project.key)} data-search-result data-testid="search-project" className={ROW}>
        <EntityIcon icon={project.icon} color={project.color} size={28} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <Highlight text={project.name} query={q} className="truncate text-sm font-medium text-fg" />
            <span className="shrink-0 text-xs text-fg-muted">{project.key}</span>
          </span>
          <ProgressBar value={project.progress.percent} size="sm" tone={healthProgressTone(project.health)} label={`${project.name} progress`} className="max-w-56" />
        </span>
        <ProjectHealthMark project={project} className="max-sm:hidden" />
        <span className="w-10 text-right text-xs text-fg-muted tabular-nums">{project.progress.percent}%</span>
      </Link>
    </li>
  );
}

function ProgramResult({ program, q }: { readonly program: ProgramSearchHit; readonly q: string }) {
  const hydrated = useHydrated();
  const programs = usePrograms({}, { staleTime: 60_000 });
  const item = hydrated ? programs.data?.find((p) => p.id === program.id) : undefined;
  const href = programHref(program.key);
  const meta = [item?.customer?.name, item && item.today.builds > 0 ? `${item.today.done} of ${item.today.builds} builds done today` : null].filter(Boolean).join(' · ');
  const body = (
    <>
      <ProgramIcon icon={program.icon} color={program.color} size={28} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <Highlight text={program.name} query={q} className="truncate text-sm font-medium text-fg" />
          <Highlight text={program.key} query={q} className="shrink-0 font-key text-xs text-fg-muted" />
        </span>
        <span className="truncate text-xs text-fg-muted">{meta || 'Program'}</span>
      </span>
      <ProgramStatusPill status={program.status} className="max-sm:hidden" />
    </>
  );
  return (
    <li className="border-b border-border-subtle last:border-b-0">
      {href ? (
        <Link href={href} data-search-result data-testid="search-program" className={ROW}>
          {body}
        </Link>
      ) : (
        <div data-testid="search-program" className={cn(ROW, 'hover:bg-transparent')}>
          {body}
        </div>
      )}
    </li>
  );
}

function PersonResult({ person, q, onTasks }: { readonly person: OrgPerson; readonly q: string; readonly onTasks: () => void }) {
  return (
    <li className="border-b border-border-subtle last:border-b-0">
      <button type="button" data-search-result data-testid="search-person" onClick={onTasks} className={ROW}>
        <Avatar name={person.name} src={person.image} size="md" />
        <span className="flex min-w-0 flex-1 flex-col">
          <Highlight text={person.name} query={q} className="truncate text-sm font-medium text-fg" />
          <span className="truncate text-xs text-fg-muted">
            {person.title ? `${person.title} · ` : ''}
            <Highlight text={person.email} query={q} />
          </span>
        </span>
        <span className="hidden shrink-0 items-center gap-1 text-xs font-medium text-fg-link sm:inline-flex">
          Their open tasks <ArrowRight aria-hidden className="size-3" />
        </span>
      </button>
    </li>
  );
}

function GoalResult({ goal, q }: { readonly goal: GoalDTO; readonly q: string }) {
  return (
    <li className="border-b border-border-subtle last:border-b-0">
      <Link href={routes.goal(goal.id)} data-search-result data-testid="search-goal" className={ROW}>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sunken text-icon">
          <Target aria-hidden className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <Highlight text={goal.name} query={q} className="truncate text-sm font-medium text-fg" />
            {goal.period ? <span className="shrink-0 text-xs text-fg-muted">{goal.period}</span> : null}
          </span>
          <ProgressBar value={goal.progress} size="sm" tone={healthProgressTone(goal.health)} label={`${goal.name} progress`} className="max-w-56" />
        </span>
        <Badge tone={HEALTH_TONE[goal.health]} size="sm" className="hidden sm:inline-flex">
          {GOAL_HEALTH_LABELS[goal.health]}
        </Badge>
        <span className="w-10 text-right text-xs text-fg-muted tabular-nums">{Math.round(goal.progress)}%</span>
      </Link>
    </li>
  );
}
