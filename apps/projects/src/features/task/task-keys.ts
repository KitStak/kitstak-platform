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
import { toast } from '@/components/ui';
import { routes } from '@/lib/routes';

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
