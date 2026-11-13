/**
 * Working state of the Board, List and Table views (owner: views-a), as plain data:
 *
 * - `QuickFilters`: the filter bar (search, only mine, assignee, status, priority, labels, due).
 * - `ViewSettings`: grouping, swimlanes, sort, show done / subtasks, table columns.
 *
 * Both live in the URL (shareable, back-button friendly) on top of a base config (the selected
 * saved view, the project's default view or the built-in default). Saved views store the
 * effective config (`pm.saved_views.config`, see src/lib/view-config.ts) with `quick` and a
 * best-effort `filters` FilterGroup so other surfaces can read it. Pure: no React, no DOM.
 */
import { PRIORITIES, type Priority, type ViewType } from '@/lib/constants';
import { addDaysIso, startOfWeekIso, todayIso } from '@/lib/dates';
import type { TaskSummary } from '@/lib/types';
import { defaultViewConfig, type FilterCondition, type FilterGroup, type GroupField, type SortRule, type ViewColumn, type ViewConfig } from '@/lib/view-config';

/** Views this module drives. */
export type ManagedViewType = Extract<ViewType, 'board' | 'list' | 'table'>;

/** Assignee / label value meaning "nobody" / "no label". */
export const NONE = 'none';
/** Assignee value meaning "the viewer". */
export const ME = 'me';

export const DUE_FILTERS = ['overdue', 'today', 'this_week', 'next_7_days', 'no_date'] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];

export const DUE_FILTER_LABELS: Readonly<Record<DueFilter, string>> = {
  overdue: 'Overdue',
  today: 'Due today',
  this_week: 'Due this week',
  next_7_days: 'Due in the next 7 days',
  no_date: 'No due date',
};

export interface QuickFilters {
  readonly q: string;
  readonly mine: boolean;
  /** User ids, `me` or `none`. */
  readonly assignees: readonly string[];
  readonly statuses: readonly string[];
  readonly priorities: readonly Priority[];
  /** Label ids or `none`. */
  readonly labels: readonly string[];
  readonly due: DueFilter | null;
}

export const EMPTY_QUICK: QuickFilters = { q: '', mine: false, assignees: [], statuses: [], priorities: [], labels: [], due: null };

/** `crm` / `wms`: lanes by linked CRM customer or WMS status (src/features/integrations/link-lanes.tsx). */
export type Swimlane = 'none' | 'assignee' | 'priority' | 'label' | 'crm' | 'wms';
export const SWIMLANES: readonly Swimlane[] = ['none', 'assignee', 'priority', 'label', 'crm', 'wms'];

export type ListGroup = Extract<GroupField, 'section' | 'status' | 'priority' | 'assignee' | 'label' | 'none'>;
export const LIST_GROUPS: readonly ListGroup[] = ['section', 'status', 'priority', 'assignee', 'label', 'none'];

export type TableGroup = Extract<GroupField, 'none' | 'status' | 'assignee' | 'priority' | 'section' | 'label' | 'custom'>;
export const TABLE_GROUPS: readonly TableGroup[] = ['none', 'status', 'assignee', 'priority', 'section', 'label', 'custom'];

export const GROUP_LABELS: Readonly<Record<string, string>> = {
  none: 'No grouping',
  section: 'Section',
  status: 'Status',
  priority: 'Priority',
  assignee: 'Assignee',
  label: 'Label',
  custom: 'Custom field',
  crm: 'CRM customer',
  wms: 'WMS status',
};

/** Card/row order for board columns and list groups. `position` = manual (drag to reorder). */
export type OrderField = 'position' | 'priority' | 'dueDate' | 'createdAt' | 'title';
export const ORDER_FIELDS: readonly OrderField[] = ['position', 'priority', 'dueDate', 'createdAt', 'title'];
export const ORDER_LABELS: Readonly<Record<OrderField, string>> = {
  position: 'Manual (drag to reorder)',
  priority: 'Priority',
  dueDate: 'Due date',
  createdAt: 'Newest first',
  title: 'Name (A to Z)',
};

