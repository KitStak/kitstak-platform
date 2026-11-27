'use client';
/**
 * The shared filter bar for the Board, List and Table (CRM toolbar anatomy, 48px row):
 * saved views · search · "Only my tasks" · Assignee · Status · Priority · Labels · Due ·
 * view-specific layout controls (children) · result count · Save / Reset.
 * Responsive by its own width: separate filter buttons → one "Filter" panel → icon-only.
 * Cmd/Ctrl+F focuses the search.
 *
 * Page toolbars (program Builds, docs/programs/SPEC.md 5.7) get one "Filter" button instead:
 * Search first, then the page's own categories (Variant, Short, Unplanned, Work type) mixed with
 * Status, Assignee, Labels and Mine. The whole row scrolls sideways on a phone. `usePageFilter`
 * is the same Filter for the toolbars of Runs, Calendar and Timeline.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Boxes, CalendarClock, CircleDashed, ListFilter, RotateCcw, Save, Search, Signal, Tag, UserRound, UsersRound } from 'lucide-react';
import { Avatar, Button, Chip, IconButton, SearchInput, Tooltip, cn } from '@/components/ui';
import { PriorityIcon, StatusIcon } from '@/components/pm';
import { PRIORITIES, PRIORITY_LABELS, type Priority } from '@/lib/constants';
import { usePeople } from '@/lib/hooks/use-data';
import type { TaskSummary } from '@/lib/types';
import { useCurrentProject } from '@/features/projects/project-context';
import { useShell } from '@/features/shell/shell-context';
import { useCardExtras, type ExtraFilterCategory } from './card-extras';
import { LabelDot } from './field-pickers';
import { OptionList, type OptionItem } from './option-list';
import { SaveViewButton, SavedViewsMenu } from './saved-views-menu';
import { ToolbarButton, ToolbarDivider, ToolbarPopover } from './toolbar-button';
import type { ViewStateApi } from './use-view-state';
import {
  DUE_FILTERS,
  DUE_FILTER_LABELS,
  EMPTY_QUICK,
  ME,
  NONE,
  WORK_FILTERS,
  WORK_FILTER_LABELS,
  applyParams,
  countActiveFilters,
  settingsFromConfig,
  writeParams,
  type DueFilter,
  type QuickFilters,
  type WorkFilter,
} from './view-state';
import { useTaskSource } from './task-source';

type FilterKey = 'assignee' | 'status' | 'priority' | 'label' | 'due';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(1280);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 1280));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function toggleIn<T extends string>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

/** What the filter controls need from a view state (ViewStateApi, or useQuickFilterState). */
export interface FilterStateApi {
  readonly quick: QuickFilters;
  readonly settings: { readonly showSubtasks: boolean; readonly showCompleted: boolean };
  readonly me: string;
  readonly activeFilterCount: number;
  setQuick(patch: Partial<QuickFilters>): void;
  clearFilters(): void;
}

const QUICK_BASE = { quick: EMPTY_QUICK, settings: { ...settingsFromConfig('list', undefined), showCompleted: true, showSubtasks: true } };

/**
 * The shared quick filters (q, mine, assignee, status, label, priority, due) read from and written
 * to the URL, without saved views. Views that have no `useViewState` (Runs, Calendar, Timeline on
 * a program page) use it so every builds view reads the same params.
 */
export function useQuickFilterState(): FilterStateApi {
  const params = useSearchParams();
  const pathname = usePathname() ?? '';
  const { user } = useShell();
  const quick = useMemo(() => applyParams(new URLSearchParams(params?.toString() ?? ''), QUICK_BASE).quick, [params]);
  const write = useCallback(
    (next: (current: QuickFilters) => QuickFilters) => {
      const search = new URLSearchParams(window.location.search);
      const current = applyParams(search, QUICK_BASE);
      const out = writeParams(search, QUICK_BASE, { quick: next(current.quick), settings: current.settings });
      const query = out.toString();
      window.history.replaceState(null, '', query ? `${pathname}?${query}` : pathname);
    },
    [pathname],
  );
  const setQuick = useCallback((patch: Partial<QuickFilters>) => write((current) => ({ ...current, ...patch })), [write]);
  const clearFilters = useCallback(() => write(() => EMPTY_QUICK), [write]);
  return useMemo(
    () => ({ quick, settings: QUICK_BASE.settings, me: user.id, activeFilterCount: countActiveFilters(quick), setQuick, clearFilters }),
    [clearFilters, quick, setQuick, user.id],
  );
}

