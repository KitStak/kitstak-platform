'use client';
/**
 * Table column catalog: built-in task fields plus every custom field of the project, with how
 * each one displays, sorts, groups, edits and sums. Pure-ish (React nodes, no hooks).
 */
import type { ReactNode } from 'react';
import { AlignLeft, Calendar, CalendarClock, CheckSquare, CircleDashed, Clock, DollarSign, FolderOpen, Hash, Link2, ListChecks, Signal, Tag, ToggleLeft, UserRound, Users } from 'lucide-react';
import { DueDate, LabelPill, PersonAvatar, PriorityIcon, StatusIcon } from '@/components/pm';
import { PRIORITY_LABELS } from '@/lib/constants';
import { formatRelative, parseIsoDate } from '@/lib/dates';
import { NO_GROUP } from '@/lib/task-filters';
import type { CustomFieldDTO, IntegrationLinkDTO, LabelDTO, SectionDTO, StatusDTO, TaskSummary } from '@/lib/types';
import type { GroupField, SortRule, ViewColumn } from '@/lib/view-config';
import { LabelDot } from '@/features/views/field-pickers';
import { LinkChips } from '@/features/views/link-chips';

export type EditorKind = 'title' | 'status' | 'priority' | 'assignee' | 'date' | 'labels' | 'section' | 'number' | 'text' | 'checkbox' | 'select' | 'multiselect' | 'person' | 'readonly';

export interface ColumnDef {
  readonly key: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly defaultWidth: number;
  readonly minWidth: number;
  readonly align?: 'left' | 'right' | 'center';
  readonly sort?: SortRule;
  readonly group?: { readonly field: GroupField; readonly fieldId?: string };
  readonly editor: EditorKind;
  /** Custom field behind this column. */
  readonly field?: CustomFieldDTO;
  /** Built-in date field the date editor writes. */
  readonly dateField?: 'dueDate' | 'startDate';
  readonly sum?: (tasks: readonly TaskSummary[]) => string | null;
}

export interface RenderContext {
  readonly statusById: ReadonlyMap<string, StatusDTO>;
  readonly labelById: ReadonlyMap<string, LabelDTO>;
  readonly sectionById: ReadonlyMap<string, SectionDTO>;
  readonly links: ReadonlyMap<string, readonly IntegrationLinkDTO[]>;
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function formatNumber(value: number, field?: CustomFieldDTO): string {
  const precision = typeof field?.config.precision === 'number' ? field.config.precision : undefined;
  if (field?.type === 'currency') {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: field.config.currency || 'USD', maximumFractionDigits: precision ?? 2 }).format(value);
    } catch {
      return value.toFixed(precision ?? 2);
    }
  }
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: precision ?? 2 }).format(value);
}

function sumOf(tasks: readonly TaskSummary[], read: (task: TaskSummary) => unknown): number | null {
  let total = 0;
  let any = false;
  for (const task of tasks) {
    const value = read(task);
    if (typeof value === 'number' && Number.isFinite(value)) {
      total += value;
      any = true;
    }
  }
  return any ? total : null;
}

const CUSTOM_ICONS: Readonly<Record<CustomFieldDTO['type'], ReactNode>> = {
  text: <AlignLeft aria-hidden />,
  number: <Hash aria-hidden />,
  select: <CircleDashed aria-hidden />,
  multiselect: <ListChecks aria-hidden />,
  date: <Calendar aria-hidden />,
  person: <UserRound aria-hidden />,
  checkbox: <ToggleLeft aria-hidden />,
  currency: <DollarSign aria-hidden />,
  url: <Link2 aria-hidden />,
};

export const TITLE_KEY = 'title';
export const KEY_KEY = 'key';

