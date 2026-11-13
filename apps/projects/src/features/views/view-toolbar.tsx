'use client';
/**
 * The shared filter bar for the Board, List and Table (CRM toolbar anatomy, 48px row):
 * saved views · search · "Only my tasks" · Assignee · Status · Priority · Labels · Due ·
 * view-specific layout controls (children) · result count · Save / Reset.
 * Responsive by its own width: separate filter buttons → one "Filter" panel → icon-only.
 * Cmd/Ctrl+F focuses the search.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CalendarClock, CircleDashed, ListFilter, RotateCcw, Save, Search, Signal, Tag, UserRound, UsersRound } from 'lucide-react';
import { Avatar, Button, Chip, IconButton, SearchInput, Tooltip, cn } from '@/components/ui';
import { PriorityIcon, StatusIcon } from '@/components/pm';
import { PRIORITIES, PRIORITY_LABELS, type Priority } from '@/lib/constants';
import { usePeople } from '@/lib/hooks/use-data';
import type { TaskSummary } from '@/lib/types';
import { useCurrentProject } from '@/features/projects/project-context';
import { LabelDot } from './field-pickers';
import { OptionList, type OptionItem } from './option-list';
import { SaveViewButton, SavedViewsMenu } from './saved-views-menu';
import { ToolbarButton, ToolbarDivider, ToolbarPopover } from './toolbar-button';
import type { ViewStateApi } from './use-view-state';
import { DUE_FILTERS, DUE_FILTER_LABELS, ME, NONE, type DueFilter, type QuickFilters } from './view-state';

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

/** Option lists + summaries for each filter, with live counts. */
function useFilterModel(view: ViewStateApi, tasks: readonly TaskSummary[]) {
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
    return { options: { assignee, status, priority, label, due } as Record<FilterKey, OptionItem[]>, summary };
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

function toggleFilter(view: ViewStateApi, key: FilterKey, value: string) {
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

function clearFilter(view: ViewStateApi, key: FilterKey) {
  if (key === 'assignee') view.setQuick({ assignees: [] });
  else if (key === 'status') view.setQuick({ statuses: [] });
  else if (key === 'priority') view.setQuick({ priorities: [] });
  else if (key === 'label') view.setQuick({ labels: [] });
  else view.setQuick({ due: null });
}

/** Every filter in one panel (narrow toolbars): category rail + options. */
function AllFiltersPanel({ view, model }: { readonly view: ViewStateApi; readonly model: ReturnType<typeof useFilterModel> }) {
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
            {summary[key] ? <span aria-label="active" className="size-1.5 rounded-full bg-primary" /> : null}
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

export function ViewToolbar({ view, tasks, shownCount, totalCount, controls, controlsWidth }: ViewToolbarProps) {
  const [rootRef, width] = useWidth<HTMLDivElement>();
  const model = useFilterModel(view, tasks);
  const searchRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(view.quick.q);
  const [searchOpen, setSearchOpen] = useState(false);
  const [open, setOpen] = useState<FilterKey | 'all' | null>(null);

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

  const summaryNow = model.summary(view.quick);
  // Separate filter buttons only when they fit: estimate their width from what they show. Room for
  // Save/Reset is always reserved so typing a search never flips the layout.
  const needed =
    440 + FILTER_KEYS.reduce((sum, key) => sum + (summaryNow[key] ? 60 + Math.min(150, 7.5 * (FILTER_META[key].label.length + (summaryNow[key]?.length ?? 0))) : 92), 0) + 130 + (controlsWidth ?? 100);
  const separate = width >= needed;
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
            aria-label="Search tasks"
            placeholder="Search tasks"
            data-testid="view-search"
            containerClassName={cn('shrink-0 transition-[width] duration-200 ease-out motion-reduce:transition-none', compact ? 'w-36' : separate ? 'w-44' : 'w-44 focus-within:w-56')}
          />
        ) : (
          <IconButton
            label="Search tasks"
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
            {controls({ iconOnly: width < 900 })}
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
