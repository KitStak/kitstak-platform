'use client';
/**
 * Table: a spreadsheet of the project's tasks. Every field is a column (custom fields too):
 * resize by dragging a header edge, hide/show and reorder in "Columns", click a header to sort
 * (Shift+click adds a second sort), group by status/assignee/priority/section/label or a
 * custom dropdown field, edit any cell in place, and move around with the keyboard (arrows,
 * Enter to edit, Esc to cancel, Tab to the next cell). Sticky header and task column, totals
 * row, multi-select with the bulk bar, and add a task at the bottom.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, ChevronDown, ChevronRight, Download, EyeOff, Layers, Maximize2, MoreHorizontal, Plus, X } from 'lucide-react';
import {
  Button,
  Checkbox,
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  cn,
  toast,
} from '@/components/ui';
import { PRIORITIES } from '@/lib/constants';
import { useCycles, useProjectLinks, useProjectTasks } from '@/lib/hooks/use-data';
import { usePeopleMap } from '@/lib/hooks/use-people';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { compareRank } from '@/lib/rank';
import { NO_GROUP } from '@/lib/task-filters';
import type { TaskSummary } from '@/lib/types';
import type { GroupField, SortRule, ViewColumn } from '@/lib/view-config';
import { useCurrentProject } from '@/features/projects/project-context';
import { useShellStore } from '@/features/shell/store';
import { BulkBar } from '@/features/views/bulk-bar';
import { DisplayMenu } from '@/features/views/display-menu';
import { AssigneePicker, DuePicker, LabelsPicker, PriorityPicker, StatusPicker } from '@/features/views/field-pickers';
import { useGroupMeta } from '@/features/views/group-meta';
import { InlineTitle } from '@/features/views/inline-title';
import { useTaskLinksMap } from '@/features/views/link-chips';
import { OptionList } from '@/features/views/option-list';
import { TaskMenuItems } from '@/features/views/task-menu';
import { useSelection } from '@/features/views/use-selection';
import { useStoredSet } from '@/features/views/use-stored-set';
import { useTaskNav } from '@/features/views/use-task-nav';
import { useTaskOps, type TaskOps } from '@/features/views/use-task-ops';
import { useViewState } from '@/features/views/use-view-state';
import { ViewToolbar } from '@/features/views/view-toolbar';
import { GROUP_LABELS } from '@/features/views/view-state';
import { ColumnsMenu } from './columns-menu';
import { COMPACT_WIDTHS, TITLE_KEY, buildColumns, csvValue, fieldOptions, isCustomerLink, renderCell, resolveColumns, toCsv, type ColumnDef, type RenderContext } from './table-columns';

const ROW_HEADER_WIDTH = 112;
const ROW_HEIGHT = 'h-9';

type Entry = { readonly type: 'group'; readonly key: string; readonly count: number; readonly tasks: readonly TaskSummary[] } | { readonly type: 'task'; readonly task: TaskSummary; readonly group: string };

interface ActiveCell {
  readonly taskId: string;
  readonly col: string;
}

function groupKeysOf(task: TaskSummary, field: GroupField, fieldId: string | null): string[] {
  switch (field) {
    case 'status':
      return [task.statusId];
    case 'assignee':
      return [task.assigneeId ?? NO_GROUP];
    case 'priority':
      return [task.priority];
    case 'section':
      return [task.sectionId ?? NO_GROUP];
    case 'label':
      return task.labelIds.length ? [...task.labelIds] : [NO_GROUP];
    case 'custom': {
      const value = fieldId ? task.customFields[fieldId] : null;
      return typeof value === 'string' && value ? [value] : [NO_GROUP];
    }
    default:
      return ['all'];
  }
}

/** Multi-key sort that understands status/section order and people names; nulls last. */
function useSorter(rules: readonly SortRule[]) {
  const { statuses, project } = useCurrentProject();
  const people = usePeopleMap();
  return useMemo(() => {
    const statusIndex = new Map(statuses.map((status, index) => [status.id, index]));
    const sectionIndex = new Map(project.sections.map((section, index) => [section.id, index]));
    const priorityIndex = new Map(PRIORITIES.map((priority, index) => [priority, index]));
    const key = (task: TaskSummary, rule: SortRule): string | number | null => {
      switch (rule.field) {
        case 'status':
          return statusIndex.get(task.statusId) ?? 99;
        case 'section':
          return task.sectionId ? (sectionIndex.get(task.sectionId) ?? 99) : null;
        case 'assignee':
          return task.assigneeId ? (people.get(task.assigneeId)?.name.toLowerCase() ?? '~') : null;
        case 'priority':
          return task.priority === 'none' ? null : (priorityIndex.get(task.priority) ?? 9);
        case 'title':
          return task.title.toLowerCase();
        case 'number':
          return task.number;
        case 'dueDate':
          return task.dueDate;
        case 'startDate':
          return task.startDate;
        case 'createdAt':
          return task.createdAt;
        case 'updatedAt':
          return task.updatedAt;
        case 'position':
          return task.position;
        case 'custom': {
          const value = rule.fieldId ? task.customFields[rule.fieldId] : null;
          if (typeof value === 'number') return value;
          if (typeof value === 'string' && value) return value.toLowerCase();
          if (typeof value === 'boolean') return value ? 0 : 1;
          return null;
        }
        default:
          return null;
      }
    };
    return (tasks: readonly TaskSummary[]) =>
      [...tasks].sort((a, b) => {
        for (const rule of rules) {
          const ka = key(a, rule);
          const kb = key(b, rule);
          if (ka === kb) continue;
          if (ka === null) return 1;
          if (kb === null) return -1;
          const cmp = rule.field === 'position' && typeof ka === 'string' && typeof kb === 'string' ? compareRank(ka, kb) : ka < kb ? -1 : 1;
          return rule.dir === 'asc' ? cmp : -cmp;
        }
        return a.number - b.number;
      });
  }, [people, project.sections, rules, statuses]);
}

function sameRule(rule: SortRule | undefined, def: ColumnDef): boolean {
  return Boolean(rule && def.sort && rule.field === def.sort.field && (rule.fieldId ?? null) === (def.sort.fieldId ?? null));
}