/** Option lists + summaries for each filter, with live counts. */
function useFilterModel(view: FilterStateApi, tasks: readonly TaskSummary[]) {
  const { project, statuses, labelById, statusById } = useCurrentProject();
  const people = usePeople();
  const { showSubtasks, showCompleted } = view.settings;
  const me = view.me;
  const pool = useMemo(
    () => tasks.filter((task) => (showSubtasks || !task.parentTaskId) && (showCompleted || (task.statusCategory !== 'done' && task.statusCategory !== 'cancelled'))),
    [tasks, showCompleted, showSubtasks],
  );
  return useMemo(() => {
    const count = (predicate: (task: TaskSummary) => boolean) => pool.filter(predicate).length || undefined;
    const peopleById = new Map((people.data ?? []).map((person) => [person.id, person]));
    const assigneeIds = new Set<string>(project.members.map((member) => member.userId));
    for (const task of pool) if (task.assigneeId) assigneeIds.add(task.assigneeId);
    const assignee: OptionItem[] = [
      { value: ME, label: 'Me', icon: <UserRound aria-hidden className="size-4 text-icon" />, hint: count((task) => task.assigneeId === me), keywords: 'mine myself' },
      { value: NONE, label: 'Unassigned', icon: <span aria-hidden className="inline-flex size-5 items-center justify-center rounded-full border border-dashed border-border-strong" />, hint: count((task) => !task.assigneeId), keywords: 'nobody no one' },
      ...[...assigneeIds]
        .filter((id) => id !== me)
        .map((id) => {
          const person = peopleById.get(id);
          return { value: id, label: person?.name ?? 'Former member', icon: <Avatar name={person?.name ?? '?'} src={person?.image} size="xs" />, hint: count((task) => task.assigneeId === id), keywords: person?.email };
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];
    const status: OptionItem[] = statuses.map((entry) => ({ value: entry.id, label: entry.name, icon: <StatusIcon category={entry.category} color={entry.color} />, hint: count((task) => task.statusId === entry.id) }));
    const priority: OptionItem[] = PRIORITIES.map((entry) => ({ value: entry, label: PRIORITY_LABELS[entry], icon: <PriorityIcon priority={entry} />, hint: count((task) => task.priority === entry) }));
    const label: OptionItem[] = [
      ...project.labels.map((entry) => ({ value: entry.id, label: entry.name, icon: <LabelDot color={entry.color} />, hint: count((task) => task.labelIds.includes(entry.id)) })),
      { value: NONE, label: 'No label', icon: <Tag aria-hidden className="size-3.5 text-icon" />, hint: count((task) => task.labelIds.length === 0) },
    ];
    const due: OptionItem[] = DUE_FILTERS.map((entry) => ({ value: entry, label: DUE_FILTER_LABELS[entry], icon: <CalendarClock aria-hidden className="size-4 text-icon" /> }));

    const name = (id: string) => (id === ME ? 'Me' : id === NONE ? 'Unassigned' : (peopleById.get(id)?.name ?? 'Former member'));
    const summarize = (values: readonly string[], render: (value: string) => string) => (values.length === 1 ? render(values[0] as string) : `${render(values[0] as string)} +${values.length - 1}`);
    const summary = (quick: QuickFilters): Record<FilterKey, string | null> => ({
      assignee: quick.assignees.length ? summarize(quick.assignees, name) : null,
      status: quick.statuses.length ? summarize(quick.statuses, (id) => statusById.get(id)?.name ?? 'Status') : null,
      priority: quick.priorities.length ? summarize(quick.priorities, (id) => PRIORITY_LABELS[id as Priority]) : null,
      label: quick.labels.length ? summarize(quick.labels, (id) => (id === NONE ? 'No label' : (labelById.get(id)?.name ?? 'Label'))) : null,
      due: quick.due ? DUE_FILTER_LABELS[quick.due] : null,
    });
    return { options: { assignee, status, priority, label, due } as Record<FilterKey, OptionItem[]>, summary, mineCount: count((task) => task.assigneeId === me) };
  }, [labelById, me, people.data, pool, project.labels, project.members, statusById, statuses]);
}

const FILTER_META: Readonly<Record<FilterKey, { label: string; icon: ReactNode; placeholder: string }>> = {
  assignee: { label: 'Assignee', icon: <UsersRound aria-hidden />, placeholder: 'Find a person…' },
  status: { label: 'Status', icon: <CircleDashed aria-hidden />, placeholder: 'Find a status…' },
  priority: { label: 'Priority', icon: <Signal aria-hidden />, placeholder: 'Find a priority…' },
  label: { label: 'Labels', icon: <Tag aria-hidden />, placeholder: 'Find a label…' },
  due: { label: 'Due', icon: <CalendarClock aria-hidden />, placeholder: 'Due…' },
};

const FILTER_KEYS: readonly FilterKey[] = ['assignee', 'status', 'priority', 'label', 'due'];

function selectedFor(quick: QuickFilters, key: FilterKey): string[] {
  switch (key) {
    case 'assignee':
      return [...quick.assignees];
    case 'status':
      return [...quick.statuses];
    case 'priority':
      return [...quick.priorities];
    case 'label':
      return [...quick.labels];
    case 'due':
      return quick.due ? [quick.due] : [];
  }
}

function toggleFilter(view: FilterStateApi, key: FilterKey, value: string) {
  const { quick } = view;
  switch (key) {
    case 'assignee':
      view.setQuick({ assignees: toggleIn(quick.assignees, value), ...(quick.mine ? { mine: false } : {}) });
      return;
    case 'status':
      view.setQuick({ statuses: toggleIn(quick.statuses, value) });
      return;
    case 'priority':
      view.setQuick({ priorities: toggleIn(quick.priorities, value as Priority) });
      return;
    case 'label':
      view.setQuick({ labels: toggleIn(quick.labels, value) });
      return;
    case 'due':
      view.setQuick({ due: quick.due === value ? null : (value as DueFilter) });
  }
}

function clearFilter(view: FilterStateApi, key: FilterKey) {
  if (key === 'assignee') view.setQuick({ assignees: [] });
  else if (key === 'status') view.setQuick({ statuses: [] });
  else if (key === 'priority') view.setQuick({ priorities: [] });
  else if (key === 'label') view.setQuick({ labels: [] });
  else view.setQuick({ due: null });
}

/** Every filter in one panel (narrow toolbars): category rail + options. */
function AllFiltersPanel({ view, model }: { readonly view: FilterStateApi; readonly model: ReturnType<typeof useFilterModel> }) {
  const [tab, setTab] = useState<FilterKey>('assignee');
  const summary = model.summary(view.quick);
  return (
    <div className="flex min-h-[300px] max-sm:flex-col">
      <div role="tablist" aria-label="Filter by" className="flex w-36 shrink-0 flex-col gap-0.5 border-r border-border-subtle p-1.5 max-sm:w-full max-sm:flex-row max-sm:overflow-x-auto max-sm:border-r-0 max-sm:border-b">
        {FILTER_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              'flex h-8 shrink-0 items-center gap-2 rounded-sm px-2 text-left text-sm outline-none [&_svg]:size-4 [&_svg]:text-icon',
              'hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus',
              tab === key ? 'bg-selected font-medium text-fg' : 'text-fg-secondary',
            )}
          >
            {FILTER_META[key].icon}
            <span className="flex-1 truncate">{FILTER_META[key].label}</span>
            {summary[key] ? <span aria-label="active" className="size-1.5 rounded-full bg-icon-strong" /> : null}
          </button>
        ))}
        <div className="mt-auto p-1 max-sm:mt-0 max-sm:ml-auto">
          <Button variant="ghost" size="xs" onClick={view.clearFilters} disabled={view.activeFilterCount === 0}>
            Clear all
          </Button>
        </div>
      </div>
      <OptionList
        key={tab}
        className="min-w-0 flex-1"
        multiple={tab !== 'due'}
        searchable={tab === 'assignee' || tab === 'label' || tab === 'status'}
        placeholder={FILTER_META[tab].placeholder}
        options={model.options[tab]}
        selected={selectedFor(view.quick, tab)}
        onToggle={(value) => toggleFilter(view, tab, value)}
      />
    </div>
  );
}