export interface ViewSettings {
  readonly groupBy: GroupField;
  readonly groupFieldId: string | null;
  readonly swimlane: Swimlane;
  readonly sort: readonly SortRule[];
  readonly showCompleted: boolean;
  readonly showSubtasks: boolean;
  readonly columns: readonly ViewColumn[];
}

/** Every URL parameter this module owns (everything else, e.g. `task`, is left alone). */
export const VIEW_PARAMS = ['view', 'q', 'mine', 'assignee', 'status', 'priority', 'label', 'due', 'group', 'gfield', 'lane', 'sort', 'done', 'subtasks'] as const;
export type ViewParam = (typeof VIEW_PARAMS)[number];

const LIST_SEP = ',';

function splitList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(LIST_SEP)
    .map((part) => part.trim())
    .filter(Boolean);
}

const isPriority = (value: string): value is Priority => (PRIORITIES as readonly string[]).includes(value);
const isDue = (value: string): value is DueFilter => (DUE_FILTERS as readonly string[]).includes(value);

// --- Config <-> settings ------------------------------------------------------------------------

/** Built-in defaults per view, tuned for this app (a superset of defaultViewConfig). */
export function baseConfigFor(type: ManagedViewType): ViewConfig {
  const base = defaultViewConfig(type);
  if (type === 'board') return { ...base, sort: [{ field: 'position', dir: 'asc' }] };
  if (type === 'list') return { ...base, sort: [{ field: 'position', dir: 'asc' }], showSubtasks: false };
  return base;
}

export function settingsFromConfig(type: ManagedViewType, config: ViewConfig | undefined): ViewSettings {
  const fallback = baseConfigFor(type);
  const merged: ViewConfig = { ...fallback, ...(config ?? {}) };
  const swimlane = (SWIMLANES as readonly string[]).includes(String(merged.swimlane)) ? (merged.swimlane as Swimlane) : 'none';
  return {
    groupBy: merged.groupBy ?? (type === 'list' ? 'section' : 'none'),
    groupFieldId: typeof merged.groupFieldId === 'string' ? merged.groupFieldId : null,
    swimlane,
    sort: merged.sort && merged.sort.length > 0 ? merged.sort : (fallback.sort ?? []),
    showCompleted: merged.showCompleted !== false,
    showSubtasks: merged.showSubtasks === true,
    columns: merged.columns ?? fallback.columns ?? [],
  };
}

/** Best effort: rebuild quick filters from a FilterGroup written by another surface. */
export function quickFromFilters(filters: FilterGroup | undefined): { quick: QuickFilters; extra: FilterCondition[] } {
  if (!filters || filters.conditions.length === 0) return { quick: EMPTY_QUICK, extra: [] };
  if (filters.match === 'any') return { quick: EMPTY_QUICK, extra: [...filters.conditions] };
  let quick: QuickFilters = EMPTY_QUICK;
  const extra: FilterCondition[] = [];
  const values = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : value === undefined || value === null ? [] : [String(value)]);
  for (const condition of filters.conditions) {
    const { field, op, value } = condition;
    if (field === 'assignee' && (op === 'in' || op === 'is')) quick = { ...quick, assignees: values(value) };
    else if (field === 'assignee' && op === 'empty') quick = { ...quick, assignees: [NONE] };
    else if (field === 'status' && (op === 'in' || op === 'is')) quick = { ...quick, statuses: values(value) };
    else if (field === 'priority' && (op === 'in' || op === 'is')) quick = { ...quick, priorities: values(value).filter(isPriority) };
    else if (field === 'label' && (op === 'in' || op === 'is')) quick = { ...quick, labels: values(value) };
    else if (field === 'label' && op === 'empty') quick = { ...quick, labels: [NONE] };
    else if (field === 'title' && op === 'contains' && typeof value === 'string') quick = { ...quick, q: value };
    else if (field === 'dueDate' && (op === 'overdue' || op === 'today' || op === 'this_week' || op === 'next_7_days')) quick = { ...quick, due: op };
    else if (field === 'dueDate' && op === 'empty') quick = { ...quick, due: 'no_date' };
    else extra.push(condition);
  }
  return { quick, extra };
}

