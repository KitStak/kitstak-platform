'use client';
/**
 * One key map for every place a task can have the cursor (List, Board, My work, the drawer):
 * the same key always does the same thing. Pages that cannot offer an action (My work has no
 * status menu) simply ignore that key; no page gives a key a different meaning.
 *
 *   J / K, ↓ / ↑   next / previous task          Enter        open it
 *   H / L, ← / →   board: column left / right    X            select it
 *   S status · A assignee · P priority · D due date · # labels
 *   I assign to me · T due today · Shift+T due tomorrow
 *   Ctrl/Cmd+Enter mark done or reopen · Ctrl/Cmd+. copy link · Ctrl/Cmd+Z undo the last change
 */
import { taskToastId, toast } from '@/components/ui';
import { formatDue } from '@/lib/dates';
import { routes } from '@/lib/routes';
import type { TaskPatch } from '@/server/actions/tasks';
import { datePatch, type TaskDates } from './task-utils';

export type TaskKeyAction =
  | 'status'
  | 'assignee'
  | 'priority'
  | 'due'
  | 'labels'
  | 'assign-me'
  | 'due-today'
  | 'due-tomorrow'
  | 'toggle-done'
  | 'copy-link';

/** The action a key press asks for on the cursor task, or null. Pure, unit tested. */
export function taskKeyAction(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'>): TaskKeyAction | null {
  if (event.altKey) return null;
  const mod = event.metaKey || event.ctrlKey;
  if (mod) {
    if (event.key === 'Enter') return 'toggle-done';
    if (event.key === '.') return 'copy-link';
    return null;
  }
  switch (event.key) {
    case 's':
      return 'status';
    case 'a':
      return 'assignee';
    case 'p':
      return 'priority';
    case 'd':
      return 'due';
    case '#':
      return 'labels';
    case 'i':
      return 'assign-me';
    case 't':
      return 'due-today';
    case 'T':
      return event.shiftKey ? 'due-tomorrow' : null;
    default:
      return null;
  }
}

/** Copies a task's link and says so. */
export async function copyTaskLink(task: { readonly key: string; readonly projectKey: string; readonly number: number }): Promise<void> {
  const url = `${window.location.origin}${routes.task(task.projectKey, task.number)}`;
  try {
    await navigator.clipboard.writeText(url);
    toast.success(`Link to ${task.key} copied`);
  } catch {
    toast.error("Couldn't copy the link", url);
  }
}

/* ------------------------------------------------------------------------------------------- */
/* Guard: letter shortcuts that write must never fire by accident.                              */
/* ------------------------------------------------------------------------------------------- */

/** Surfaces that own the keyboard while open (the task drawer itself is not one of them). */
const OVERLAY_SELECTOR =
  '[role="dialog"]:not([data-task-panel]), [role="alertdialog"], [role="menu"], [role="listbox"], [cmdk-root]';
/** How long letters are ignored after a dialog, menu or the palette closes. */
const SETTLE_MS = 300;

let overlayClosedAt = 0;
let writesInFlight = 0;
let watching = false;

function watchOverlays(): void {
  if (watching || typeof document === 'undefined') return;
  watching = true;
  const isOverlay = (node: Node): boolean =>
    node instanceof Element && (node.matches(OVERLAY_SELECTOR) || Boolean(node.querySelector(OVERLAY_SELECTOR)));
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        const target = record.target as Element;
        if (target.getAttribute('data-state') === 'closed' && target.matches(OVERLAY_SELECTOR)) overlayClosedAt = Date.now();
        continue;
      }
      for (const node of record.removedNodes) {
        if (isOverlay(node)) {
          overlayClosedAt = Date.now();
          return;
        }
      }
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state'] });
}

/** Start watching early (call from any hook that handles letter shortcuts). */
export function startLetterKeyGuard(): void {
  watchOverlays();
}

function overlayOpen(): boolean {
  return Boolean(
    document.querySelector(
      '[role="dialog"][data-state="open"]:not([data-task-panel]), [role="alertdialog"], [role="menu"], [cmdk-root]',
    ),
  );
}

/**
 * True while letter shortcuts should be ignored: a dialog, menu or the palette is open or closed
 * less than 300ms ago (keys typed into it must not land on the page), or, with `writes`, a
 * keyboard write is still saving.
 */
export function letterKeysPaused(options: { readonly writes?: boolean } = {}): boolean {
  watchOverlays();
  if (options.writes && writesInFlight > 0) return true;
  return overlayOpen() || Date.now() - overlayClosedAt < SETTLE_MS;
}

/* ------------------------------------------------------------------------------------------- */
/* Writes with Undo                                                                              */
/* ------------------------------------------------------------------------------------------- */

/** Saves a patch; resolves false (or undefined) when the server refused it (already toasted). */
export type TaskSave = (patch: TaskPatch, options?: { readonly toastId?: string | number }) => Promise<unknown>;

/**
 * A keyboard or one-click write: the toast says what changed with Undo right away, the save
 * runs, and when the server refuses it the same toast turns into the error (one toast, no Undo
 * for a change that never happened; the optimistic value is rolled back by the save).
 */
export async function writeWithUndo(input: {
  readonly taskKey: string;
  readonly message: string;
  readonly description?: string;
  readonly patch: TaskPatch;
  readonly undo: TaskPatch;
  readonly save: TaskSave;
}): Promise<boolean> {
  const id = taskToastId(input.taskKey);
  toast.undo(input.message, {
    id,
    description: input.description,
    onUndo: () => void input.save(input.undo, { toastId: id }),
  });
  writesInFlight += 1;
  try {
    const result = await input.save(input.patch, { toastId: id });
    return Boolean(result);
  } finally {
    writesInFlight -= 1;
  }
}

/** "today", "tomorrow", "Fri", "Nov 16" for toast copy. */
export function dayWords(iso: string): string {
  const label = formatDue(iso);
  return label === 'Today' || label === 'Tomorrow' || label === 'Yesterday' ? label.toLowerCase() : label;
}

/**
 * Sets a start or due date with Undo. A date that would put the start after the due date moves
 * the other date along (said in the toast) instead of failing on save.
 */
export function setDateWithUndo(input: {
  readonly task: TaskDates & { readonly key: string };
  readonly field: 'startDate' | 'dueDate';
  readonly value: string | null;
  readonly save: TaskSave;
}): Promise<boolean> {
  const { task, field, value } = input;
  const { patch, moved } = datePatch(task, field, value);
  const undo: TaskPatch = {};
  if ('startDate' in patch) undo.startDate = task.startDate;
  if ('dueDate' in patch) undo.dueDate = task.dueDate;
  const message =
    field === 'dueDate'
      ? value
        ? `${task.key} is due ${dayWords(value)}`
        : `Removed the due date from ${task.key}`
      : value
        ? `${task.key} starts ${dayWords(value)}`
        : `Removed the start date from ${task.key}`;
  const description =
    moved === 'startDate' && value
      ? `The start date moved to ${dayWords(value)} too.`
      : moved === 'dueDate' && value
        ? `The due date moved to ${dayWords(value)} too.`
        : undefined;
  return writeWithUndo({ taskKey: task.key, message, description, patch, undo, save: input.save });
}