/** Every column available for this project, in default order. */
export function buildColumns(customFields: readonly CustomFieldDTO[]): ColumnDef[] {
  const builtIn: ColumnDef[] = [
    { key: TITLE_KEY, label: 'Task', icon: <AlignLeft aria-hidden />, defaultWidth: 360, minWidth: 200, sort: { field: 'title', dir: 'asc' }, editor: 'title' },
    { key: 'status', label: 'Status', icon: <CircleDashed aria-hidden />, defaultWidth: 150, minWidth: 110, sort: { field: 'status', dir: 'asc' }, group: { field: 'status' }, editor: 'status' },
    { key: 'assignee', label: 'Assignee', icon: <Users aria-hidden />, defaultWidth: 170, minWidth: 120, sort: { field: 'assignee', dir: 'asc' }, group: { field: 'assignee' }, editor: 'assignee' },
    { key: 'priority', label: 'Priority', icon: <Signal aria-hidden />, defaultWidth: 130, minWidth: 100, sort: { field: 'priority', dir: 'asc' }, group: { field: 'priority' }, editor: 'priority' },
    { key: 'dueDate', label: 'Due date', icon: <CalendarClock aria-hidden />, defaultWidth: 130, minWidth: 100, sort: { field: 'dueDate', dir: 'asc' }, editor: 'date', dateField: 'dueDate' },
    { key: 'startDate', label: 'Start date', icon: <Calendar aria-hidden />, defaultWidth: 130, minWidth: 100, sort: { field: 'startDate', dir: 'asc' }, editor: 'date', dateField: 'startDate' },
    { key: 'labels', label: 'Labels', icon: <Tag aria-hidden />, defaultWidth: 200, minWidth: 110, group: { field: 'label' }, editor: 'labels' },
    {
      key: 'estimate',
      label: 'Points',
      icon: <Hash aria-hidden />,
      defaultWidth: 100,
      minWidth: 80,
      align: 'right',
      editor: 'number',
      sum: (tasks) => {
        const total = sumOf(tasks, (task) => task.estimatePoints);
        return total === null ? null : `${formatNumber(total)} pts`;
      },
    },
    { key: 'section', label: 'Section', icon: <FolderOpen aria-hidden />, defaultWidth: 150, minWidth: 110, sort: { field: 'section', dir: 'asc' }, group: { field: 'section' }, editor: 'section' },
    { key: 'subtasks', label: 'Subtasks', icon: <CheckSquare aria-hidden />, defaultWidth: 120, minWidth: 90, editor: 'readonly' },
    { key: 'links', label: 'CRM / WMS', icon: <Link2 aria-hidden />, defaultWidth: 200, minWidth: 120, editor: 'readonly' },
    { key: 'createdAt', label: 'Created', icon: <Clock aria-hidden />, defaultWidth: 130, minWidth: 100, sort: { field: 'createdAt', dir: 'desc' }, editor: 'readonly' },
    { key: 'updatedAt', label: 'Updated', icon: <Clock aria-hidden />, defaultWidth: 130, minWidth: 100, sort: { field: 'updatedAt', dir: 'desc' }, editor: 'readonly' },
  ];
  const custom: ColumnDef[] = customFields.map((field) => {
    const numeric = field.type === 'number' || field.type === 'currency';
    const editor: EditorKind =
      field.type === 'select' ? 'select' : field.type === 'multiselect' ? 'multiselect' : field.type === 'person' ? 'person' : field.type === 'date' ? 'date' : field.type === 'checkbox' ? 'checkbox' : numeric ? 'number' : 'text';
    return {
      key: `custom:${field.id}`,
      label: field.name,
      icon: CUSTOM_ICONS[field.type],
      defaultWidth: field.type === 'checkbox' ? 110 : numeric ? 130 : field.type === 'url' || field.type === 'text' ? 200 : 160,
      minWidth: 80,
      align: numeric ? 'right' : field.type === 'checkbox' ? 'center' : 'left',
      sort: field.type === 'multiselect' ? undefined : { field: 'custom', fieldId: field.id, dir: 'asc' },
      group: field.type === 'select' ? { field: 'custom', fieldId: field.id } : undefined,
      editor,
      field,
      sum: numeric
        ? (tasks) => {
            const total = sumOf(tasks, (task) => task.customFields[field.id]);
            return total === null ? null : formatNumber(total, field);
          }
        : undefined,
    };
  });
  return [...builtIn, ...custom];
}

/** The default visible set (others start hidden but can be turned on). */
const DEFAULT_VISIBLE = new Set([TITLE_KEY, 'status', 'assignee', 'priority', 'dueDate', 'labels', 'estimate']);

/**
 * The view's column layout merged with what exists: saved order first, then any new columns
 * (hidden unless they are default ones). Unknown keys (deleted custom fields) are dropped.
 */
