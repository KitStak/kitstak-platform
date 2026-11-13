'use client';
/**
 * Page-level J / K for task views (Board, List, Table). The shortcuts sheet promises "Next task J,
 * Previous task K, Open task Enter" in a list or board, so the keys must work before anything has
 * focus: the first press focuses the first task, later presses walk the tasks in screen order.
 * Enter on a focused task is handled by the row or card itself (it opens the drawer); for rows
 * that are not focusable themselves (the table) Enter opens the task from here.
 */
import { useCallback, type RefObject } from 'react';
import { useHotkey } from '@/lib/hooks/use-hotkeys';

/** The element that takes focus for a task: the row or card, or (table) its title cell. */
function focusTarget(node: HTMLElement): HTMLElement {
  if (node.tabIndex >= 0 || node.getAttribute('tabindex') !== null) return node;
  return node.querySelector<HTMLElement>('td[data-col="title"]') ?? node.querySelector<HTMLElement>('[tabindex]') ?? node;
}

export function useTaskNav(
  containerRef: RefObject<HTMLElement | null>,
  options: { readonly enabled?: boolean; readonly onOpen?: (taskKey: string) => void; readonly focusTask?: (node: HTMLElement) => void } = {},
) {
  const { enabled = true, onOpen, focusTask } = options;
  const items = useCallback(() => Array.from(containerRef.current?.querySelectorAll<HTMLElement>('[data-task-key]') ?? []).filter((node) => node.offsetParent !== null), [containerRef]);

  const current = useCallback((list: readonly HTMLElement[]) => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return -1;
    return list.findIndex((node) => node === active || node.contains(active));
  }, []);

  const move = useCallback(
    (step: 1 | -1) => {
      const list = items();
      if (list.length === 0) return;
      const index = current(list);
      const next = index < 0 ? (step === 1 ? list[0] : list.at(-1)) : list[Math.min(list.length - 1, Math.max(0, index + step))];
      if (!next) return;
      if (focusTask) focusTask(next);
      else focusTarget(next).focus();
      next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    },
    [current, focusTask, items],
  );

  useHotkey('j', () => move(1), { enabled });
  useHotkey('k', () => move(-1), { enabled });
  useHotkey(
    'Enter',
    () => {
      const list = items();
      const node = list[current(list)];
      if (node?.dataset.taskKey && onOpen) onOpen(node.dataset.taskKey);
    },
    { enabled: enabled && Boolean(onOpen), preventDefault: false },
  );
}