/** One category of the page Filter panel (built in, or supplied by the page through extras). */
interface PanelCategory {
  readonly key: string;
  readonly label: string;
  readonly icon: ReactNode;
  /** Chip text when the category is on ("Status: Done"), else null. */
  readonly chip: string | null;
  clear(): void;
  render(): ReactNode;
}

/** The search box inside the Filter panel; writes the `q` param a moment after typing stops. */
function FilterSearch({ state, placeholder }: { readonly state: FilterStateApi; readonly placeholder: string }) {
  const [text, setText] = useState(state.quick.q);
  const { setQuick } = state;
  const latest = useRef(text);
  const pushed = useRef(text);
  useEffect(() => {
    latest.current = text;
    if (text === pushed.current) return;
    const handle = window.setTimeout(() => {
      pushed.current = text;
      setQuick({ q: text });
    }, 160);
    return () => window.clearTimeout(handle);
  }, [setQuick, text]);
  // Flush on close so a quick type and close still filters.
  useEffect(
    () => () => {
      if (latest.current !== pushed.current) setQuick({ q: latest.current });
    },
    [setQuick],
  );
  return (
    <div className="flex flex-col gap-2 p-3">
      <SearchInput size="sm" value={text} onValueChange={setText} escapeClears={false} autoFocus aria-label={placeholder} placeholder={placeholder} data-testid="view-search" />
      <p className="text-xs text-fg-muted">Matches the title and the key, like GLOVE-212.</p>
    </div>
  );
}