export function resolveColumns(defs: readonly ColumnDef[], saved: readonly ViewColumn[]): ViewColumn[] {
  const byKey = new Map(defs.map((def) => [def.key, def]));
  const out: ViewColumn[] = [];
  const seen = new Set<string>();
  for (const column of saved) {
    if (!byKey.has(column.key) || seen.has(column.key)) continue;
    seen.add(column.key);
    out.push(column.key === TITLE_KEY ? { ...column, hidden: false } : column);
  }
  let customShown = 0;
  for (const def of defs) {
    if (seen.has(def.key)) continue;
    // Fresh tables show the first few custom fields too; columns added later start hidden.
    const visible = saved.length === 0 && (DEFAULT_VISIBLE.has(def.key) || (def.field !== undefined && customShown++ < 4));
    out.push({ key: def.key, width: def.defaultWidth, hidden: !visible });
  }
  // The task name always comes first.
  const titleIndex = out.findIndex((column) => column.key === TITLE_KEY);
  if (titleIndex > 0) out.unshift(...out.splice(titleIndex, 1));
  return out;
}

function customValue(task: TaskSummary, field: CustomFieldDTO): unknown {
  const value = task.customFields[field.id];
  return value === undefined || value === '' ? null : value;
}

/** Plain-text value (for search-free display checks and aria labels). */
export function cellText(def: ColumnDef, task: TaskSummary, ctx: RenderContext): string {
  switch (def.key) {
    case TITLE_KEY:
      return task.title;
    case 'status':
      return ctx.statusById.get(task.statusId)?.name ?? '';
    case 'priority':
      return PRIORITY_LABELS[task.priority];
    case 'dueDate':
      return task.dueDate ?? '';
    case 'startDate':
      return task.startDate ?? '';
    case 'estimate':
      return task.estimatePoints === null ? '' : String(task.estimatePoints);
    default:
      if (def.field) {
        const value = customValue(task, def.field);
        return value === null ? '' : String(value);
      }
      return '';
  }
}

