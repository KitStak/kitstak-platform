'use client';
/**
 * Table column catalog: built-in task fields plus every custom field of the project, with how
 * each one displays, sorts, groups, edits and sums. Pure-ish (React nodes, no hooks).
 */
import type { ReactNode } from 'react';
import { AlignLeft, Building2, Calendar, CalendarClock, CheckSquare, CircleDashed, Clock, DollarSign, FolderOpen, Hash, Link2, ListChecks, Signal, Tag, ToggleLeft, UserRound, Users } from 'lucide-react';
import { DueDate, LabelPill, PersonAvatar, PriorityIcon, StatusIcon } from '@/components/pm';
import { PRIORITY_LABELS } from '@/lib/constants';
import { formatMinutes, formatRelative, parseIsoDate } from '@/lib/dates';
import { NO_GROUP } from '@/lib/task-filters';
import type { CustomFieldDTO, IntegrationLinkDTO, LabelDTO, SectionDTO, StatusDTO, TaskSummary } from '@/lib/types';
import type { GroupField, SortRule, ViewColumn } from '@/lib/view-config';
import { LabelDot } from '@/features/views/field-pickers';
import { LinkChip, cleanTitle } from '@/features/views/link-chips';
import { CollapsingRow } from '@/features/list/collapsing-row';
import { Repeat2, Timer } from 'lucide-react';

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
  /** Cycle name per task id ("Cycle 4"), when the project runs cycles. */
  readonly cycleByTask?: ReadonlyMap<string, string>;
  /** The project's own customer link (CRM account or KitStak customer), the fallback for the Customer column. */
  readonly projectCustomer?: IntegrationLinkDTO | null;
  /** Narrow screens: Assignee shows the avatar only and Priority the icon only (names in tooltips). */
  readonly compact?: boolean;
}

/**
 * Automatic widths for columns nobody has dragged: Assignee is an avatar plus first name and
 * Priority an icon plus word, so the Task column keeps the room.
 */
export const FIT_WIDTHS: Readonly<Record<string, number>> = { assignee: 132, priority: 112, status: 140, dueDate: 120, startDate: 120, labels: 180 };

/** Widths used for the compact Assignee and Priority columns (when the user has not resized them). */
export const COMPACT_WIDTHS: Readonly<Record<string, number>> = { assignee: 64, priority: 64, status: 132, dueDate: 112, startDate: 112 };

/** The narrowest an automatic column gets when the table has to make room for the Task column. */
export const FIT_FLOORS: Readonly<Record<string, number>> = { status: 128, dueDate: 108, startDate: 108, labels: 120, estimate: 84, estimateTime: 92, customer: 124, links: 124 };

export interface FitColumn {
  readonly key: string;
  /** Automatic (or dragged) width. */
  readonly natural: number;
  /** Narrowest automatic width; equal to natural for dragged columns. */
  readonly floor: number;
  /** Width when the grid goes compact (Assignee as avatar, Priority as icon); omit when it does not change. */
  readonly compact?: number;
}

export interface FitResult {
  readonly widths: ReadonlyMap<string, number>;
  readonly titleWidth: number;
  /** True when Assignee and Priority had to go compact to leave the Task column its room. */
  readonly compact: boolean;
}

/**
 * Fits the columns to the grid with the Task column as the flexible one: it gets the room it
 * needs (`titleTarget`, the longest title) first, the other automatic columns shrink toward their
 * floors to make that room, then Assignee and Priority go compact, and only then does the table
 * scroll sideways (Task never under `titleMin`). Spare room beyond the Task target is returned
 * implicitly: callers put it after the last column.
 */
export function fitColumns(columns: readonly FitColumn[], available: number, titleTarget: number, titleMin: number): FitResult {
  const attempt = (compact: boolean) => {
    const base = columns.map((column) => {
      const natural = compact && column.compact !== undefined ? Math.min(column.natural, column.compact) : column.natural;
      return { key: column.key, natural, floor: Math.min(natural, column.floor) };
    });
    const natural = base.reduce((sum, column) => sum + column.natural, 0);
    const deficit = titleTarget - (available - natural);
    const widths = new Map<string, number>();
    if (deficit <= 0) {
      for (const column of base) widths.set(column.key, column.natural);
      return { widths, titleWidth: Math.max(titleMin, available - natural), short: 0 };
    }
    const room = base.reduce((sum, column) => sum + column.natural - column.floor, 0);
    const ratio = room > 0 ? Math.min(1, deficit / room) : 0;
    let used = 0;
    for (const column of base) {
      const width = Math.round(column.natural - (column.natural - column.floor) * ratio);
      widths.set(column.key, width);
      used += width;
    }
    const titleWidth = Math.max(titleMin, available - used);
    return { widths, titleWidth, short: Math.max(0, titleTarget - (available - used)) };
  };
  const relaxed = attempt(false);
  if (relaxed.short === 0 || !columns.some((column) => column.compact !== undefined && column.compact < column.natural)) return { widths: relaxed.widths, titleWidth: relaxed.titleWidth, compact: false };
  const tight = attempt(true);
  return { widths: tight.widths, titleWidth: tight.titleWidth, compact: true };
}

const CUSTOMER_TYPES = new Set(['core_customer', 'crm_account']);

/** The task's customer: its own customer link, else the project's customer. */
export function customerOf(task: TaskSummary, ctx: RenderContext): { readonly link: IntegrationLinkDTO; readonly inherited: boolean } | null {
  const own = ctx.links.get(task.id)?.find((link) => CUSTOMER_TYPES.has(link.targetType));
  if (own) return { link: own, inherited: false };
  return ctx.projectCustomer ? { link: ctx.projectCustomer, inherited: true } : null;
}