/** Quick filters as a FilterGroup (what other surfaces understand). Lossy for `none` mixed with ids. */
export function filtersFromQuick(quick: QuickFilters): FilterGroup {
  const conditions: FilterCondition[] = [];
  const assignees = quick.mine ? [ME] : quick.assignees;
  if (assignees.length === 1 && assignees[0] === NONE) conditions.push({ field: 'assignee', op: 'empty' });
  else if (assignees.length) conditions.push({ field: 'assignee', op: 'in', value: assignees.filter((id) => id !== NONE) });
  if (quick.statuses.length) conditions.push({ field: 'status', op: 'in', value: [...quick.statuses] });
  if (quick.priorities.length) conditions.push({ field: 'priority', op: 'in', value: [...quick.priorities] });
  if (quick.labels.length === 1 && quick.labels[0] === NONE) conditions.push({ field: 'label', op: 'empty' });
  else if (quick.labels.length) conditions.push({ field: 'label', op: 'in', value: quick.labels.filter((id) => id !== NONE) });
  if (quick.q.trim()) conditions.push({ field: 'title', op: 'contains', value: quick.q.trim() });
  if (quick.due === 'no_date') conditions.push({ field: 'dueDate', op: 'empty' });
  else if (quick.due) conditions.push({ field: 'dueDate', op: quick.due });
  return { match: 'all', conditions };
}

export function quickFromConfig(config: ViewConfig | undefined): { quick: QuickFilters; extra: FilterCondition[] } {
  const stored = config?.quick as Partial<QuickFilters> | undefined;
  if (stored && typeof stored === 'object') {
    return {
      quick: {
        q: typeof stored.q === 'string' ? stored.q : '',
        mine: stored.mine === true,
        assignees: Array.isArray(stored.assignees) ? stored.assignees.map(String) : [],
        statuses: Array.isArray(stored.statuses) ? stored.statuses.map(String) : [],
        priorities: Array.isArray(stored.priorities) ? stored.priorities.map(String).filter(isPriority) : [],
        labels: Array.isArray(stored.labels) ? stored.labels.map(String) : [],
        due: typeof stored.due === 'string' && isDue(stored.due) ? stored.due : null,
      },
      extra: [],
    };
  }
  return quickFromFilters(config?.filters);
}

/** The config a saved view stores for this state. */
export function configFrom(quick: QuickFilters, settings: ViewSettings, type: ManagedViewType): ViewConfig {
  const config: Record<string, unknown> = {
    filters: filtersFromQuick(quick),
    quick: { ...quick, q: quick.q.trim() },
    sort: settings.sort,
    showCompleted: settings.showCompleted,
    showSubtasks: settings.showSubtasks,
  };
  if (type === 'board') config.swimlane = settings.swimlane;
  if (type === 'list' || type === 'table') config.groupBy = settings.groupBy;
  if (type === 'table') {
    config.columns = settings.columns;
    if (settings.groupBy === 'custom' && settings.groupFieldId) config.groupFieldId = settings.groupFieldId;
  }
  return config as ViewConfig;
}

// --- URL <-> state ------------------------------------------------------------------------------

export function encodeSort(sort: readonly SortRule[]): string {
  return sort.map((rule) => `${rule.field === 'custom' && rule.fieldId ? `custom.${rule.fieldId}` : rule.field}:${rule.dir}`).join(LIST_SEP);
}