function usePanelCategories(state: FilterStateApi, model: ReturnType<typeof useFilterModel>, extras: readonly ExtraFilterCategory[], noun: string): PanelCategory[] {
  const summary = model.summary(state.quick);
  const builtIn = (key: FilterKey): PanelCategory => ({
    key,
    label: FILTER_META[key].label,
    icon: FILTER_META[key].icon,
    chip: summary[key] ? `${FILTER_META[key].label}: ${summary[key]}` : null,
    clear: () => clearFilter(state, key),
    render: () => (
      <OptionList
        key={key}
        className="min-w-0 flex-1"
        multiple={key !== 'due'}
        searchable={key === 'assignee' || key === 'label' || (key === 'status' && model.options.status.length > 6)}
        placeholder={FILTER_META[key].placeholder}
        options={model.options[key]}
        selected={selectedFor(state.quick, key)}
        onToggle={(value) => toggleFilter(state, key, value)}
      />
    ),
  });
  const fromExtra = (category: ExtraFilterCategory): PanelCategory => category;
  const q = state.quick.q.trim();
  const search: PanelCategory = {
    key: 'search',
    label: 'Search',
    icon: <Search aria-hidden />,
    chip: q ? `Search: “${q}”` : null,
    clear: () => state.setQuick({ q: '' }),
    render: () => <FilterSearch key="search" state={state} placeholder={`Search ${noun}`} />,
  };
  const mine: PanelCategory = {
    key: 'mine',
    label: 'Mine',
    icon: <UserRound aria-hidden />,
    chip: state.quick.mine ? `Only my ${noun}` : null,
    clear: () => state.setQuick({ mine: false }),
    render: () => (
      <OptionList
        key="mine"
        className="min-w-0 flex-1"
        searchable={false}
        options={[{ value: 'mine', label: `Only my ${noun}`, icon: <UserRound aria-hidden className="size-4 text-icon" />, hint: model.mineCount }]}
        selected={state.quick.mine ? ['mine'] : []}
        onToggle={() => state.setQuick({ mine: !state.quick.mine, ...(!state.quick.mine ? { assignees: [] } : {}) })}
      />
    ),
  };
  return [
    search,
    ...extras.filter((category) => category.placement === 'lead').map(fromExtra),
    builtIn('status'),
    builtIn('assignee'),
    builtIn('label'),
    ...extras.filter((category) => category.placement === 'trail').map(fromExtra),
    mine,
    builtIn('priority'),
    builtIn('due'),
  ];
}

