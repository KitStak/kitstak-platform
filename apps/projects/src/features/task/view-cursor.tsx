'use client';
import './view-cursor.css';
/**
 * View cursor for List and Board (Linear style), on top of the views' page-level j / k
 * (`useTaskNav`). Works the moment the page opens:
 *   ↓ / ↑  next / previous task with nothing focused   Enter  open the cursor task
 *   h / l  (board) column to the left / right (←/→ too when no card has focus)
 *   s status · a assignee · p priority · d due date · # labels · i assign to me
 *   t due today · Shift+T due tomorrow · Ctrl/Cmd+Enter done or reopen · Ctrl/Cmd+. copy link
 * One key map for every page (`task-keys.ts`): the same key never means two things.
 * The cursor task gets focus and a 2px brand ring (`data-view-cursor`), and keeps the ring while
 * a picker is open or the drawer shows it. Keys never fire while typing, in a menu or a dialog.
 *
 *   <ViewCursor rootRef={listRef} mode="list" tasks={tasks} ops={ops} canEdit onOpen={open} />
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { toast } from '@/components/ui';
import { isEditableTarget } from '@/lib/hooks/use-hotkeys';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import type { TaskSummary } from '@/lib/types';
import type { TaskOps } from '@/features/views/use-task-ops';
import { AssigneePicker, DuePicker, LabelsPicker, PriorityPicker, StatusPicker } from '@/features/views/field-pickers';
import { addDaysIso, todayIso } from '@/lib/dates';
import { useCurrentProject } from '@/features/projects/project-context';
import { useShell } from '@/features/shell/shell-context';
import { fieldForKey, neighbourCell, stepIndex, type CursorField } from './view-cursor-nav';
import { toggleDoneWithUndo } from './done-toggle';
import { copyTaskLink, taskKeyAction } from './task-keys';

export const VIEW_CURSOR_ATTR = 'data-view-cursor';

const ITEM_SELECTOR: Record<'list' | 'board', string> = {
  list: '[data-testid="list-row"][data-task-key]',
  board: '[data-testid="board-card"][data-task-key]',
};
const CELL_SELECTOR = '[data-testid="board-cell"]';

/** Inline cell triggers to anchor a picker on, when the row shows that cell. */
const FIELD_ANCHORS: Record<CursorField, string> = {
  status: '[data-testid="row-status"]',
  assignee: '[data-testid="row-assignee"], [aria-label="Change assignee"]',
  priority: '[data-testid="row-priority"], [aria-label^="Priority:"]',
  due: '[data-testid="row-due"], [aria-label^="Due "], [aria-label="Add a due date"]',
  labels: '[aria-label="Change labels"]',
};

/** Something else owns the keyboard: a modal, a menu, an open popover or the command palette. */
function keyboardIsBusy(): boolean {
  return Boolean(
    document.querySelector(
      '[role="dialog"][data-state="open"]:not([data-task-panel]), [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper], [cmdk-root]',
    ),
  );
}

function visible(element: Element): boolean {
  return (element as HTMLElement).offsetParent !== null || element.getClientRects().length > 0;
}

interface PickerState {
  readonly field: CursorField;
  readonly task: TaskSummary;
  readonly rect: { left: number; top: number; width: number; height: number };
  readonly element: HTMLElement;
}