export function decodeSort(value: string): SortRule[] {
  const rules: SortRule[] = [];
  for (const part of splitList(value)) {
    const [rawField, rawDir] = part.split(':');
    if (!rawField) continue;
    const dir = rawDir === 'desc' ? 'desc' : 'asc';
    if (rawField.startsWith('custom.')) rules.push({ field: 'custom', fieldId: rawField.slice(7), dir });
    else rules.push({ field: rawField as SortRule['field'], dir });
  }
  return rules;
}

/** Reads overrides from the URL on top of the base state. Absent params keep the base value. */
export function applyParams(
  params: URLSearchParams,
  base: { quick: QuickFilters; settings: ViewSettings },
): { quick: QuickFilters; settings: ViewSettings } {
  let quick = base.quick;
  let settings = base.settings;
  if (params.has('q')) quick = { ...quick, q: params.get('q') ?? '' };
  if (params.has('mine')) quick = { ...quick, mine: params.get('mine') === '1' };
  if (params.has('assignee')) quick = { ...quick, assignees: splitList(params.get('assignee')) };
  if (params.has('status')) quick = { ...quick, statuses: splitList(params.get('status')) };
  if (params.has('priority')) quick = { ...quick, priorities: splitList(params.get('priority')).filter(isPriority) };
  if (params.has('label')) quick = { ...quick, labels: splitList(params.get('label')) };
  if (params.has('due')) {
    const due = params.get('due') ?? '';
    quick = { ...quick, due: isDue(due) ? due : null };
  }
  if (params.has('group')) settings = { ...settings, groupBy: (params.get('group') || 'none') as GroupField };
  if (params.has('gfield')) settings = { ...settings, groupFieldId: params.get('gfield') || null };
  if (params.has('lane')) {
    const lane = params.get('lane') ?? 'none';
    settings = { ...settings, swimlane: (SWIMLANES as readonly string[]).includes(lane) ? (lane as Swimlane) : 'none' };
  }
  if (params.has('sort')) {
    const sort = decodeSort(params.get('sort') ?? '');
    settings = { ...settings, sort: sort.length ? sort : base.settings.sort };
  }
  if (params.has('done')) settings = { ...settings, showCompleted: params.get('done') !== 'hide' };
  if (params.has('subtasks')) settings = { ...settings, showSubtasks: params.get('subtasks') === '1' };
  return { quick, settings };
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Writes `next` into `params` as overrides of `base`: params equal to the base are removed,
 * differing ones are set (an empty list is written as `key=` so it can clear a base filter).
 */
export function writeParams(
  params: URLSearchParams,
  base: { quick: QuickFilters; settings: ViewSettings },
  next: { quick: QuickFilters; settings: ViewSettings },
): URLSearchParams {
  const out = new URLSearchParams(params.toString());
  const put = (key: ViewParam, differs: boolean, value: string) => {
    if (differs) out.set(key, value);
    else out.delete(key);
  };
  const { quick: bq, settings: bs } = base;
  const { quick: nq, settings: ns } = next;
  put('q', nq.q !== bq.q, nq.q);
  put('mine', nq.mine !== bq.mine, nq.mine ? '1' : '0');
  put('assignee', !sameList(nq.assignees, bq.assignees), nq.assignees.join(LIST_SEP));
  put('status', !sameList(nq.statuses, bq.statuses), nq.statuses.join(LIST_SEP));
  put('priority', !sameList(nq.priorities, bq.priorities), nq.priorities.join(LIST_SEP));
  put('label', !sameList(nq.labels, bq.labels), nq.labels.join(LIST_SEP));
  put('due', nq.due !== bq.due, nq.due ?? '');
  put('group', ns.groupBy !== bs.groupBy, ns.groupBy);
  put('gfield', ns.groupFieldId !== bs.groupFieldId, ns.groupFieldId ?? '');
  put('lane', ns.swimlane !== bs.swimlane, ns.swimlane);
  put('sort', encodeSort(ns.sort) !== encodeSort(bs.sort), encodeSort(ns.sort));
  put('done', ns.showCompleted !== bs.showCompleted, ns.showCompleted ? 'show' : 'hide');
  put('subtasks', ns.showSubtasks !== bs.showSubtasks, ns.showSubtasks ? '1' : '0');
  return out;
}

/** True when the URL carries any working-state override (beyond the selected view). */
export function hasOverrides(params: URLSearchParams): boolean {
  return VIEW_PARAMS.some((key) => key !== 'view' && params.has(key));
}

export function columnsEqual(a: readonly ViewColumn[], b: readonly ViewColumn[]): boolean {
  return (
    a.length === b.length &&
    a.every((column, index) => {
      const other = b[index];
      return other !== undefined && other.key === column.key && Boolean(other.hidden) === Boolean(column.hidden) && (other.width ?? 0) === (column.width ?? 0);
    })
  );
}

// --- Evaluation ---------------------------------------------------------------------------------

export function countActiveFilters(quick: QuickFilters): number {
  return (
    (quick.q.trim() ? 1 : 0) +
    (quick.mine ? 1 : 0) +
    (quick.assignees.length ? 1 : 0) +
    (quick.statuses.length ? 1 : 0) +
    (quick.priorities.length ? 1 : 0) +
    (quick.labels.length ? 1 : 0) +
    (quick.due ? 1 : 0)
  );
}

function matchesDue(task: TaskSummary, due: DueFilter, today: string): boolean {
  const date = task.dueDate;
  const done = task.statusCategory === 'done' || task.statusCategory === 'cancelled';
  switch (due) {
    case 'overdue':
      return Boolean(date) && (date as string) < today && !done;
    case 'today':
      return date === today;
    case 'this_week': {
      const start = startOfWeekIso(today);
      return Boolean(date) && (date as string) >= start && (date as string) <= addDaysIso(start, 6);
    }
    case 'next_7_days':
      return Boolean(date) && (date as string) >= today && (date as string) <= addDaysIso(today, 7);
    case 'no_date':
      return !date;
  }
}

/** Does a task pass the filter bar? `me` resolves `me` / only-mine. */
export function matchesQuick(task: TaskSummary, quick: QuickFilters, me: string, today: string = todayIso()): boolean {
  const q = quick.q.trim().toLowerCase();
  if (q && !task.title.toLowerCase().includes(q) && !task.key.toLowerCase().includes(q)) return false;
  if (quick.mine && task.assigneeId !== me) return false;
  if (quick.assignees.length) {
    const wanted = quick.assignees.map((id) => (id === ME ? me : id));
    const ok = task.assigneeId ? wanted.includes(task.assigneeId) : wanted.includes(NONE);
    if (!ok) return false;
  }
  if (quick.statuses.length && !quick.statuses.includes(task.statusId)) return false;
  if (quick.priorities.length && !quick.priorities.includes(task.priority)) return false;
  if (quick.labels.length) {
    const ok = task.labelIds.length === 0 ? quick.labels.includes(NONE) : task.labelIds.some((id) => quick.labels.includes(id));
    if (!ok) return false;
  }
  if (quick.due && !matchesDue(task, quick.due, today)) return false;
  return true;
}

/** Order rule as a full SortRule list (newest first for createdAt). */
export function orderRules(field: OrderField): SortRule[] {
  return [{ field, dir: field === 'createdAt' ? 'desc' : 'asc' }];
}

export function orderFieldOf(sort: readonly SortRule[]): OrderField {
  const first = sort[0]?.field;
  return (ORDER_FIELDS as readonly string[]).includes(String(first)) ? (first as OrderField) : 'position';
}

/** Local storage key for the last-used state of a view (restored when the URL is bare). */
export function stickyKey(projectId: string, type: ManagedViewType): string {
  return `ks.projects.view.${projectId}.${type}`;
}