function CategoryPanel({ categories, tab, onTab, onClearAll, anyActive }: { readonly categories: readonly PanelCategory[]; readonly tab: string; readonly onTab: (key: string) => void; readonly onClearAll: () => void; readonly anyActive: boolean }) {
  const current = categories.find((category) => category.key === tab) ?? categories[0];
  return (
    <div className="flex min-h-[320px] max-sm:flex-col">
      <div role="tablist" aria-label="Filter by" className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-border-subtle p-1.5 max-sm:w-full max-sm:flex-row max-sm:overflow-x-auto max-sm:border-r-0 max-sm:border-b max-sm:[scrollbar-width:none]">
        {categories.map((category) => (
          <button
            key={category.key}
            type="button"
            role="tab"
            aria-selected={current?.key === category.key}
            onClick={() => onTab(category.key)}
            data-testid={`filter-tab-${category.key}`}
            className={cn(
              'flex h-8 shrink-0 items-center gap-2 rounded-sm px-2 text-left text-sm outline-none [&_svg]:size-4 [&_svg]:text-icon',
              'hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus',
              current?.key === category.key ? 'bg-selected font-medium text-fg' : 'text-fg-secondary',
            )}
          >
            {category.icon}
            <span className="flex-1 truncate">{category.label}</span>
            {category.chip ? <span aria-label="on" className="size-1.5 rounded-full bg-icon-strong" /> : null}
          </button>
        ))}
        <div className="mt-auto p-1 max-sm:mt-0 max-sm:ml-auto">
          <Button variant="ghost" size="xs" onClick={onClearAll} disabled={!anyActive}>
            Clear all
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">{current?.render()}</div>
    </div>
  );
}

/**
 * The single Filter of page toolbars: a button that opens every category, and the chips of the
 * categories that are on (Search first). `openSearch` opens the panel on Search (Cmd/Ctrl+F).
 */
export function usePageFilter(state: FilterStateApi, tasks: readonly TaskSummary[], options: { readonly compact?: boolean; readonly enabled?: boolean } = {}) {
  const enabled = options.enabled !== false;
  const extras = useCardExtras();
  const model = useFilterModel(state, tasks);
  const noun = extras.noun?.plural ?? 'tasks';
  const categories = usePanelCategories(state, model, extras.filterCategories ?? [], noun);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('search');
  const on = categories.filter((category) => category.chip);
  const clearAll = useCallback(() => {
    state.clearFilters();
    extras.clearExtraFilters?.();
  }, [extras, state]);
  const openAt = useCallback((key: string) => {
    setTab(key);
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f' || event.shiftKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('[role="dialog"], [contenteditable="true"]')) return;
      event.preventDefault();
      openAt('search');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, openAt]);

  const button = (
    <ToolbarPopover
      icon={<ListFilter aria-hidden />}
      label={on.length ? `Filter, ${on.length} on` : 'Filter'}
      text="Filter"
      iconOnly={options.compact}
      active={on.length > 0}
      badge={on.length || undefined}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && !on.length) setTab('search');
      }}
      width={480}
      testId="filter-all"
    >
      <CategoryPanel categories={categories} tab={tab} onTab={setTab} onClearAll={clearAll} anyActive={on.length > 0} />
    </ToolbarPopover>
  );
  const chips = on.length ? (
    <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2.5 sm:px-6" aria-label="Active filters" data-testid="filter-chips">
      {on.map((category) => (
        <Chip key={category.key} size="sm" onRemove={category.clear} removeLabel="Remove filter" onClick={() => openAt(category.key)}>
          {category.chip}
        </Chip>
      ))}
      {on.length > 1 ? (
        <Button variant="ghost" size="xs" onClick={clearAll}>
          Clear all
        </Button>
      ) : null}
    </div>
  ) : null;
  return { button, chips, count: on.length, openSearch: () => openAt('search') };
}