export function ViewCursor({
  rootRef,
  mode,
  tasks,
  ops,
  canEdit,
  onOpen,
}: {
  readonly rootRef: RefObject<HTMLElement | null>;
  readonly mode: 'list' | 'board';
  readonly tasks: readonly TaskSummary[];
  readonly ops: Pick<TaskOps, 'updateTask' | 'setLabels'>;
  readonly canEdit: boolean;
  readonly onOpen: (task: TaskSummary) => void;
}) {
  const cursorKey = useRef<string | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const { taskKey } = useTaskDrawer();
  const { statuses } = useCurrentProject();
  const { user } = useShell();
  const latest = useRef({ tasks, ops, canEdit, onOpen, statuses, userId: user.id });
  useEffect(() => {
    latest.current = { tasks, ops, canEdit, onOpen, statuses, userId: user.id };
  });

  const items = useCallback((): HTMLElement[] => {
    const root = rootRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(ITEM_SELECTOR[mode])).filter(visible);
  }, [mode, rootRef]);

  const mark = useCallback(
    (key: string | null) => {
      cursorKey.current = key;
      const root = rootRef.current;
      if (!root) return;
      for (const element of root.querySelectorAll(`[${VIEW_CURSOR_ATTR}]`)) {
        if ((element as HTMLElement).dataset.taskKey !== key) element.removeAttribute(VIEW_CURSOR_ATTR);
      }
      if (!key) return;
      for (const element of root.querySelectorAll<HTMLElement>(ITEM_SELECTOR[mode])) {
        if (element.dataset.taskKey === key) element.setAttribute(VIEW_CURSOR_ATTR, '');
      }
    },
    [mode, rootRef],
  );

  const moveTo = useCallback(
    (element: HTMLElement | undefined) => {
      if (!element) return;
      mark(element.dataset.taskKey ?? null);
      element.focus({ preventScroll: true });
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    },
    [mark],
  );

  /** The cursor element: the focused row, else the remembered one. */
  const current = useCallback((): HTMLElement | null => {
    const list = items();
    const active = document.activeElement;
    const focused = active instanceof HTMLElement ? list.find((element) => element === active || element.contains(active)) : undefined;
    if (focused) return focused;
    return list.find((element) => element.dataset.taskKey === cursorKey.current) ?? null;
  }, [items]);

  // The drawer walks tasks with j/k too: keep the ring on whatever it shows.
  useEffect(() => {
    if (taskKey && items().some((element) => element.dataset.taskKey === taskKey)) mark(taskKey);
  }, [items, mark, taskKey]);

  // Clicking or tabbing to a row moves the cursor there.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onFocusIn = (event: FocusEvent) => {
      const row = (event.target as Element | null)?.closest?.<HTMLElement>(ITEM_SELECTOR[mode]);
      if (row?.dataset.taskKey) mark(row.dataset.taskKey);
    };
    root.addEventListener('focusin', onFocusIn);
    return () => root.removeEventListener('focusin', onFocusIn);
  }, [mark, mode, rootRef]);

  // Rows re-render (sorting, live updates): put the ring back on the cursor task.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new MutationObserver(() => {
      const key = cursorKey.current;
      if (!key) return;
      if (!root.querySelector(`[${VIEW_CURSOR_ATTR}]`)) mark(key);
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [mark, rootRef]);

  /** Instant actions (no picker): done, copy link, assign to me, due today or tomorrow. */
  const runAction = useCallback((action: string, task: TaskSummary) => {
    const { ops: taskOps, canEdit: editable, statuses: list, userId } = latest.current;
    if (action === 'copy-link') {
      void copyTaskLink(task);
      return;
    }
    if (!editable) return;
    const today = todayIso();
    if (action === 'assign-me') {
      if (task.assigneeId === userId) return;
      const previous = task.assigneeId;
      void taskOps.updateTask(task.id, { assigneeId: userId });
      toast.undo(`Assigned ${task.key} to you`, { onUndo: () => void taskOps.updateTask(task.id, { assigneeId: previous }) });
    } else if (action === 'due-today' || action === 'due-tomorrow') {
      const dueDate = action === 'due-today' ? today : addDaysIso(today, 1);
      if (task.dueDate === dueDate) return;
      const previous = task.dueDate;
      void taskOps.updateTask(task.id, { dueDate });
      toast.undo(`${task.key} is due ${action === 'due-today' ? 'today' : 'tomorrow'}`, { onUndo: () => void taskOps.updateTask(task.id, { dueDate: previous }) });
    } else if (action === 'toggle-done') {
      const closed = task.statusCategory === 'done' || task.statusCategory === 'cancelled';
      const target = closed
        ? (list.find((status) => status.isDefault && status.category !== 'done' && status.category !== 'cancelled') ?? list.find((status) => status.category === 'todo'))
        : list.find((status) => status.category === 'done');
      if (!target) return;
      void toggleDoneWithUndo({ taskKey: task.key, closing: !closed, target: target.id, previous: task.statusId, save: (statusId) => taskOps.updateTask(task.id, { statusId }) });
    }
  }, []);

  useEffect(() => {
    let lastG = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey) return;
      const target = event.target as Element | null;
      if (isEditableTarget(target)) return;
      if (event.metaKey || event.ctrlKey) {
        // Ctrl/Cmd+Enter (done) and Ctrl/Cmd+. (copy link) act on the cursor task.
        const action = taskKeyAction(event);
        if (!action || keyboardIsBusy()) return;
        if (target instanceof Element && target.closest('[data-task-panel]')) return;
        const here = current();
        const task = here ? latest.current.tasks.find((entry) => entry.key === here.dataset.taskKey) : undefined;
        if (!task) return;
        event.preventDefault();
        runAction(action, task);
        return;
      }
      // "g then p" and friends belong to the shell's go-to chords.
      if (event.key === 'g') {
        lastG = Date.now();
        return;
      }
      if (Date.now() - lastG < 900) {
        lastG = 0;
        return;
      }
      if (target instanceof Element && target.closest('[data-task-panel]')) return;
      if (keyboardIsBusy()) return;
      const root = rootRef.current;
      if (!root) return;
      // Focus on some other control of the page (a toolbar button…) keeps its own arrows.
      const onPage = !(target instanceof HTMLElement) || target === document.body || root.contains(target);
      const key = event.key;
      const list = items();
      if (!list.length) return;
      const here = current();
      const index = here ? list.indexOf(here) : -1;

      // j / k are the views' page-level `useTaskNav`; arrows with nothing focused land here.
      const vertical = (key === 'ArrowDown' || key === 'ArrowUp') && onPage && !here?.contains(document.activeElement);
      if (vertical) {
        const delta = key === 'ArrowDown' ? 1 : -1;
        event.preventDefault();
        if (mode === 'board' && here) {
          const cell = here.closest(CELL_SELECTOR);
          const column = cell ? Array.from(cell.querySelectorAll<HTMLElement>(ITEM_SELECTOR.board)).filter(visible) : list;
          moveTo(column[stepIndex(column.indexOf(here), delta, column.length)]);
          return;
        }
        moveTo(list[stepIndex(index, delta, list.length)]);
        return;
      }

      if (mode === 'board' && (key === 'h' || (key === 'l' && !event.shiftKey) || ((key === 'ArrowLeft' || key === 'ArrowRight') && onPage))) {
        event.preventDefault();
        if (!here) {
          moveTo(list[0]);
          return;
        }
        const cells = Array.from(root.querySelectorAll<HTMLElement>(CELL_SELECTOR)).filter(visible);
        const cell = here.closest<HTMLElement>(CELL_SELECTOR);
        const from = cell ? cells.indexOf(cell) : -1;
        if (from < 0) return;
        const boxes = cells.map((element) => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, count: element.querySelectorAll(ITEM_SELECTOR.board).length };
        });
        const to = neighbourCell(boxes, from, key === 'h' || key === 'ArrowLeft' ? -1 : 1);
        if (to < 0) return;
        const column = Array.from(cells[to]?.querySelectorAll<HTMLElement>(ITEM_SELECTOR.board) ?? []).filter(visible);
        const row = cell ? Array.from(cell.querySelectorAll<HTMLElement>(ITEM_SELECTOR.board)).indexOf(here) : 0;
        moveTo(column[Math.min(Math.max(row, 0), column.length - 1)]);
        return;
      }

      if (!here) return;
      const task = latest.current.tasks.find((entry) => entry.key === here.dataset.taskKey);
      if (!task) return;

      if (key === 'Enter' && document.activeElement !== here) {
        event.preventDefault();
        latest.current.onOpen(task);
        return;
      }

      const quick = taskKeyAction(event);
      if (quick === 'assign-me' || quick === 'due-today' || quick === 'due-tomorrow') {
        if (!latest.current.canEdit) return;
        event.preventDefault();
        mark(task.key);
        runAction(quick, task);
        return;
      }
      const field = fieldForKey(key);
      if (!field || !latest.current.canEdit) return;
      if (key === 'L' && !event.shiftKey) return;
      event.preventDefault();
      const anchor = Array.from(here.querySelectorAll<HTMLElement>(FIELD_ANCHORS[field])).find(visible) ?? here;
      const box = anchor.getBoundingClientRect();
      mark(task.key);
      setPicker({ field, task, element: here, rect: { left: box.left, top: box.top, width: box.width, height: box.height } });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [current, items, mark, mode, moveTo, rootRef, runAction]);

  if (!picker) return null;
  const { task, field } = picker;
  const close = (open: boolean) => {
    if (open) return;
    const element = picker.element;
    setPicker(null);
    requestAnimationFrame(() => {
      const again = items().find((entry) => entry.dataset.taskKey === task.key) ?? element;
      if (document.contains(again)) again.focus({ preventScroll: true });
    });
  };
  const trigger = (
    <span
      aria-hidden
      data-task-keep-open=""
      style={{ position: 'fixed', left: picker.rect.left, top: picker.rect.top, width: picker.rect.width, height: picker.rect.height, pointerEvents: 'none' }}
    />
  );
  const live = tasks.find((entry) => entry.id === task.id) ?? task;
  const { updateTask, setLabels } = ops;
  const common = { open: true, onOpenChange: close, align: 'start' as const };
  switch (field) {
    case 'status':
      return (
        <StatusPicker {...common} value={live.statusId} onChange={(statusId) => void updateTask(task.id, { statusId })}>
          {trigger}
        </StatusPicker>
      );
    case 'assignee':
      return (
        <AssigneePicker {...common} value={live.assigneeId} onChange={(assigneeId) => void updateTask(task.id, { assigneeId })}>
          {trigger}
        </AssigneePicker>
      );
    case 'priority':
      return (
        <PriorityPicker {...common} value={live.priority} onChange={(priority) => void updateTask(task.id, { priority })}>
          {trigger}
        </PriorityPicker>
      );
    case 'due':
      return (
        <DuePicker {...common} value={live.dueDate} onChange={(dueDate) => void updateTask(task.id, { dueDate })}>
          {trigger}
        </DuePicker>
      );
    case 'labels':
      return (
        <LabelsPicker {...common} value={live.labelIds} onChange={(labelIds) => void setLabels(live, labelIds)}>
          {trigger}
        </LabelsPicker>
      );
  }
}