export function isCustomerLink(link: IntegrationLinkDTO): boolean {
  return CUSTOMER_TYPES.has(link.targetType);
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
    {
      key: 'estimateTime',
      label: 'Time estimate',
      icon: <Timer aria-hidden />,
      defaultWidth: 130,
      minWidth: 90,
      align: 'right',
      editor: 'readonly',
      sum: (tasks) => {
        const total = sumOf(tasks, (task) => task.estimateMinutes);
        return total === null ? null : formatMinutes(total);
      },
    },
    { key: 'cycle', label: 'Cycle', icon: <Repeat2 aria-hidden />, defaultWidth: 130, minWidth: 90, editor: 'readonly' },
    { key: 'section', label: 'Section', icon: <FolderOpen aria-hidden />, defaultWidth: 150, minWidth: 110, sort: { field: 'section', dir: 'asc' }, group: { field: 'section' }, editor: 'section' },
    { key: 'subtasks', label: 'Subtasks', icon: <CheckSquare aria-hidden />, defaultWidth: 120, minWidth: 90, editor: 'readonly' },
    { key: 'links', label: 'Linked to', icon: <Link2 aria-hidden />, defaultWidth: 200, minWidth: 120, editor: 'readonly' },
    { key: 'customer', label: 'Customer', icon: <Building2 aria-hidden />, defaultWidth: 180, minWidth: 110, editor: 'readonly' },
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
const DEFAULT_VISIBLE = new Set([TITLE_KEY, 'status', 'assignee', 'priority', 'dueDate', 'labels', 'estimate', 'links', 'customer']);
/** Built-in columns added after launch: shown even in tables saved before they existed. */
const LATER_DEFAULTS = new Set(['customer']);

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
    // Built-in columns introduced after a view was saved (Customer) show up too, so nobody misses them.
    const visible = saved.length === 0 ? DEFAULT_VISIBLE.has(def.key) || (def.field !== undefined && customShown++ < 4) : LATER_DEFAULTS.has(def.key);
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
    case 'estimateTime':
      return task.estimateMinutes === null ? '' : formatMinutes(task.estimateMinutes);
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
      return <PersonAvatar userId={task.assigneeId} size={ctx.compact ? 'sm' : 'xs'} showName={!ctx.compact} firstNameOnly />;
    case 'priority':
      if (ctx.compact)
        return (
          <span className={`inline-flex items-center ${task.priority === 'none' ? 'text-fg-muted' : ''}`} title={PRIORITY_LABELS[task.priority]}>
            <PriorityIcon priority={task.priority} />
            <span className="sr-only">{PRIORITY_LABELS[task.priority]}</span>
          </span>
        );
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
    case 'labels': {
      const labels = task.labelIds.map((id) => ctx.labelById.get(id)).filter((label): label is LabelDTO => Boolean(label));
      return labels.length ? (
        <CollapsingRow names={labels.map((label) => label.name)}>
          {labels.map((label) => (
            <LabelPill key={label.id} name={label.name} color={label.color} className="max-w-none" />
          ))}
        </CollapsingRow>
      ) : null;
    }
    case 'estimate':
      return task.estimatePoints === null ? null : <span className="tabular-nums">{task.estimatePoints}</span>;
    case 'estimateTime':
      return task.estimateMinutes === null ? null : <span className="tabular-nums">{formatMinutes(task.estimateMinutes)}</span>;
    case 'cycle': {
      const cycle = ctx.cycleByTask?.get(task.id);
      return cycle ? <span className="truncate text-fg-secondary">{cycle}</span> : null;
    }
    case 'section':
      return task.sectionId ? <span className="truncate">{ctx.sectionById.get(task.sectionId)?.name ?? ''}</span> : <span className="text-fg-muted">No section</span>;
    case 'subtasks':
      return task.subtaskCount ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-fg-secondary tabular-nums">
          <span aria-hidden className="h-1.5 w-12 overflow-hidden rounded-full bg-[var(--border-subtle)]">
            <span className="block h-full rounded-full bg-success" style={{ width: `${Math.round((task.subtaskDoneCount / task.subtaskCount) * 100)}%` }} />
          </span>
          {task.subtaskDoneCount}/{task.subtaskCount}
        </span>
      ) : null;
    case 'links': {
      const links = ctx.links.get(task.id)?.filter((link) => !isCustomerLink(link) && Boolean(link.targetId)) ?? [];
      return links.length ? (
        <CollapsingRow names={links.map((link) => cleanTitle(link.title ?? ''))}>
          {links.map((link) => (
            <LinkChip key={link.id} link={link} variant="ref" />
          ))}
        </CollapsingRow>
      ) : null;
    }
    case 'customer': {
      const customer = customerOf(task, ctx);
      if (!customer) return null;
      const name = cleanTitle(customer.link.title ?? 'Customer');
      return (
        <span className={`truncate ${customer.inherited ? 'text-fg-muted' : ''}`} title={customer.inherited ? `${name} (from the project)` : name}>
          {name}
        </span>
      );
    }
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
    case 'estimateTime':
      return task.estimateMinutes === null ? '' : String(task.estimateMinutes);
    case 'cycle':
      return ctx.cycleByTask?.get(task.id) ?? '';
    case 'section':
      return task.sectionId ? (ctx.sectionById.get(task.sectionId)?.name ?? '') : '';
    case 'subtasks':
      return task.subtaskCount ? `${task.subtaskDoneCount}/${task.subtaskCount}` : '';
    case 'links':
      return (ctx.links.get(task.id) ?? []).filter((link) => !isCustomerLink(link)).map((link) => link.title ?? '').filter(Boolean).join('; ');
    case 'customer':
      return customerOf(task, ctx)?.link.title ?? '';
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
