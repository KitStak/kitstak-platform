/**
 * Client + server evaluation of the view filter model (src/lib/view-config.ts) over TaskSummary
 * rows: filter, sort and group. Pure and deterministic, so every view, My Work and dashboards
 * agree on what "Due this week and assigned to me" means.
 */
import { PRIORITIES } from './constants';
import { addDaysIso, startOfWeekIso, todayIso } from './dates';
import { compareRank } from './rank';
import type { TaskSummary } from './types';
import type { FilterCondition, FilterGroup, GroupField, SortRule } from './view-config';

export interface FilterContext {
  /** Viewer id: `'me'` in people filters resolves to this. */
  readonly me: string;
  readonly today?: string;
}

type Scalar = string | number | boolean | null;

function resolveValue(value: unknown, ctx: FilterContext): unknown {
  if (value === 'me') return ctx.me;
  if (Array.isArray(value)) return value.map((entry) => (entry === 'me' ? ctx.me : entry));
  return value;
}

/** Field value(s) of a task for a filter condition. Arrays for multi-valued fields. */
function fieldValue(task: TaskSummary, condition: FilterCondition): Scalar | readonly Scalar[] {
  switch (condition.field) {
    case 'status':
      return task.statusId;
    case 'statusCategory':
      return task.statusCategory;
    case 'assignee':
      return task.assigneeId;
    case 'reporter':
      return task.reporterId;
    case 'priority':
      return task.priority;
    case 'label':
      return task.labelIds;
    case 'dueDate':
      return task.dueDate;
    case 'startDate':
      return task.startDate;
    case 'createdAt':
      return task.createdAt.slice(0, 10);
    case 'completedAt':
      return task.completedAt ? task.completedAt.slice(0, 10) : null;
    case 'milestone':
      return task.milestoneId;
    case 'section':
      return task.sectionId;
    case 'project':
      return task.projectId;
    case 'title':
      return task.title;
    case 'isSubtask':
      return task.parentTaskId !== null;
    case 'custom': {
      const raw = condition.fieldId ? task.customFields[condition.fieldId] : undefined;
      if (raw === undefined || raw === null || raw === '') return null;
      if (Array.isArray(raw)) return raw as Scalar[];
      return raw as Scalar;
    }
  }
}

const isEmpty = (value: Scalar | readonly Scalar[]): boolean =>
  value === null || value === '' || (Array.isArray(value) && value.length === 0);

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined ? [] : [value];
}

export function matchesCondition(task: TaskSummary, condition: FilterCondition, ctx: FilterContext): boolean {
  const today = ctx.today ?? todayIso();
  const actual = fieldValue(task, condition);
  const expected = resolveValue(condition.value, ctx);
  const values: readonly Scalar[] = Array.isArray(actual) ? actual : [actual as Scalar];
  const done = task.statusCategory === 'done' || task.statusCategory === 'cancelled';
  switch (condition.op) {
    case 'empty':
      return isEmpty(actual);
    case 'not_empty':
      return !isEmpty(actual);
    case 'is':
      return Array.isArray(actual) ? values.includes(expected as Scalar) : actual === expected;
    case 'is_not':
      return Array.isArray(actual) ? !values.includes(expected as Scalar) : actual !== expected;
    case 'in': {
      const wanted = asArray(expected);
      return values.some((value) => wanted.includes(value));
    }
    case 'not_in': {
      const unwanted = asArray(expected);
      return !values.some((value) => unwanted.includes(value));
    }
    case 'contains':
      return typeof actual === 'string' && typeof expected === 'string'
        ? actual.toLowerCase().includes(expected.toLowerCase())
        : values.includes(expected as Scalar);
    case 'not_contains':
      return typeof actual === 'string' && typeof expected === 'string'
        ? !actual.toLowerCase().includes(expected.toLowerCase())
        : !values.includes(expected as Scalar);
    case 'before':
      return typeof actual === 'string' && typeof expected === 'string' && actual < expected;
    case 'after':
      return typeof actual === 'string' && typeof expected === 'string' && actual > expected;
    case 'on':
      return actual === expected;
    case 'between': {
      const [from, to] = asArray(expected) as [unknown, unknown];
      return (
        typeof actual === 'string' &&
        (typeof from !== 'string' || actual >= from) &&
        (typeof to !== 'string' || actual <= to)
      );
    }
    case 'overdue':
      return typeof actual === 'string' && actual < today && !done;
    case 'today':
      return actual === today;
    case 'this_week': {
      const start = startOfWeekIso(today);
      const end = addDaysIso(start, 6);
      return typeof actual === 'string' && actual >= start && actual <= end;
    }
    case 'next_7_days':
      return typeof actual === 'string' && actual >= today && actual <= addDaysIso(today, 7);
    case 'gt':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'lt':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
  }
}