export function renderCell(def: ColumnDef, task: TaskSummary, ctx: RenderContext): ReactNode {
  const done = task.statusCategory === 'done' || task.statusCategory === 'cancelled';
  switch (def.key) {
    case 'status': {
      const status = ctx.statusById.get(task.statusId);
      return (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <StatusIcon category={task.statusCategory} color={status?.color} />
          <span className="truncate">{status?.name}</span>
        </span>
      );
    }
    case 'assignee':
      return <PersonAvatar userId={task.assigneeId} size="xs" showName />;
    case 'priority':
      return (
        <span className={`inline-flex min-w-0 items-center gap-1.5 ${task.priority === 'none' ? 'text-fg-muted' : ''}`}>
          <PriorityIcon priority={task.priority} />
          <span className="truncate">{PRIORITY_LABELS[task.priority]}</span>
        </span>
      );
    case 'dueDate':
      return task.dueDate ? <DueDate date={task.dueDate} done={done} /> : null;
    case 'startDate':
      return task.startDate ? <span className="text-sm text-fg-secondary tabular-nums">{DATE_FORMAT.format(parseIsoDate(task.startDate))}</span> : null;
    case 'labels':
      return task.labelIds.length ? (
        <span className="flex min-w-0 items-center gap-1 overflow-hidden">
          {task.labelIds.map((id) => {
            const label = ctx.labelById.get(id);
            return label ? <LabelPill key={id} name={label.name} color={label.color} /> : null;
          })}
        </span>
      ) : null;
    case 'estimate':
      return task.estimatePoints === null ? null : <span className="tabular-nums">{task.estimatePoints}</span>;
    case 'section':
      return task.sectionId ? <span className="truncate">{ctx.sectionById.get(task.sectionId)?.name ?? ''}</span> : <span className="text-fg-muted">No section</span>;
    case 'subtasks':
      return task.subtaskCount ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-fg-secondary tabular-nums">
          <span aria-hidden className="h-1.5 w-12 overflow-hidden rounded-full bg-[var(--border-subtle)]">
            <span className={`block h-full rounded-full ${task.subtaskDoneCount === task.subtaskCount ? 'bg-success' : 'bg-primary'}`} style={{ width: `${Math.round((task.subtaskDoneCount / task.subtaskCount) * 100)}%` }} />
          </span>
          {task.subtaskDoneCount}/{task.subtaskCount}
        </span>
      ) : null;
    case 'links':
      return <LinkChips links={ctx.links.get(task.id)} max={2} />;
    case 'createdAt':
      return <span className="text-xs text-fg-secondary">{formatRelative(task.createdAt)}</span>;
    case 'updatedAt':
      return <span className="text-xs text-fg-secondary">{formatRelative(task.updatedAt)}</span>;
    default:
      break;
  }
  const field = def.field;
  if (!field) return null;
  const value = customValue(task, field);
  switch (field.type) {
    case 'number':
    case 'currency':
      return typeof value === 'number' ? <span className="tabular-nums">{formatNumber(value, field)}</span> : null;
    case 'date':
      return typeof value === 'string' && value ? <span className="tabular-nums">{DATE_FORMAT.format(parseIsoDate(value))}</span> : null;
    case 'checkbox':
      return null;
    case 'url':
      if (typeof value !== 'string' || !value) return null;
      return (
        <a href={value} target="_blank" rel="noopener noreferrer" className="truncate text-fg-link hover:underline" onClick={(event) => event.stopPropagation()}>
          {value.replace(/^https?:\/\//, '').replace(/\/$/, '')}
        </a>
      );
    case 'person':
      return typeof value === 'string' ? <PersonAvatar userId={value} size="xs" showName /> : null;
    case 'select': {
      const option = field.config.options?.find((entry) => entry.id === value);
      return option ? <LabelPill name={option.label} color={option.color} /> : null;
    }
    case 'multiselect': {
      const ids = Array.isArray(value) ? value.map(String) : [];
      return ids.length ? (
        <span className="flex min-w-0 items-center gap-1 overflow-hidden">
          {ids.map((id) => {
            const option = field.config.options?.find((entry) => entry.id === id);
            return option ? <LabelPill key={id} name={option.label} color={option.color} /> : null;
          })}
        </span>
      ) : null;
    }
    default:
      return typeof value === 'string' ? <span className="truncate">{value}</span> : null;
  }
}

/** Option list for select/multiselect custom fields (icon = color dot). */
export function fieldOptions(field: CustomFieldDTO) {
  return (field.config.options ?? []).map((option) => ({ value: option.id, label: option.label, icon: <LabelDot color={option.color} /> }));
}

/** Plain value for CSV export (what a spreadsheet should show). */
export function csvValue(def: ColumnDef, task: TaskSummary, ctx: RenderContext, personName: (id: string) => string): string {
  switch (def.key) {
    case TITLE_KEY:
      return task.title;
    case 'status':
      return ctx.statusById.get(task.statusId)?.name ?? '';
    case 'assignee':
      return task.assigneeId ? personName(task.assigneeId) : '';
    case 'priority':
      return task.priority === 'none' ? '' : PRIORITY_LABELS[task.priority];
    case 'dueDate':
      return task.dueDate ?? '';
    case 'startDate':
      return task.startDate ?? '';
    case 'labels':
      return task.labelIds.map((id) => ctx.labelById.get(id)?.name ?? '').filter(Boolean).join('; ');
    case 'estimate':
      return task.estimatePoints === null ? '' : String(task.estimatePoints);
    case 'section':
      return task.sectionId ? (ctx.sectionById.get(task.sectionId)?.name ?? '') : '';
    case 'subtasks':
      return task.subtaskCount ? `${task.subtaskDoneCount}/${task.subtaskCount}` : '';
    case 'links':
      return (ctx.links.get(task.id) ?? []).map((link) => link.title ?? '').filter(Boolean).join('; ');
    case 'createdAt':
      return task.createdAt.slice(0, 10);
    case 'updatedAt':
      return task.updatedAt.slice(0, 10);
    default:
      break;
  }
  const field = def.field;
  if (!field) return '';
  const value = customValue(task, field);
  if (value === null) return '';
  switch (field.type) {
    case 'checkbox':
      return value === true ? 'Yes' : 'No';
    case 'person':
      return typeof value === 'string' ? personName(value) : '';
    case 'select':
      return field.config.options?.find((option) => option.id === value)?.label ?? '';
    case 'multiselect':
      return (Array.isArray(value) ? value : []).map((id) => field.config.options?.find((option) => option.id === id)?.label ?? '').filter(Boolean).join('; ');
    default:
      return String(value);
  }
}

/** RFC 4180 CSV with a BOM so Excel opens accented names correctly. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  const formula = (value: string) => /^[=+\-@]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value);
  const escape = (value: string) => (/[",\n\r]/.test(value) || formula(value) ? `"${(formula(value) ? `'${value}` : value).replace(/"/g, '""')}"` : value);
  return `\uFEFF${rows.map((row) => row.map(escape).join(',')).join('\r\n')}`;
}

export { NO_GROUP };