export interface ViewToolbarProps {
  readonly view: ViewStateApi;
  /** Every task of the project (for option counts). */
  readonly tasks: readonly TaskSummary[];
  readonly shownCount: number;
  readonly totalCount: number;
  /** View-specific layout controls (swimlanes, group by, columns…). Receives `iconOnly`. */
  readonly controls?: (options: { iconOnly: boolean }) => ReactNode;
  /** Approximate width of the controls (for the responsive layout). */
  readonly controlsWidth?: number;
}

export function ViewToolbar(props: ViewToolbarProps) {
  const extras = useCardExtras();
  return extras.toolbarLead ? <PageViewToolbar {...props} /> : <ProjectViewToolbar {...props} />;
}

/** Program page toolbar: view toggle and range (lead), saved views, Filter, Display, More (trail). */
function PageViewToolbar({ view, tasks, shownCount, totalCount, controls }: ViewToolbarProps) {
  const [rootRef, width] = useWidth<HTMLDivElement>();
  const extras = useCardExtras();
  const compact = width < 640;
  const filter = usePageFilter(view, tasks, { compact });
  const filtered = shownCount !== totalCount;
  return (
    <div className="shrink-0 border-b border-border-subtle bg-panel" data-testid="view-toolbar">
      <div ref={rootRef} role="toolbar" aria-label="View tools" className="flex h-12 items-center gap-1.5 px-4 sm:px-6 [&>*]:shrink-0">
        {/* View toggle, range and saved views scroll sideways on a phone; Filter, Display and More stay put. */}
        <div className="-my-2 flex min-w-0 !shrink items-center gap-1.5 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
          {extras.toolbarLead}
          <ToolbarDivider />
          <SavedViewsMenu view={view} compact={compact} />
        </div>
        {filter.button}
        {controls ? controls({ iconOnly: width < 900 }) : null}
        <span aria-hidden className="min-w-0 flex-1 !shrink" />
        {filtered && !compact ? (
          <span className="text-xs whitespace-nowrap text-fg-muted tabular-nums" data-testid="view-count">
            {shownCount} of {totalCount}
          </span>
        ) : null}
        {view.dirty ? (
          <div className="flex animate-fade-in items-center gap-0.5" data-testid="view-dirty">
            {view.activeView && view.canEditView(view.activeView) ? (
              <Tooltip content={`Save these filters and layout to “${view.activeView.name}”`}>
                <Button variant="tertiary" size="sm" leadingIcon={<Save aria-hidden />} onClick={() => void view.saveChanges()} data-testid="save-view-changes">
                  <span className={cn(width < 900 && 'sr-only')}>Save</span>
                </Button>
              </Tooltip>
            ) : (
              <SaveViewButton view={view} iconOnly={width < 900} />
            )}
            <IconButton label={view.activeView ? `Reset to “${view.activeView.name}”` : 'Reset filters and layout'} size="sm" icon={<RotateCcw aria-hidden />} onClick={view.reset} data-testid="view-reset" />
          </div>
        ) : null}
        {extras.toolbarTrail}
      </div>
      {filter.chips}
    </div>
  );
}