export function matchesFilters(task: TaskSummary, filters: FilterGroup | undefined, ctx: FilterContext): boolean {
  if (!filters || filters.conditions.length === 0) return true;
  return filters.match === 'all'
    ? filters.conditions.every((condition) => matchesCondition(task, condition, ctx))
    : filters.conditions.some((condition) => matchesCondition(task, condition, ctx));
}

export function applyFilters(
  tasks: readonly TaskSummary[],
  filters: FilterGroup | undefined,
  ctx: FilterContext,
): TaskSummary[] {
  return tasks.filter((task) => matchesFilters(task, filters, ctx));
}

const PRIORITY_ORDER: Readonly<Record<string, number>> = Object.fromEntries(PRIORITIES.map((p, i) => [p, i]));

function sortKey(task: TaskSummary, rule: SortRule): string | number | null {
  switch (rule.field) {
    case 'priority':
      return PRIORITY_ORDER[task.priority] ?? 99;
    case 'number':
      return task.number;
    case 'title':
      return task.title.toLowerCase();
    case 'position':
      return task.position;
    case 'dueDate':
      return task.dueDate;
    case 'startDate':
      return task.startDate;
    case 'createdAt':
      return task.createdAt;
    case 'updatedAt':
      return task.updatedAt;
    case 'completedAt':
      return task.completedAt;
    case 'status':
      return task.statusId;
    case 'statusCategory':
      return task.statusCategory;
    case 'assignee':
      return task.assigneeId;
    case 'reporter':
      return task.reporterId;
    case 'section':
      return task.sectionId;
    case 'milestone':
      return task.milestoneId;
    case 'project':
      return task.projectKey;
    case 'custom': {
      const raw = rule.fieldId ? task.customFields[rule.fieldId] : null;
      return typeof raw === 'number' || typeof raw === 'string' ? raw : null;
    }
  }
}

/** Stable multi-key sort; nulls always sort last. Falls back to manual position. */
export function sortTasks(tasks: readonly TaskSummary[], rules: readonly SortRule[] | undefined): TaskSummary[] {
  const effective = rules && rules.length > 0 ? rules : [{ field: 'position', dir: 'asc' } as const];
  return [...tasks].sort((a, b) => {
    for (const rule of effective) {
      const ka = sortKey(a, rule);
      const kb = sortKey(b, rule);
      if (ka === kb) continue;
      if (ka === null) return 1;
      if (kb === null) return -1;
      const cmp =
        rule.field === 'position' && typeof ka === 'string' && typeof kb === 'string'
          ? compareRank(ka, kb)
          : ka < kb
            ? -1
            : 1;
      return rule.dir === 'asc' ? cmp : -cmp;
    }
    return compareRank(a.position, b.position);
  });
}

export interface TaskGroup {
  /** Group value (status id, user id, priority…) or `__none__`. */
  readonly key: string;
  readonly tasks: readonly TaskSummary[];
}

export const NO_GROUP = '__none__';

function groupKeys(task: TaskSummary, field: GroupField, fieldId?: string): string[] {
  switch (field) {
    case 'none':
      return ['all'];
    case 'status':
      return [task.statusId];
    case 'statusCategory':
      return [task.statusCategory];
    case 'assignee':
      return [task.assigneeId ?? NO_GROUP];
    case 'priority':
      return [task.priority];
    case 'section':
      return [task.sectionId ?? NO_GROUP];
    case 'milestone':
      return [task.milestoneId ?? NO_GROUP];
    case 'project':
      return [task.projectId];
    case 'label':
      return task.labelIds.length > 0 ? [...task.labelIds] : [NO_GROUP];
    case 'dueDate':
      return [task.dueDate ?? NO_GROUP];
    case 'custom': {
      const raw = fieldId ? task.customFields[fieldId] : undefined;
      if (Array.isArray(raw)) return raw.length ? raw.map(String) : [NO_GROUP];
      return raw === undefined || raw === null || raw === '' ? [NO_GROUP] : [String(raw)];
    }
  }
}

/**
 * Groups tasks preserving input order inside each group. `order` fixes group order (e.g. the
 * project's status positions); unknown keys follow in first-seen order, `__none__` last.
 */
export function groupTasks(
  tasks: readonly TaskSummary[],
  field: GroupField,
  options: { readonly order?: readonly string[]; readonly fieldId?: string; readonly includeEmpty?: boolean } = {},
): TaskGroup[] {
  const buckets = new Map<string, TaskSummary[]>();
  if (options.includeEmpty && options.order) for (const key of options.order) buckets.set(key, []);
  for (const task of tasks) {
    for (const key of groupKeys(task, field, options.fieldId)) {
      const list = buckets.get(key);
      if (list) list.push(task);
      else buckets.set(key, [task]);
    }
  }
  const order = options.order ?? [];
  const keys = [...buckets.keys()].sort((a, b) => {
    if (a === NO_GROUP) return 1;
    if (b === NO_GROUP) return -1;
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return keys.map((key) => ({ key, tasks: buckets.get(key) ?? [] }));
}