/** Text / number editor inside a cell. Enter saves and moves down, Tab saves and moves right. */
function CellInput({ initial, numeric, onCommit, onCancel }: { readonly initial: string; readonly numeric: boolean; readonly onCommit: (value: string, move: 'down' | 'right' | 'left' | null) => void; readonly onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.focus();
    const length = node.value.length;
    node.setSelectionRange(length, length);
  }, []);
  const finish = (move: 'down' | 'right' | 'left' | null) => {
    if (done.current) return;
    done.current = true;
    onCommit(value, move);
  };
  return (
    <input
      ref={ref}
      value={value}
      inputMode={numeric ? 'decimal' : undefined}
      onChange={(event) => setValue(numeric ? event.target.value.replace(/[^0-9.,-]/g, '') : event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          finish('down');
        } else if (event.key === 'Tab') {
          event.preventDefault();
          finish(event.shiftKey ? 'left' : 'right');
        } else if (event.key === 'Escape') {
          event.preventDefault();
          done.current = true;
          onCancel();
        }
      }}
      onBlur={() => finish(null)}
      className={cn('h-full w-full min-w-0 bg-panel px-2 text-sm text-fg outline-none', numeric && 'text-right tabular-nums')}
      aria-label="Edit cell"
    />
  );
}

interface CellProps {
  readonly def: ColumnDef;
  readonly task: TaskSummary;
  readonly ctx: RenderContext;
  readonly ops: TaskOps;
  readonly canEdit: boolean;
  readonly active: boolean;
  readonly editing: boolean;
  readonly seed: string | null;
  readonly width: number;
  readonly stickyLeft?: number;
  readonly onActivate: () => void;
  readonly onEdit: (editing: boolean, seed?: string | null) => void;
  readonly onMove: (direction: 'down' | 'right' | 'left') => void;
  readonly onOpen: () => void;
}

const PICKERS = new Set(['status', 'priority', 'assignee', 'date', 'labels', 'section', 'select', 'multiselect', 'person']);

