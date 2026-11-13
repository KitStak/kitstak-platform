'use client';
/**
 * Previous / next task for the drawer and the task page (↑/↓ or j/k). Order = what you see:
 * every view marks its rows/cards with `data-task-key`, so we read the visible order from the
 * page (board columns left to right, list/table top to bottom). On a page without a task list
 * (Home, the full task page) we fall back to the project's top-level tasks by status, then rank.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { compareRank } from '@/lib/rank';
import { useProjectTasks } from '@/lib/hooks/use-data';
import type { StatusDTO } from '@/lib/types';

/** Attribute the drawer puts on itself so its own rows are not counted. */
export const TASK_PANEL_ATTR = 'data-task-panel';

export function visibleTaskKeys(): string[] {
  if (typeof document === 'undefined') return [];
  const seen = new Set<string>();
  const out: string[] = [];
  document.querySelectorAll<HTMLElement>('[data-task-key]').forEach((element) => {
    if (element.closest(`[${TASK_PANEL_ATTR}]`)) return;
    const key = element.dataset.taskKey;
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  });
  return out;
}

export interface TaskNeighbours {
  readonly index: number;
  readonly total: number;
  readonly prev: string | null;
  readonly next: string | null;
}

export function useTaskNeighbours(
  taskKey: string,
  projectKey: string,
  statuses: readonly StatusDTO[],
  { preferPage = true }: { readonly preferPage?: boolean } = {},
): TaskNeighbours & { refreshList: () => string[] } {
  const [domKeys, setDomKeys] = useState<string[]>([]);
  const tasks = useProjectTasks(projectKey, { staleTime: 30_000 });

  const fallback = useMemo(() => {
    const order = new Map(statuses.map((status, index) => [status.id, index]));
    return (tasks.data ?? [])
      .filter((task) => !task.parentTaskId)
      .sort(
        (a, b) =>
          (order.get(a.statusId) ?? 0) - (order.get(b.statusId) ?? 0) || compareRank(a.position, b.position),
      )
      .map((task) => task.key);
  }, [statuses, tasks.data]);

  const refreshList = useCallback(() => {
    const keys = preferPage ? visibleTaskKeys() : [];
    setDomKeys(keys);
    return keys.includes(taskKey) ? keys : fallback;
  }, [fallback, preferPage, taskKey]);

  useEffect(() => {
    // Reads the rendered page (an external system) after each change of task / list.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshList();
  }, [refreshList]);

  const list = domKeys.includes(taskKey) ? domKeys : fallback;
  const index = list.indexOf(taskKey);
  return {
    index,
    total: list.length,
    prev: index > 0 ? list[index - 1] : null,
    next: index >= 0 && index < list.length - 1 ? list[index + 1] : null,
    refreshList,
  };
}
