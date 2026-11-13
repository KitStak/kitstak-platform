/**
 * Flattens a project's tasks into the Timeline's row list: group headers, a task tree (subtasks
 * nested under their parent) and an "add" row per group for drag-to-create. Pure, so it can be
 * tested and memoized.
 */
import { toLabelColor, type LabelColor } from '@/components/ui/label-color';
import { compareRank } from '@/lib/rank';
import type { SectionDTO, StatusDTO, TaskSummary } from '@/lib/types';
import type { Span } from './timeline-model';

export type TimelineGroupBy = 'section' | 'status' | 'assignee' | 'none';

export interface TimelineGroup {
  readonly id: string;
  readonly title: string;
  readonly color: LabelColor;
  /** Fields a task created in this group starts with. */
  readonly defaults: { readonly sectionId?: string | null; readonly statusId?: string; readonly assigneeId?: string | null };
}

export type TimelineRow =
  | { readonly kind: 'milestones'; readonly key: string }
  | { readonly kind: 'group'; readonly key: string; readonly group: TimelineGroup; readonly count: number; readonly subtasks: number; readonly summary: Span | null; readonly collapsed: boolean }
  | {
      readonly kind: 'task';
      readonly key: string;
      readonly task: TaskSummary;
      readonly depth: number;
      readonly hasChildren: boolean;
      readonly collapsed: boolean;
      readonly group: TimelineGroup;
    }
  | { readonly kind: 'add'; readonly key: string; readonly group: TimelineGroup };

export interface BuildRowsInput {
  readonly tasks: readonly TaskSummary[];
  readonly spans: ReadonlyMap<string, Span>;
  readonly groupBy: TimelineGroupBy;
  readonly statuses: readonly StatusDTO[];
  readonly sections: readonly SectionDTO[];
  readonly personName: (userId: string) => string;
  /** `g:<groupId>` and `t:<taskId>` keys that are folded. */
  readonly collapsed: ReadonlySet<string>;
  readonly milestonesRow: boolean;
  readonly canCreate: boolean;
}

const ALL: TimelineGroup = { id: 'all', title: 'All tasks', color: 'gray', defaults: {} };

function groupsFor(input: BuildRowsInput): { groups: TimelineGroup[]; keyOf: (task: TaskSummary) => string } {
  const { groupBy, tasks } = input;
  if (groupBy === 'section' && input.sections.length > 0) {
    const groups: TimelineGroup[] = [...input.sections]
      .sort((a, b) => compareRank(a.position, b.position))
      .map((section) => ({ id: section.id, title: section.name, color: 'gray', defaults: { sectionId: section.id } }));
    if (tasks.some((task) => !task.sectionId || !input.sections.some((s) => s.id === task.sectionId))) {
      groups.push({ id: 'none', title: 'No section', color: 'gray', defaults: { sectionId: null } });
    }
    const known = new Set(input.sections.map((s) => s.id));
    return { groups, keyOf: (task) => (task.sectionId && known.has(task.sectionId) ? task.sectionId : 'none') };
  }
  if (groupBy === 'status') {
    const groups: TimelineGroup[] = [...input.statuses]
      .sort((a, b) => compareRank(a.position, b.position))
      .map((status) => ({ id: status.id, title: status.name, color: toLabelColor(status.color, 'blue'), defaults: { statusId: status.id } }));
    return { groups, keyOf: (task) => task.statusId };
  }
  if (groupBy === 'assignee') {
    const ids = [...new Set(tasks.map((task) => task.assigneeId).filter((id): id is string => Boolean(id)))];
    const groups: TimelineGroup[] = ids
      .map((id) => ({ id, title: input.personName(id), color: 'indigo' as LabelColor, defaults: { assigneeId: id } }))
      .sort((a, b) => a.title.localeCompare(b.title));
    groups.push({ id: 'none', title: 'Unassigned', color: 'gray', defaults: { assigneeId: null } });
    return { groups, keyOf: (task) => task.assigneeId ?? 'none' };
  }
  return { groups: [ALL], keyOf: () => ALL.id };
}

export function buildTimelineRows(input: BuildRowsInput): TimelineRow[] {
  const { tasks, spans, collapsed } = input;
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const children = new Map<string, TaskSummary[]>();
  for (const task of tasks) {
    if (task.parentTaskId && byId.has(task.parentTaskId)) children.set(task.parentTaskId, [...(children.get(task.parentTaskId) ?? []), task]);
  }
  // A task gets a row when it has dates, or when one of its subtasks does (so the tree stays whole).
  const included = new Map<string, boolean>();
  const isIncluded = (task: TaskSummary): boolean => {
    const known = included.get(task.id);
    if (known !== undefined) return known;
    included.set(task.id, false);
    const result = spans.has(task.id) || (children.get(task.id) ?? []).some(isIncluded);
    included.set(task.id, result);
    return result;
  };

  const { groups, keyOf } = groupsFor(input);
  const roots = new Map<string, TaskSummary[]>();
  for (const task of tasks) {
    if (!isIncluded(task)) continue;
    if (task.parentTaskId && byId.has(task.parentTaskId) && isIncluded(byId.get(task.parentTaskId) as TaskSummary)) continue;
    const key = keyOf(task);
    roots.set(key, [...(roots.get(key) ?? []), task]);
  }

  const rows: TimelineRow[] = [];
  if (input.milestonesRow) rows.push({ kind: 'milestones', key: 'milestones' });
  const grouped = input.groupBy !== 'none' && groups.length > 0 && groups[0] !== ALL;

  for (const group of groups) {
    const list = (roots.get(group.id) ?? []).sort((a, b) => compareRank(a.position, b.position));
    // Empty real groups stay (you can drag-create into them); empty catch-all groups don't.
    if (grouped && list.length === 0 && (!input.canCreate || group.id === 'none')) continue;
    const groupCollapsed = grouped && collapsed.has(`g:${group.id}`);
    const body: TimelineRow[] = [];
    // `count` is top-level tasks only, the same rule as List; subtasks are counted on their own.
    let count = 0;
    let subtasks = 0;
    let summary: Span | null = null;
    const visit = (task: TaskSummary, depth: number, hidden: boolean) => {
      if (depth === 0) count += 1;
      else subtasks += 1;
      const span = spans.get(task.id);
      if (span) summary = summary ? { start: span.start < summary.start ? span.start : summary.start, end: span.end > summary.end ? span.end : summary.end } : span;
      const kids = (children.get(task.id) ?? []).filter(isIncluded).sort((a, b) => compareRank(a.position, b.position));
      const folded = collapsed.has(`t:${task.id}`);
      if (!hidden) body.push({ kind: 'task', key: `t:${task.id}`, task, depth, hasChildren: kids.length > 0, collapsed: folded, group });
      for (const kid of kids) visit(kid, depth + 1, hidden || folded);
    };
    for (const task of list) visit(task, 0, groupCollapsed);
    if (grouped) rows.push({ kind: 'group', key: `g:${group.id}`, group, count, subtasks, summary, collapsed: groupCollapsed });
    if (!groupCollapsed) {
      rows.push(...body);
      if (input.canCreate) rows.push({ kind: 'add', key: `a:${group.id}`, group });
    }
  }
  return rows;
}
