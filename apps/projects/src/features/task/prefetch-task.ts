'use client';
/**
 * Warm the task drawer before it opens: hovering (or keyboard-focusing) any `[data-task-key]`
 * row or card for a moment fetches the task and, in parallel once its id is known, its comments,
 * history, time and files. The drawer then paints at once instead of filling in section by
 * section. Mounted once by the drawer host.
 */
import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiGet, apiPath } from '@/lib/api-client';
import type { ActivityPage } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import type { AttachmentDTO, CommentDTO, TaskDetail, TimeEntryDTO } from '@/lib/types';
import { TASK_PANEL_ATTR } from './task-nav';

const HOVER_MS = 120;
const FRESH_MS = 20_000;

export async function prefetchTask(queryClient: QueryClient, taskKey: string): Promise<void> {
  const detail = await queryClient
    .fetchQuery({
      queryKey: qk.task(taskKey),
      queryFn: () => apiGet<TaskDetail>(apiPath(`tasks/${encodeURIComponent(taskKey)}`)),
      staleTime: FRESH_MS,
    })
    .catch(() => null);
  if (!detail) return;
  const id = detail.id;
  const warm = <T,>(queryKey: readonly unknown[], path: string) =>
    queryClient.prefetchQuery({ queryKey, queryFn: () => apiGet<T>(apiPath(path)), staleTime: FRESH_MS });
  await Promise.all([
    warm<CommentDTO[]>(qk.taskComments(id), `tasks/${id}/comments`),
    warm<ActivityPage>(qk.taskActivity(id), `tasks/${id}/activity`),
    warm<TimeEntryDTO[]>(qk.taskTime(id), `tasks/${id}/time`),
    warm<AttachmentDTO[]>(qk.taskAttachments(id), `tasks/${id}/attachments`),
  ]);
}

export function useTaskPrefetch(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    let timer: number | null = null;
    let pending: string | null = null;
    const done = new Map<string, number>();
    const schedule = (target: EventTarget | null, delay: number) => {
      const element = (target as Element | null)?.closest?.<HTMLElement>('[data-task-key]');
      const key = element?.dataset.taskKey;
      if (!key || element.closest(`[${TASK_PANEL_ATTR}]`)) return;
      if (key === pending) return;
      const last = done.get(key);
      if (last && Date.now() - last < FRESH_MS) return;
      if (timer) window.clearTimeout(timer);
      pending = key;
      timer = window.setTimeout(() => {
        timer = null;
        pending = null;
        done.set(key, Date.now());
        void prefetchTask(queryClient, key);
      }, delay);
    };
    const onOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      schedule(event.target, HOVER_MS);
    };
    const onFocus = (event: FocusEvent) => schedule(event.target, HOVER_MS * 2);
    document.addEventListener('pointerover', onOver, { passive: true });
    document.addEventListener('focusin', onFocus);
    return () => {
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('focusin', onFocus);
    };
  }, [queryClient]);
}
