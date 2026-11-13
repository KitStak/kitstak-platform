/**
 * Saved view configuration (pm.saved_views.config) and the filter model used by every view,
 * My Work and dashboards. Pure types; evaluation lives in src/lib/task-filters.ts.
 */
import type { ViewType } from './constants';

/** Task fields a filter, sort or group can target. `custom` uses `fieldId`. */
export type TaskFilterField =
  | 'status'
  | 'statusCategory'
  | 'assignee'
  | 'priority'
  | 'label'
  | 'dueDate'
  | 'startDate'
  | 'createdAt'
  | 'completedAt'
  | 'milestone'
  | 'section'
  | 'project'
  | 'reporter'
  | 'title'
  | 'isSubtask'
  | 'custom';

export type FilterOperator =
  | 'is'
  | 'is_not'
  | 'in'
  | 'not_in'
  | 'empty'
  | 'not_empty'
  | 'contains'
  | 'not_contains'
  | 'before'
  | 'after'
  | 'on'
  | 'between'
  | 'overdue'
  | 'today'
  | 'this_week'
  | 'next_7_days'
  | 'gt'
  | 'lt';

export interface FilterCondition {
  readonly field: TaskFilterField;
  readonly op: FilterOperator;
  /** Scalar, array (in/not_in) or `[from, to]` (between). `'me'` resolves to the viewer for people fields. */
  readonly value?: unknown;
  /** pm.custom_fields.id when field = 'custom'. */
  readonly fieldId?: string;
}

export interface FilterGroup {
  readonly match: 'all' | 'any';
  readonly conditions: readonly FilterCondition[];
}

export type SortField = Exclude<TaskFilterField, 'isSubtask' | 'label'> | 'position' | 'number' | 'updatedAt';

export interface SortRule {
  readonly field: SortField;
  readonly dir: 'asc' | 'desc';
  readonly fieldId?: string;
}

export type GroupField = 'status' | 'statusCategory' | 'assignee' | 'priority' | 'section' | 'milestone' | 'label' | 'dueDate' | 'project' | 'custom' | 'none';

export interface ViewColumn {
  /** Built-in key (title, status, assignee, priority, dueDate, startDate, labels, estimate, …) or `custom:<fieldId>`. */
  readonly key: string;
  readonly width?: number;
  readonly hidden?: boolean;
}

export interface ViewConfig {
  readonly filters?: FilterGroup;
  readonly sort?: readonly SortRule[];
  readonly groupBy?: GroupField;
  readonly groupFieldId?: string;
  /** Board swimlanes. */
  readonly swimlane?: 'none' | 'assignee' | 'priority' | 'section' | 'milestone' | 'label';
  readonly columns?: readonly ViewColumn[];
  readonly showSubtasks?: boolean;
  readonly showCompleted?: boolean;
  /** Timeline zoom. */
  readonly zoom?: 'day' | 'week' | 'month' | 'quarter';
  /** Calendar mode. */
  readonly calendarMode?: 'month' | 'week';
  /** Which date the calendar plots. */
  readonly dateField?: 'dueDate' | 'startDate';
  /** Board/list card density. */
  readonly density?: 'compact' | 'comfortable';
  /** Workload capacity per person per week (points or hours). */
  readonly capacity?: { readonly unit: 'tasks' | 'points' | 'hours'; readonly perWeek: number };
  readonly [key: string]: unknown;
}

export const EMPTY_FILTERS: FilterGroup = { match: 'all', conditions: [] };

/** Sensible defaults per view type (used when a project has no saved view yet). */
export function defaultViewConfig(type: ViewType): ViewConfig {
  switch (type) {
    case 'board':
      return { filters: EMPTY_FILTERS, swimlane: 'none', showSubtasks: false, showCompleted: true, density: 'comfortable' };
    case 'list':
      return { filters: EMPTY_FILTERS, groupBy: 'section', showSubtasks: true, showCompleted: true };
    case 'table':
      return {
        filters: EMPTY_FILTERS,
        sort: [{ field: 'number', dir: 'asc' }],
        groupBy: 'none',
        columns: [
          { key: 'title', width: 360 },
          { key: 'status', width: 140 },
          { key: 'assignee', width: 160 },
          { key: 'priority', width: 120 },
          { key: 'dueDate', width: 130 },
          { key: 'labels', width: 180 },
          { key: 'estimate', width: 100 },
        ],
        showSubtasks: false,
        showCompleted: true,
      };
    case 'timeline':
      return { filters: EMPTY_FILTERS, zoom: 'week', groupBy: 'section', showCompleted: true };
    case 'calendar':
      return { filters: EMPTY_FILTERS, calendarMode: 'month', dateField: 'dueDate', showCompleted: true };
    case 'workload':
      return { filters: EMPTY_FILTERS, capacity: { unit: 'tasks', perWeek: 8 }, showCompleted: false };
  }
}
