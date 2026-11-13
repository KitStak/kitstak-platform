'use client';
/**
 * Task drawer URL state: `?task=OPS-42` on any page opens the task drawer over it (shareable,
 * back-button friendly). Views call `openTask(task.key)`; the full page is routes.task(key, n).
 */
import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { TASK_DRAWER_PARAM } from '@/lib/routes';

export function useTaskDrawer() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get(TASK_DRAWER_PARAM);

  const hrefWith = useCallback(
    (taskKey: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (taskKey) next.set(TASK_DRAWER_PARAM, taskKey);
      else next.delete(TASK_DRAWER_PARAM);
      const qs = next.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [params, pathname],
  );

  const openTask = useCallback((taskKey: string) => router.push(hrefWith(taskKey), { scroll: false }), [hrefWith, router]);
  const closeTask = useCallback(() => router.push(hrefWith(null), { scroll: false }), [hrefWith, router]);

  // `open` / `close` are aliases (task drawer contract): open(taskKeyOrUuid).
  return { taskKey: current, openTask, closeTask, open: openTask, close: closeTask, hrefFor: hrefWith } as const;
}