function ProjectViewToolbar({ view, tasks, shownCount, totalCount, controls, controlsWidth }: ViewToolbarProps) {
  const [rootRef, width] = useWidth<HTMLDivElement>();
  const model = useFilterModel(view, tasks);
  const searchRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(view.quick.q);
  const [searchOpen, setSearchOpen] = useState(false);
  const [open, setOpen] = useState<FilterKey | 'all' | 'work' | null>(null);

  // URL → field (reset, saved view switch). Skip while the user is typing.
  const lastPushed = useRef(view.quick.q);
  useEffect(() => {
    if (view.quick.q !== lastPushed.current) {
      lastPushed.current = view.quick.q;
      // Mirror external URL changes into the input (URL is the source of truth).
      setText(view.quick.q);
    }
  }, [view.quick.q]);
  // Field → URL, debounced.
  const { setQuick } = view;
  useEffect(() => {
    if (text === lastPushed.current) return;
    const handle = window.setTimeout(() => {
      lastPushed.current = text;
      setQuick({ q: text });
    }, 180);
    return () => window.clearTimeout(handle);
  }, [setQuick, text]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f' || event.shiftKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('[role="dialog"], [contenteditable="true"]')) return;
      event.preventDefault();
      setSearchOpen(true);
      requestAnimationFrame(() => searchRef.current?.focus());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const extras = useCardExtras();
  const source = useTaskSource();
  const noun = extras.noun?.plural ?? 'tasks';
  const searchLabel = `Search ${noun}`;
  // Projects that hold builds get a Work type chip (Tasks, Builds, Both). Program pages carry
  // their own Work type inside the Builds filter.
  const hasBuilds = !source.fromProvider && tasks.some((task) => task.kind === 'build');
  const work: WorkFilter = view.quick.work ?? 'both';
  const summaryNow = model.summary(view.quick);
  // Separate filter buttons only when they fit: estimate their width from what they show. Room for
  // Save/Reset is always reserved so typing a search never flips the layout.
  const needed =
    440 + FILTER_KEYS.reduce((sum, key) => sum + (summaryNow[key] ? 60 + Math.min(150, 7.5 * (FILTER_META[key].label.length + (summaryNow[key]?.length ?? 0))) : 92), 0) + 130 + (controlsWidth ?? 100);
  // When the separate filters only fit with icon-only view controls (Table's Columns + Display),
  // shrink those controls first: every view keeps the same filter bar at the same width.
  const iconControls = width < needed && width >= needed - (controlsWidth ?? 100) + 80;
  const separate = width >= needed || iconControls;
  const compact = width < 640;
  const summary = summaryNow;
  const searchExpanded = !compact || searchOpen || text.length > 0;
  const filtered = shownCount !== totalCount;
  const chips = FILTER_KEYS.filter((key) => summary[key]);

  return (
    <div className="shrink-0 border-b border-border-subtle bg-panel" data-testid="view-toolbar">
      <div ref={rootRef} role="toolbar" aria-label="View tools" className="flex h-12 items-center gap-1.5 px-4 sm:px-6">
        <SavedViewsMenu view={view} compact={compact} />
        <ToolbarDivider />
        <div className="-my-2 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {searchExpanded ? (
          <SearchInput
            ref={searchRef}
            size="sm"
            value={text}
            onValueChange={setText}
            onEscape={() => setSearchOpen(false)}
            onBlur={() => !text && setSearchOpen(false)}
            aria-label={searchLabel}
            placeholder={searchLabel}
            data-testid="view-search"
            containerClassName={cn('shrink-0 transition-[width] duration-200 ease-out motion-reduce:transition-none', compact ? 'w-36' : separate ? 'w-44' : 'w-44 focus-within:w-56')}
          />
        ) : (
          <IconButton
            label={searchLabel}
            icon={<Search aria-hidden />}
            shortcut={['⌘', 'F']}
            onClick={() => {
              setSearchOpen(true);
              requestAnimationFrame(() => searchRef.current?.focus());
            }}
          />
        )}
        <Tooltip content={view.quick.mine ? 'Showing only tasks assigned to you' : 'Show only tasks assigned to you'} side="bottom">
          <ToolbarButton
            icon={<UserRound aria-hidden />}
            label="Only my tasks"
            text="My tasks"
            iconOnly={!separate}
            active={view.quick.mine}
            aria-pressed={view.quick.mine}
            onClick={() => view.setQuick({ mine: !view.quick.mine, ...(!view.quick.mine ? { assignees: [] } : {}) })}
            data-testid="filter-mine"
          />
        </Tooltip>
        {hasBuilds ? (
          <ToolbarPopover
            icon={<Boxes aria-hidden />}
            label={work === 'both' ? 'Work type' : `Work type: ${WORK_FILTER_LABELS[work]}`}
            text={work === 'both' ? 'Work type' : WORK_FILTER_LABELS[work]}
            iconOnly={compact}
            active={work !== 'both'}
            open={open === 'work'}
            onOpenChange={(next) => setOpen(next ? 'work' : null)}
            onClear={() => view.setQuick({ work: 'both' })}
            width={220}
            testId="filter-work"
          >
            <OptionList
              multiple={false}
              searchable={false}
              options={WORK_FILTERS.map((value) => ({ value, label: value === 'both' ? 'Both' : WORK_FILTER_LABELS[value], hint: value === 'both' ? undefined : tasks.filter((task) => (value === 'build') === (task.kind === 'build')).length || undefined }))}
              selected={[work]}
              onToggle={(value) => {
                view.setQuick({ work: value as WorkFilter });
                setOpen(null);
              }}
            />
          </ToolbarPopover>
        ) : null}
        {separate ? (
          FILTER_KEYS.map((key) => (
            <ToolbarPopover
              key={key}
              icon={FILTER_META[key].icon}
              label={FILTER_META[key].label}
              text={summary[key] ? `${FILTER_META[key].label}: ${summary[key]}` : FILTER_META[key].label}
              active={Boolean(summary[key])}
              open={open === key}
              onOpenChange={(next) => setOpen(next ? key : null)}
              onClear={() => clearFilter(view, key)}
              width={key === 'assignee' ? 300 : 260}
              testId={`filter-${key}`}
            >
              <OptionList
                multiple={key !== 'due'}
                searchable={key === 'assignee' || key === 'label' || (key === 'status' && model.options.status.length > 6)}
                placeholder={FILTER_META[key].placeholder}
                options={model.options[key]}
                selected={selectedFor(view.quick, key)}
                onToggle={(value) => {
                  toggleFilter(view, key, value);
                  if (key === 'due') setOpen(null);
                }}
                footer={
                  selectedFor(view.quick, key).length ? (
                    <Button variant="ghost" size="xs" fullWidth onClick={() => clearFilter(view, key)}>
                      Clear {FILTER_META[key].label.toLowerCase()}
                    </Button>
                  ) : undefined
                }
              />
            </ToolbarPopover>
          ))
        ) : (
          <ToolbarPopover
            icon={<ListFilter aria-hidden />}
            label={view.activeFilterCount ? `Filter, ${view.activeFilterCount} active` : 'Filter'}
            text="Filter"
            iconOnly={compact}
            active={chips.length > 0}
            badge={chips.length || undefined}
            open={open === 'all'}
            onOpenChange={(next) => setOpen(next ? 'all' : null)}
            width={460}
            testId="filter-all"
          >
            <AllFiltersPanel view={view} model={model} />
          </ToolbarPopover>
        )}
        {controls ? (
          <>
            <ToolbarDivider className="max-[480px]:hidden" />
            {controls({ iconOnly: width < 900 || iconControls })}
          </>
        ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pl-1">
          {filtered && !compact && (!separate || width >= needed + 70) ? (
            <span className="text-xs whitespace-nowrap text-fg-muted tabular-nums" data-testid="view-count">
              {shownCount} of {totalCount}
            </span>
          ) : null}
          {view.dirty ? (
            <div className="flex animate-fade-in items-center gap-0.5" data-testid="view-dirty">
              {view.activeView && view.canEditView(view.activeView) ? (
                <Tooltip content={`Save these filters and layout to “${view.activeView.name}”`}>
                  <Button variant="tertiary" size="sm" leadingIcon={<Save aria-hidden />} onClick={() => void view.saveChanges()} data-testid="save-view-changes">
                    <span className={cn(width < 900 && 'sr-only')}>Save</span>
                  </Button>
                </Tooltip>
              ) : (
                <SaveViewButton view={view} iconOnly={width < 900} />
              )}
              <IconButton label={view.activeView ? `Reset to “${view.activeView.name}”` : 'Reset filters and layout'} size="sm" icon={<RotateCcw aria-hidden />} onClick={view.reset} data-testid="view-reset" />
            </div>
          ) : null}
        </div>
      </div>
      {!separate && chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2.5 sm:px-6" aria-label="Active filters">
          {chips.map((key) => (
            <Chip key={key} size="sm" onRemove={() => clearFilter(view, key)} removeLabel="Remove filter" onClick={() => setOpen('all')}>
              {`${FILTER_META[key].label}: ${summary[key]}`}
            </Chip>
          ))}
          {compact && filtered ? <span className="text-xs text-fg-muted tabular-nums">{shownCount} of {totalCount}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