function BodyCell({ def, task, ctx, ops, canEdit, active, editing, seed, width, stickyLeft, onActivate, onEdit, onMove, onOpen }: CellProps) {
  const { project } = useCurrentProject();
  const openTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
  }, []);
  const editable = canEdit && def.editor !== 'readonly';
  const field = def.field;
  const display = renderCell(def, task, ctx);
  const setOpen = (open: boolean) => onEdit(open);

  const commitText = (raw: string, move: 'down' | 'right' | 'left' | null) => {
    onEdit(false);
    const text = raw.trim();
    if (def.key === TITLE_KEY) {
      if (text && text !== task.title) void ops.updateTask(task.id, { title: text });
    } else if (def.key === 'estimate') {
      const number = text === '' ? null : Math.max(0, Math.min(1000, Math.round(Number(text.replace(',', '.')))));
      if (number === null || Number.isFinite(number)) {
        if (number !== task.estimatePoints) void ops.updateTask(task.id, { estimatePoints: number });
      }
    } else if (field) {
      const numeric = field.type === 'number' || field.type === 'currency';
      const value = text === '' ? null : numeric ? Number(text.replace(/,/g, '')) : text;
      if (numeric && value !== null && !Number.isFinite(value as number)) return;
      if (JSON.stringify(value) !== JSON.stringify(task.customFields[field.id] ?? null)) void ops.updateTask(task.id, { customFields: { [field.id]: value } });
    }
    if (move) onMove(move);
  };

  const content = (
    <span className={cn('flex h-full min-w-0 items-center px-2 text-sm', def.align === 'right' && 'justify-end', def.align === 'center' && 'justify-center')}>
      {display ?? (editable ? <Plus aria-hidden className="size-3.5 text-fg-placeholder opacity-0 group-hover/row:opacity-100" /> : null)}
    </span>
  );

  let body: ReactNode = content;
  if (editing && editable) {
    if (def.editor === 'title') {
      body = (
        <span className="flex h-full items-center px-1">
          <InlineTitle value={task.title} caret="end" onSave={(title) => void ops.updateTask(task.id, { title })} onDone={() => onEdit(false)} className="h-7" />
        </span>
      );
    } else if (def.editor === 'number' || def.editor === 'text') {
      const initial = seed ?? (def.key === 'estimate' ? (task.estimatePoints?.toString() ?? '') : field ? String(task.customFields[field.id] ?? '') : '');
      body = <CellInput initial={initial} numeric={def.editor === 'number'} onCommit={commitText} onCancel={() => onEdit(false)} />;
    }
  }

  // Pickers mount only while the cell is being edited (hundreds of rows stay light).
  if (editable && editing && PICKERS.has(def.editor)) {
    const trigger = (
      <button type="button" tabIndex={-1} className="flex h-full w-full min-w-0 items-center text-left outline-none" aria-label={`Edit ${def.label}`}>
        {content}
      </button>
    );
    const pickerProps = { open: editing, onOpenChange: setOpen, align: 'start' as const };
    switch (def.editor) {
      case 'status':
        body = <StatusPicker value={task.statusId} onChange={(statusId) => void ops.updateTask(task.id, { statusId })} {...pickerProps}>{trigger}</StatusPicker>;
        break;
      case 'priority':
        body = <PriorityPicker value={task.priority} onChange={(priority) => void ops.updateTask(task.id, { priority })} {...pickerProps}>{trigger}</PriorityPicker>;
        break;
      case 'assignee':
        body = <AssigneePicker value={task.assigneeId} onChange={(assigneeId) => void ops.updateTask(task.id, { assigneeId })} {...pickerProps}>{trigger}</AssigneePicker>;
        break;
      case 'person': {
        const id = field ? (task.customFields[field.id] as string | null | undefined) ?? null : null;
        body = field ? <AssigneePicker value={id} onChange={(userId) => void ops.updateTask(task.id, { customFields: { [field.id]: userId } })} {...pickerProps}>{trigger}</AssigneePicker> : content;
        break;
      }
      case 'labels':
        body = <LabelsPicker value={task.labelIds} onChange={(labelIds) => void ops.setLabels(task, labelIds)} {...pickerProps}>{trigger}</LabelsPicker>;
        break;
      case 'date': {
        const value = def.dateField ? task[def.dateField] : field ? ((task.customFields[field.id] as string | null | undefined) ?? null) : null;
        body = (
          <DuePicker
            value={value}
            title={def.label}
            onChange={(date) => {
              if (def.dateField) void ops.updateTask(task.id, { [def.dateField]: date });
              else if (field) void ops.updateTask(task.id, { customFields: { [field.id]: date } });
            }}
            {...pickerProps}
          >
            {trigger}
          </DuePicker>
        );
        break;
      }
      case 'section':
      case 'select':
      case 'multiselect': {
        const multiple = def.editor === 'multiselect';
        const options =
          def.editor === 'section'
            ? [...project.sections.map((section) => ({ value: section.id, label: section.name })), { value: NO_GROUP, label: 'No section' }]
            : field
              ? [...fieldOptions(field)]
              : [];
        const current: string[] =
          def.editor === 'section'
            ? [task.sectionId ?? NO_GROUP]
            : field
              ? multiple
                ? (Array.isArray(task.customFields[field.id]) ? (task.customFields[field.id] as unknown[]).map(String) : [])
                : typeof task.customFields[field.id] === 'string'
                  ? [task.customFields[field.id] as string]
                  : []
              : [];
        body = (
          <Popover open={editing} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent flush align="start" className="w-60">
              <OptionList
                multiple={multiple}
                searchable={options.length > 7}
                options={options}
                selected={current}
                emptyText="No options yet. Add them in project settings."
                onToggle={(value) => {
                  if (def.editor === 'section') {
                    void ops.updateTask(task.id, { sectionId: value === NO_GROUP ? null : value });
                    onEdit(false);
                  } else if (field && multiple) {
                    const next = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
                    void ops.updateTask(task.id, { customFields: { [field.id]: next.length ? next : null } });
                  } else if (field) {
                    void ops.updateTask(task.id, { customFields: { [field.id]: current[0] === value ? null : value } });
                    onEdit(false);
                  }
                }}
                footer={
                  !multiple && def.editor === 'select' && current.length ? (
                    <Button variant="ghost" size="xs" fullWidth leadingIcon={<X aria-hidden />} onClick={() => { if (field) void ops.updateTask(task.id, { customFields: { [field.id]: null } }); onEdit(false); }}>
                      Clear
                    </Button>
                  ) : undefined
                }
              />
            </PopoverContent>
          </Popover>
        );
        break;
      }
      default:
        break;
    }
  }

  if (def.editor === 'checkbox' && field) {
    const checked = task.customFields[field.id] === true;
    body = (
      <span className="flex h-full items-center justify-center">
        <Checkbox checked={checked} disabled={!canEdit} tabIndex={-1} onCheckedChange={(next) => void ops.updateTask(task.id, { customFields: { [field.id]: next === true } })} aria-label={`${field.name}: ${checked ? 'yes' : 'no'}`} />
      </span>
    );
  }

  if (def.editor === 'title' && !editing) {
    body = (
      <span className="flex h-full min-w-0 items-center gap-1 px-2">
        <span
          onClick={(event) => {
            // Spreadsheet feel: one click opens the task, a double-click renames it instead.
            if (event.detail > 1) {
              if (openTimer.current) window.clearTimeout(openTimer.current);
              openTimer.current = null;
              return;
            }
            if (openTimer.current) window.clearTimeout(openTimer.current);
            openTimer.current = window.setTimeout(() => {
              openTimer.current = null;
              onOpen();
            }, canEdit ? 260 : 0);
          }}
          className={cn('min-w-0 cursor-pointer truncate text-left text-sm font-medium hover:underline', task.statusCategory === 'done' || task.statusCategory === 'cancelled' ? 'text-fg-muted' : 'text-fg', task.parentTaskId && 'font-normal text-fg-secondary')}
          title={canEdit ? `${task.title} (click to open, double-click or F2 to rename)` : task.title}
        >
          {task.parentTaskId ? <span className="mr-1 text-fg-muted">↳</span> : null}
          {task.title}
        </span>
        <button
          type="button"
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          aria-label={`Open ${task.key}`}
          className="ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded-xs text-icon opacity-0 outline-none group-hover/row:opacity-100 hover:bg-pressed"
        >
          <Maximize2 aria-hidden className="size-3.5" />
        </button>
      </span>
    );
  }

  return (
    <td
      role="gridcell"
      tabIndex={active ? 0 : -1}
      data-col={def.key}
      data-active={active || undefined}
      aria-selected={active}
      style={{ width, minWidth: width, maxWidth: width, ...(stickyLeft !== undefined ? { '--sticky-left': `${stickyLeft}px` } : {}) } as CSSProperties}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        onActivate();
      }}
      onClick={() => {
        if (editable && PICKERS.has(def.editor) && !editing) onEdit(true);
      }}
      onDoubleClick={() => {
        if (openTimer.current) window.clearTimeout(openTimer.current);
        openTimer.current = null;
        if (editable && (def.editor === 'title' || def.editor === 'text' || def.editor === 'number')) onEdit(true);
      }}
      className={cn(
        'relative overflow-hidden border-r border-b border-border-subtle p-0 outline-none',
        ROW_HEIGHT,
        stickyLeft !== undefined && 'z-[2] bg-panel md:sticky md:left-[var(--sticky-left)] group-hover/row:bg-[color-mix(in_srgb,var(--surface-panel),var(--text-primary)_4%)] group-data-[selected=true]/row:bg-primary-selected',
        active && (stickyLeft !== undefined ? 'z-[3]' : 'z-[1]'),
        active && 'shadow-[inset_0_0_0_2px_var(--primary)]',
        editing && def.editor !== 'title' && PICKERS.has(def.editor) === false && 'shadow-[inset_0_0_0_2px_var(--primary)]',
      )}
    >
      {body}
    </td>
  );
}

function HeaderCell({
  def,
  width,
  sortIndex,
  sortDir,
  stickyLeft,
  multiSort,
  onSort,
  onClearSort,
  onHide,
  onGroup,
  onResize,
  onResizeEnd,
}: {
  readonly def: ColumnDef;
  readonly width: number;
  readonly sortIndex: number;
  readonly sortDir: 'asc' | 'desc' | null;
  readonly stickyLeft?: number;
  readonly multiSort: boolean;
  readonly onSort: (dir: 'asc' | 'desc' | 'toggle', add: boolean) => void;
  readonly onClearSort: () => void;
  readonly onHide: () => void;
  readonly onGroup: (() => void) | null;
  readonly onResize: (width: number) => void;
  readonly onResizeEnd: (width: number) => void;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const latest = useRef(width);
  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    start.current = { x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  return (
    <th
      scope="col"
      aria-sort={sortDir === 'asc' ? 'ascending' : sortDir === 'desc' ? 'descending' : 'none'}
      style={{ width, minWidth: width, maxWidth: width, ...(stickyLeft !== undefined ? { '--sticky-left': `${stickyLeft}px` } : {}) } as CSSProperties}
      className={cn('group/th relative h-9 border-r border-b border-border-subtle bg-sunken p-0 text-left text-xs font-medium text-fg-secondary', stickyLeft !== undefined && 'z-[6] md:sticky md:left-[var(--sticky-left)]')}
      data-col={def.key}
    >
      <div className="flex h-full items-center">
        <button
          type="button"
          disabled={!def.sort}
          onClick={(event) => onSort('toggle', event.shiftKey)}
          title={def.sort ? `${def.label}: click to sort. Shift+click to add a second sort.` : def.label}
          className={cn('flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 outline-none hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus disabled:cursor-default disabled:hover:text-fg-secondary [&_svg]:size-3.5 [&_svg]:shrink-0', def.align === 'right' && 'justify-end')}
          data-testid={`th-${def.key}`}
        >
          <span className="text-icon">{def.icon}</span>
          {/* Compact columns (Assignee and Priority on narrow screens) show the icon only. */}
          <span className={cn('truncate', width < 96 && 'sr-only')}>{def.label}</span>
          {sortDir ? (
            <span className="inline-flex items-center text-primary-text">
              {sortDir === 'asc' ? <ArrowUp aria-label="sorted ascending" /> : <ArrowDown aria-label="sorted descending" />}
              {multiSort ? <span className="text-2xs tabular-nums">{sortIndex + 1}</span> : null}
            </span>
          ) : null}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={`${def.label} column options`} className="absolute top-1/2 right-1.5 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-xs bg-sunken text-icon opacity-0 shadow-[0_0_0_4px_var(--surface-sunken)] outline-none group-hover/th:opacity-100 hover:bg-hover focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus data-[state=open]:opacity-100">
              <MoreHorizontal aria-hidden className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {def.sort ? (
              <>
                <DropdownMenuItem icon={<ArrowUp aria-hidden />} onSelect={() => onSort('asc', false)}>
                  Sort A → Z / low → high
                </DropdownMenuItem>
                <DropdownMenuItem icon={<ArrowDown aria-hidden />} onSelect={() => onSort('desc', false)}>
                  Sort Z → A / high → low
                </DropdownMenuItem>
                {sortDir ? (
                  <DropdownMenuItem icon={<X aria-hidden />} onSelect={onClearSort}>
                    Remove this sort
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
              </>
            ) : null}
            {onGroup ? (
              <DropdownMenuItem icon={<Layers aria-hidden />} onSelect={onGroup}>
                Group by {def.label.toLowerCase()}
              </DropdownMenuItem>
            ) : null}
            {def.key !== TITLE_KEY ? (
              <DropdownMenuItem icon={<EyeOff aria-hidden />} onSelect={onHide}>
                Hide column
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${def.label}`}
        tabIndex={0}
        onPointerDown={beginResize}
        onPointerMove={(event) => {
          if (!start.current) return;
          const next = Math.max(def.minWidth, Math.min(800, Math.round(start.current.width + event.clientX - start.current.x)));
          latest.current = next;
          onResize(next);
        }}
        onPointerUp={() => {
          if (!start.current) return;
          start.current = null;
          onResizeEnd(latest.current);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const next = Math.max(def.minWidth, Math.min(800, width + (event.key === 'ArrowRight' ? 16 : -16)));
          onResizeEnd(next);
        }}
        className="absolute top-0 -right-1 z-[1] h-full w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-1 after:left-[3px] after:w-0.5 after:rounded-full after:bg-transparent hover:after:bg-primary focus-visible:after:bg-primary"
      />
    </th>
  );
}

export function TableView() {
  const { project, statusById, labelById, sectionById, capabilities } = useCurrentProject();
  const tasksQuery = useProjectTasks(project.key);
  const view = useViewState('table');
  const ops = useTaskOps();
  const linksByTask = useTaskLinksMap(project.key);
  const { openTask } = useTaskDrawer();
  const openQuickAdd = useShellStore((state) => state.openQuickAdd);
  const canEdit = capabilities['task:update'];
  const canCreate = capabilities['task:create'];
  const all = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  // The Task column fits the longest title (up to 480px) when nobody has resized it, so titles are
  // not cut while there is room. Measured after mount (the server has no fonts to measure with).
  const [titleFit, setTitleFit] = useState(0);
  useEffect(() => {
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return;
    context.font = `400 14px ${getComputedStyle(document.body).fontFamily}`;
    let longest = 0;
    for (const task of all) if (!task.parentTaskId) longest = Math.max(longest, context.measureText(task.title).width);
    // Measuring needs the DOM (fonts), so it can only happen after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTitleFit(Math.min(480, Math.ceil(longest) + 40));
  }, [all]);
  const defs = useMemo(() => buildColumns(project.customFields), [project.customFields]);
  const defByKey = useMemo(() => new Map(defs.map((def) => [def.key, def])), [defs]);
  const columns = useMemo(() => resolveColumns(defs, view.settings.columns), [defs, view.settings.columns]);
  const [widthDraft, setWidthDraft] = useState<{ key: string; width: number } | null>(null);
  // The grid's visible width: the Task column grows to fill it, and an edge shadow shows when
  // more columns sit off to the right.
  const [gridWidth, setGridWidth] = useState(0);
  // Narrow grids (laptops under ~1366px wide, tablets) fit more columns: Assignee becomes an avatar
  // and Priority an icon, unless the person resized those columns themselves.
  const compactGrid = gridWidth > 0 && gridWidth < 1120;
  const widthOf = useCallback(
    (column: ViewColumn) => {
      if (widthDraft?.key === column.key) return widthDraft.width;
      const def = defByKey.get(column.key);
      const saved = column.width ?? def?.defaultWidth ?? 140;
      // Narrow grids cap Assignee, Priority, Status and dates at compact widths.
      const compactWidth = COMPACT_WIDTHS[column.key];
      if (compactGrid && compactWidth !== undefined) return Math.min(saved, compactWidth);
      return saved;
    },
    [compactGrid, defByKey, widthDraft],
  );
  const shown = useMemo(() => columns.filter((column) => !column.hidden && defByKey.has(column.key)), [columns, defByKey]);
  const sort = view.settings.sort;
  const sorter = useSorter(sort);
  const groupBy = view.settings.groupBy;
  const groupFieldId = view.settings.groupFieldId;
  const meta = useGroupMeta(groupBy, all, groupFieldId);
  const collapsedGroups = useStoredSet(`ks.projects.table.collapsed.${project.id}.${groupBy}.${groupFieldId ?? ''}`);
  const [active, setActive] = useState<ActiveCell | null>(null);
  const [editing, setEditing] = useState<{ cell: ActiveCell; seed: string | null } | null>(null);
  const [draft, setDraft] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => sorter(view.visible(all)), [all, sorter, view]);
  const projectLinks = useProjectLinks(project.key);
  const projectCustomer = useMemo(() => (projectLinks.data ?? []).find((link) => !link.taskId && isCustomerLink(link)) ?? null, [projectLinks.data]);
  const showsCycle = shown.some((column) => column.key === 'cycle');
  const cyclesQuery = useCycles(project.key, { enabled: showsCycle });
  const cycleByTask = useMemo(() => {
    const data = cyclesQuery.data;
    const map = new Map<string, string>();
    if (!data) return map;
    const names = new Map(data.cycles.map((cycle) => [cycle.id, cycle.name || `Cycle ${cycle.number}`]));
    for (const [taskId, cycleId] of Object.entries(data.taskCycle)) {
      const name = names.get(cycleId);
      if (name) map.set(taskId, name);
    }
    return map;
  }, [cyclesQuery.data]);
  const [moreRight, setMoreRight] = useState(0);
  const ctx = useMemo<RenderContext>(() => ({ statusById, labelById, sectionById, links: linksByTask, projectCustomer, cycleByTask, compact: compactGrid }), [compactGrid, cycleByTask, labelById, linksByTask, projectCustomer, sectionById, statusById]);
  useEffect(() => {
    const element = gridRef.current;
    if (!element) return;
    const update = () => {
      setGridWidth(element.clientWidth);
      // How many columns sit (even partly) past the right edge: the "N more columns" button.
      const edge = element.scrollLeft + element.clientWidth + 2;
      let count = 0;
      if (element.scrollLeft + element.clientWidth < element.scrollWidth - 2)
        element.querySelectorAll<HTMLElement>('thead th[data-col]').forEach((th) => {
          if (th.offsetLeft + th.offsetWidth > edge) count += 1;
        });
      setMoreRight(count);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    element.addEventListener('scroll', update, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', update);
    };
  });

  const entries = useMemo<Entry[]>(() => {
    if (groupBy === 'none') return rows.map((task) => ({ type: 'task', task, group: 'all' }));
    const buckets = new Map<string, TaskSummary[]>();
    for (const task of rows) {
      for (const key of groupKeysOf(task, groupBy, groupFieldId)) {
        const list = buckets.get(key);
        if (list) list.push(task);
        else buckets.set(key, [task]);
      }
    }
    const keys = meta.order.filter((key) => buckets.has(key));
    for (const key of buckets.keys()) if (!keys.includes(key)) keys.push(key);
    const out: Entry[] = [];
    for (const key of keys) {
      const tasks = buckets.get(key) ?? [];
      out.push({ type: 'group', key, count: tasks.length, tasks });
      if (!collapsedGroups.has(key)) for (const task of tasks) out.push({ type: 'task', task, group: key });
    }
    return out;
  }, [collapsedGroups, groupBy, groupFieldId, meta.order, rows]);

  const taskEntries = useMemo(() => entries.filter((entry): entry is Extract<Entry, { type: 'task' }> => entry.type === 'task'), [entries]);
  const rowKeys = useMemo(() => taskEntries.map((entry) => `${entry.group}|${entry.task.id}`), [taskEntries]);
  const selection = useSelection(useMemo(() => [...new Set(taskEntries.map((entry) => entry.task.id))], [taskEntries]));

  // J / K walk the rows from anywhere on the page; the first press lands on the first title cell.
  const titleCol = shown[0]?.key ?? TITLE_KEY;
  useTaskNav(gridRef, {
    enabled: editing === null,
    focusTask: (row) => {
      const taskId = row.dataset.row;
      if (!taskId) return;
      setActive({ taskId, col: titleCol });
      row.querySelector<HTMLElement>(`td[data-col="${CSS.escape(titleCol)}"]`)?.focus();
    },
  });

  // Focus follows the active cell (roving tabindex).
  useEffect(() => {
    if (!active || editing) return;
    const cell = gridRef.current?.querySelector<HTMLElement>(`tr[data-row="${CSS.escape(active.taskId)}"] td[data-col="${CSS.escape(active.col)}"]`);
    if (cell && document.activeElement !== cell && gridRef.current?.contains(document.activeElement ?? null)) cell.focus({ preventScroll: false });
    cell?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, editing]);

  const moveActive = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right' | 'home' | 'end', from: ActiveCell | null = active) => {
      if (!from) return;
      const rowIndex = taskEntries.findIndex((entry) => entry.task.id === from.taskId);
      const colIndex = shown.findIndex((column) => column.key === from.col);
      let nextRow = rowIndex;
      let nextCol = colIndex;
      if (direction === 'up') nextRow = Math.max(0, rowIndex - 1);
      if (direction === 'down') nextRow = Math.min(taskEntries.length - 1, rowIndex + 1);
      if (direction === 'left') nextCol = Math.max(0, colIndex - 1);
      if (direction === 'right') nextCol = Math.min(shown.length - 1, colIndex + 1);
      if (direction === 'home') nextCol = 0;
      if (direction === 'end') nextCol = shown.length - 1;
      const entry = taskEntries[nextRow];
      const column = shown[nextCol];
      if (entry && column) {
        setActive({ taskId: entry.task.id, col: column.key });
        requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`tr[data-row="${CSS.escape(entry.task.id)}"] td[data-col="${CSS.escape(column.key)}"]`)?.focus());
      }
    },
    [active, shown, taskEntries],
  );

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    const target = event.target as HTMLElement;
    if (!target.closest('td[role="gridcell"]')) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && target.closest('tbody')) {
        event.preventDefault();
        selection.selectAll();
      }
      return;
    }
    if (!active) return;
    const def = defByKey.get(active.col);
    const task = all.find((entry) => entry.id === active.taskId);
    const map: Record<string, 'up' | 'down' | 'left' | 'right'> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (map[event.key]) {
      event.preventDefault();
      moveActive(map[event.key] as 'up');
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      moveActive(event.shiftKey ? 'left' : 'right');
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      moveActive(event.key === 'Home' ? 'home' : 'end');
      return;
    }
    if (event.key === 'Escape') {
      if (selection.count) selection.clear();
      else setActive(null);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selection.selectAll();
      return;
    }
    if (!task || !def) return;
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      openTask(task.key);
      return;
    }
    if (event.key === ' ' && (def.editor === 'checkbox' || event.shiftKey)) {
      event.preventDefault();
      if (def.editor === 'checkbox' && def.field && canEdit) void ops.updateTask(task.id, { customFields: { [def.field.id]: task.customFields[def.field.id] !== true } });
      else selection.toggle(task.id);
      return;
    }
    if (event.key === 'Enter' && def.editor === 'title') {
      // Enter on the task name opens it (like List and Board); F2 or double-click renames.
      event.preventDefault();
      openTask(task.key);
      return;
    }
    if (!canEdit || def.editor === 'readonly' || def.editor === 'checkbox') return;
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      setEditing({ cell: active, seed: null });
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && def.editor !== 'title') {
      event.preventDefault();
      if (def.key === 'estimate') void ops.updateTask(task.id, { estimatePoints: null });
      else if (def.dateField) void ops.updateTask(task.id, { [def.dateField]: null });
      else if (def.key === 'assignee') void ops.updateTask(task.id, { assigneeId: null });
      else if (def.key === 'labels') void ops.setLabels(task, []);
      else if (def.field) void ops.updateTask(task.id, { customFields: { [def.field.id]: null } });
      return;
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && (def.editor === 'text' || def.editor === 'number')) {
      event.preventDefault();
      setEditing({ cell: active, seed: event.key });
    }
  };

  const setSort = (def: ColumnDef, dir: 'asc' | 'desc' | 'toggle', add: boolean) => {
    if (!def.sort) return;
    const index = sort.findIndex((rule) => sameRule(rule, def));
    const current = index >= 0 ? sort[index] : undefined;
    let nextDir: 'asc' | 'desc' | null = dir === 'toggle' ? (current ? (current.dir === 'asc' ? 'desc' : null) : def.sort.dir) : dir;
    if (dir === 'toggle' && !current) nextDir = def.sort.dir;
    const rule: SortRule | null = nextDir ? { ...def.sort, dir: nextDir } : null;
    let next: SortRule[];
    if (add) {
      next = sort.filter((entry) => !sameRule(entry, def) && entry.field !== 'number');
      if (rule) next = index >= 0 ? sort.map((entry, i) => (i === index ? rule : entry)) : [...next, rule];
    } else next = rule ? [rule] : [];
    view.setSettings({ sort: next.length ? next : [{ field: 'number', dir: 'asc' }] });
  };

  const commitColumns = (next: ViewColumn[]) => view.setColumns(next);
  const groupChoices = [
    ...(['none', 'status', 'assignee', 'priority', 'section', 'label'] as const).map((value) => ({ value, label: GROUP_LABELS[value] ?? value })),
    ...project.customFields.filter((field) => field.type === 'select').map((field) => ({ value: `custom:${field.id}`, label: field.name })),
  ];
  const groupValue = groupBy === 'custom' && groupFieldId ? `custom:${groupFieldId}` : groupBy;
  const setGroup = (value: string) => {
    if (value.startsWith('custom:')) view.setSettings({ groupBy: 'custom', groupFieldId: value.slice(7) });
    else view.setSettings({ groupBy: value as GroupField, groupFieldId: null });
  };
  const groupLabel = groupChoices.find((choice) => choice.value === groupValue)?.label;

  const people = usePeopleMap();
  const exportCsv = () => {
    const header = ['ID', ...shown.map((column) => defByKey.get(column.key)?.label ?? column.key)];
    const body = rows.map((task) => [task.key, ...shown.map((column) => {
      const def = defByKey.get(column.key);
      return def ? csvValue(def, task, ctx, (id) => people.get(id)?.name ?? '') : '';
    })]);
    const blob = new Blob([toCsv([header, ...body])], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project.key}-tasks-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${rows.length} ${rows.length === 1 ? 'task' : 'tasks'}`, 'Open the file in Excel, Numbers or Google Sheets.');
  };

  const controls = ({ iconOnly }: { iconOnly: boolean }) => (
    <>
      <ColumnsMenu columns={columns} defs={defByKey} onChange={commitColumns} onReset={() => commitColumns(resolveColumns(defs, []))} iconOnly={iconOnly} />
      <DisplayMenu
        iconOnly={iconOnly}
        summary={groupBy !== 'none' ? `Group: ${groupLabel ?? ''}` : null}
        choices={[{ label: 'Group by', value: groupValue, options: groupChoices, onChange: setGroup, testId: 'group' }]}
        toggles={[
          { label: 'Done tasks', checked: view.settings.showCompleted, onChange: (checked) => view.setSettings({ showCompleted: checked }), testId: 'toggle-done' },
          { label: 'Subtasks as rows', checked: view.settings.showSubtasks, onChange: (checked) => view.setSettings({ showSubtasks: checked }), testId: 'toggle-subtasks' },
        ]}
        footer={
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<Download aria-hidden />} onSelect={exportCsv} disabled={rows.length === 0} description="The shown rows and columns" data-testid="export-csv">
              Download as spreadsheet (CSV)
            </DropdownMenuItem>
          </>
        }
      />
    </>
  );

  const totalCount = all.filter((task) => view.settings.showSubtasks || !task.parentTaskId).length;
  const toolbar = <ViewToolbar view={view} tasks={all} shownCount={rows.length} totalCount={totalCount} controls={controls} controlsWidth={groupBy !== 'none' ? 300 : 200} />;

  if (tasksQuery.isLoading) {
    return (
      <div className="flex h-full flex-col" data-testid="table-view">
        {toolbar}
        <div className="flex flex-col gap-0 p-4 sm:px-6" aria-busy="true" aria-label="Loading the table">
          <Skeleton height={36} />
          {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
            <div key={row} className="flex h-9 items-center gap-6 border-b border-border-subtle px-3">
              <Skeleton width={60} height={10} rounded="full" />
              <Skeleton width={`${30 - row * 2}%`} height={10} rounded="full" />
              <Skeleton width={90} height={10} rounded="full" />
              <Skeleton width={110} height={10} rounded="full" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (tasksQuery.isError && !tasksQuery.data) {
    return (
      <div className="flex h-full flex-col" data-testid="table-view">
        {toolbar}
        <EmptyState illustration="error" title="We couldn't load the table" description="Check your connection, then try again." actions={<Button onClick={() => void tasksQuery.refetch()}>Try again</Button>} />
      </div>
    );
  }

  const titleColumn = shown[0] ?? { key: TITLE_KEY };
  const titleDefault = defByKey.get(TITLE_KEY)?.defaultWidth;
  const titleResized = widthDraft?.key === titleColumn.key || (titleColumn.width !== undefined && titleColumn.width !== titleDefault);
  // Phones: the Task column fits the screen next to the ID, so the next column peeks in (a visible
  // hint that the table scrolls sideways) instead of the title running off the edge.
  const phoneTitle = gridWidth > 0 && gridWidth < 640 ? Math.max(180, gridWidth - ROW_HEADER_WIDTH - 36) : null;
  const savedTitleWidth = titleResized ? widthOf(titleColumn) : (phoneTitle ?? Math.max(widthOf(titleColumn), titleFit));
  const otherWidth = ROW_HEADER_WIDTH + shown.slice(1).reduce((sum, column) => sum + widthOf(column), 0) + 48;
  // Task takes any spare room so the table always reaches the right edge (never while resizing it).
  const titleWidth = widthDraft?.key === shown[0]?.key || (phoneTitle !== null && !titleResized) ? savedTitleWidth : Math.max(savedTitleWidth, gridWidth - otherWidth);
  const tableWidth = otherWidth + titleWidth;
  const allSelected = rows.length > 0 && selection.count === new Set(rows.map((task) => task.id)).size;
  const sumCells = shown.map((column) => defByKey.get(column.key)?.sum?.(rows) ?? null);

  return (
    <div className="flex h-full flex-col" data-testid="table-view">
      {toolbar}
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={gridRef} className="relative min-h-0 flex-1 overflow-auto [scrollbar-width:thin]" onKeyDown={onGridKeyDown}>
        {rows.length === 0 && view.activeFilterCount > 0 ? (
          <EmptyState illustration="search" size="sm" title="No tasks match these filters" description="Try removing a filter or searching for something else." actions={<Button variant="secondary" onClick={view.clearFilters}>Clear filters</Button>} />
        ) : null}
        <table role="grid" aria-label={`${project.name} tasks table`} aria-rowcount={taskEntries.length} aria-multiselectable className="border-separate border-spacing-0 text-sm" style={{ width: tableWidth, tableLayout: 'fixed' }}>
          <thead className="sticky top-0 z-[5]">
            <tr>
              <th scope="col" className="sticky left-0 z-[7] h-9 border-r border-b border-border-subtle bg-sunken p-0" style={{ width: ROW_HEADER_WIDTH, minWidth: ROW_HEADER_WIDTH }}>
                <div className="flex h-full items-center gap-2 pl-3 text-xs font-medium text-fg-secondary">
                  <Checkbox
                    size="sm"
                    checked={allSelected ? true : selection.count ? 'indeterminate' : false}
                    onCheckedChange={(checked) => (checked === true ? selection.selectAll() : selection.clear())}
                    aria-label="Select every task"
                    disabled={rows.length === 0}
                  />
                  <button
                    type="button"
                    onClick={(event) => setSort({ key: 'number', label: 'ID', icon: null, defaultWidth: 0, minWidth: 0, editor: 'readonly', sort: { field: 'number', dir: 'asc' } }, 'toggle', event.shiftKey)}
                    className="inline-flex items-center gap-1 outline-none hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    ID
                    {sort[0]?.field === 'number' ? sort[0].dir === 'asc' ? <ArrowUp aria-hidden className="size-3" /> : <ArrowDown aria-hidden className="size-3" /> : null}
                  </button>
                </div>
              </th>
              {shown.map((column, index) => {
                const def = defByKey.get(column.key) as ColumnDef;
                const sortIndex = sort.findIndex((rule) => sameRule(rule, def));
                return (
                  <HeaderCell
                    key={column.key}
                    def={def}
                    width={index === 0 ? titleWidth : widthOf(column)}
                    stickyLeft={index === 0 ? ROW_HEADER_WIDTH : undefined}
                    sortIndex={sortIndex}
                    sortDir={sortIndex >= 0 ? (sort[sortIndex]?.dir ?? null) : null}
                    multiSort={sort.length > 1}
                    onSort={(dir, add) => setSort(def, dir, add)}
                    onClearSort={() => view.setSettings({ sort: sort.filter((rule) => !sameRule(rule, def)).length ? sort.filter((rule) => !sameRule(rule, def)) : [{ field: 'number', dir: 'asc' }] })}
                    onHide={() => commitColumns(columns.map((entry) => (entry.key === column.key ? { ...entry, hidden: true } : entry)))}
                    onGroup={def.group ? () => view.setSettings({ groupBy: def.group?.field ?? 'none', groupFieldId: def.group?.fieldId ?? null }) : null}
                    onResize={(width) => setWidthDraft({ key: column.key, width })}
                    onResizeEnd={(width) => {
                      setWidthDraft(null);
                      commitColumns(columns.map((entry) => (entry.key === column.key ? { ...entry, width } : entry)));
                    }}
                  />
                );
              })}
              <th scope="col" className="h-9 border-b border-border-subtle bg-sunken p-0" style={{ width: 48 }}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" aria-label="Add a column" title="Add a column" className="mx-auto flex size-7 items-center justify-center rounded-sm text-icon outline-none hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus data-[state=open]:bg-hover" data-testid="add-column">
                      <Plus aria-hidden className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-[360px] w-60 overflow-y-auto">
                    {columns.filter((column) => column.hidden && defByKey.has(column.key)).length === 0 ? (
                      <DropdownMenuItem disabled>Every column is showing</DropdownMenuItem>
                    ) : (
                      columns
                        .filter((column) => column.hidden && defByKey.has(column.key))
                        .map((column) => {
                          const def = defByKey.get(column.key) as ColumnDef;
                          return (
                            <DropdownMenuItem key={column.key} icon={<span className="flex [&_svg]:size-4">{def.icon}</span>} description={def.field ? 'Custom field' : undefined} onSelect={() => commitColumns(columns.map((entry) => (entry.key === column.key ? { ...entry, hidden: false } : entry)))}>
                              {def.label}
                            </DropdownMenuItem>
                          );
                        })
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              if (entry.type === 'group') {
                const info = meta.info(entry.key);
                const closed = collapsedGroups.has(entry.key);
                return (
                  <tr key={`g-${entry.key}`} data-testid="table-group">
                    <td colSpan={shown.length + 2} className="h-10 border-b border-border-subtle bg-app p-0">
                      <div className="sticky left-0 flex w-fit items-center gap-2 px-3">
                        <button type="button" onClick={() => collapsedGroups.toggle(entry.key)} aria-expanded={!closed} className="flex h-8 items-center gap-1.5 rounded-md px-1.5 text-sm font-semibold text-fg outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus">
                          {closed ? <ChevronRight aria-hidden className="size-4 text-icon" /> : <ChevronDown aria-hidden className="size-4 text-icon" />}
                          {info.icon}
                          {info.title}
                          <span className="font-normal text-fg-muted tabular-nums">{entry.count}</span>
                        </button>
                        {canCreate && groupBy !== 'custom' ? (
                          <button type="button" onClick={() => openQuickAdd({ projectId: project.id, ...meta.createDefaults(entry.key) })} aria-label={`Add a task to ${info.title}`} className="inline-flex size-7 items-center justify-center rounded-sm text-icon outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus">
                            <Plus aria-hidden className="size-4" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              }
              const { task } = entry;
              const selected = selection.has(task.id);
              return (
                <ContextMenu key={`${entry.group}|${task.id}`}>
                  <ContextMenuTrigger asChild>
                    <tr data-row={task.id} data-testid="table-row" data-task-key={task.key} data-selected={selected || undefined} aria-selected={selected} className="group/row bg-panel hover:bg-[color-mix(in_srgb,var(--surface-panel),var(--text-primary)_4%)] data-[selected=true]:bg-primary-selected">
                      <td className="sticky left-0 z-[2] border-r border-b border-border-subtle bg-panel p-0 group-hover/row:bg-[color-mix(in_srgb,var(--surface-panel),var(--text-primary)_4%)] group-data-[selected=true]/row:bg-primary-selected" style={{ width: ROW_HEADER_WIDTH }}>
                        <div className={cn('flex items-center gap-2 pl-3', ROW_HEIGHT)}>
                          <Checkbox
                            size="sm"
                            checked={selected}
                            onCheckedChange={() => selection.toggle(task.id)}
                            onClick={(event) => {
                              if (event.shiftKey) {
                                event.preventDefault();
                                selection.toggle(task.id, { range: true });
                              }
                            }}
                            aria-label={`Select ${task.key}`}
                          />
                          <span className="truncate font-key text-xs text-fg-muted">{task.key}</span>
                        </div>
                      </td>
                      {shown.map((column, index) => {
                        const def = defByKey.get(column.key) as ColumnDef;
                        const isActive = active?.taskId === task.id && active.col === column.key;
                        const isEditing = editing?.cell.taskId === task.id && editing.cell.col === column.key;
                        return (
                          <BodyCell
                            key={column.key}
                            def={def}
                            task={task}
                            ctx={ctx}
                            ops={ops}
                            canEdit={canEdit}
                            active={isActive}
                            editing={isEditing}
                            seed={isEditing ? (editing?.seed ?? null) : null}
                            width={index === 0 ? titleWidth : widthOf(column)}
                            stickyLeft={index === 0 ? ROW_HEADER_WIDTH : undefined}
                            onActivate={() => setActive({ taskId: task.id, col: column.key })}
                            onEdit={(on, seed) => {
                              if (on) {
                                setActive({ taskId: task.id, col: column.key });
                                setEditing({ cell: { taskId: task.id, col: column.key }, seed: seed ?? null });
                              } else {
                                setEditing(null);
                                requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`tr[data-row="${CSS.escape(task.id)}"] td[data-col="${CSS.escape(column.key)}"]`)?.focus());
                              }
                            }}
                            onMove={(direction) => moveActive(direction, { taskId: task.id, col: column.key })}
                            onOpen={() => openTask(task.key)}
                          />
                        );
                      })}
                      <td className="border-b border-border-subtle p-0" style={{ width: 48 }}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" aria-label={`More actions for ${task.key}`} className="mx-auto flex size-7 items-center justify-center rounded-sm text-icon opacity-0 outline-none group-hover/row:opacity-100 hover:bg-pressed focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus data-[state=open]:opacity-100 max-md:opacity-100">
                              <MoreHorizontal aria-hidden className="size-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <TaskMenuItems task={task} ops={ops} kind="dropdown" />
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-56">
                    <TaskMenuItems task={task} ops={ops} kind="context" />
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </tbody>
          {/* "Add a task" lives in the sticky footer, so a long table never hides it. */}
          <tfoot className="sticky bottom-0 z-[4]">
            {canCreate ? (
              <tr>
                <td colSpan={shown.length + 2} className="border-t border-border-subtle bg-panel p-0">
                  <form
                    className="sticky left-0 flex h-9 w-[min(560px,100vw)] items-center gap-2 pl-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const title = draft.trim();
                      if (!title) return;
                      setDraft('');
                      void ops.createTask({ projectId: project.id, title, at: 'bottom' }, project.key);
                    }}
                  >
                    <Plus aria-hidden className="size-4 shrink-0 text-icon" />
                    <input value={draft} maxLength={500} onChange={(event) => setDraft(event.target.value)} placeholder="Add a task" aria-label="Add a task" className="h-8 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-placeholder" data-testid="table-add-input" />
                  </form>
                </td>
              </tr>
            ) : null}
            <tr>
              <td className="sticky left-0 z-[5] h-9 border-t border-r border-border-subtle bg-sunken px-3 text-xs font-medium whitespace-nowrap text-fg-secondary" style={{ width: ROW_HEADER_WIDTH }}>
                {rows.length} {rows.length === 1 ? 'task' : 'tasks'}
              </td>
              {shown.map((column, index) => (
                <td key={column.key} className={cn('h-9 border-t border-r border-border-subtle bg-sunken px-2 text-xs font-medium text-fg-secondary tabular-nums', index === 0 && 'z-[5] md:sticky md:left-[var(--sticky-left)]', defByKey.get(column.key)?.align === 'right' && 'text-right')} style={index === 0 ? ({ '--sticky-left': `${ROW_HEADER_WIDTH}px` } as CSSProperties) : undefined}>
                  {sumCells[index] ? <span title="Total of the shown tasks">Σ {sumCells[index]}</span> : null}
                </td>
              ))}
              <td className="h-9 border-t border-border-subtle bg-sunken" />
            </tr>
          </tfoot>
        </table>
        {rowKeys.length === 0 && all.length === 0 ? (
          <EmptyState
            illustration="board"
            size="sm"
            title="No tasks yet"
            description="Type a task name in the row above and press Enter. Every field becomes a column you can sort and edit."
          />
        ) : null}
      </div>
      {moreRight ? (
        <>
          <div aria-hidden className="pointer-events-none absolute top-0 right-0 bottom-0 z-[8] w-6 bg-gradient-to-l from-[color-mix(in_srgb,var(--text-primary)_10%,transparent)] to-transparent" />
          <button
            type="button"
            onClick={() => gridRef.current?.scrollBy({ left: Math.max(200, (gridRef.current?.clientWidth ?? 600) * 0.6), behavior: 'smooth' })}
            className="absolute top-1 right-2 z-[9] inline-flex h-7 items-center gap-1 rounded-full border border-border-default bg-panel px-2.5 text-xs font-medium text-fg-secondary shadow-sm outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
            data-testid="table-more-columns"
          >
            {moreRight === 1 ? '1 more column' : `${moreRight} more columns`}
            <ArrowRight aria-hidden className="size-3.5" />
          </button>
        </>
      ) : null}
      </div>
      <BulkBar selection={selection} tasks={all} ops={ops} />
    </div>
  );
}
