'use client';
/**
 * Top bar pill for a running timer, shown on every page: task key, live elapsed time, a link
 * that opens the task, and a stop button that saves the time. Hidden when no timer runs.
 */
import { Suspense, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleStop } from 'lucide-react';
import { Tooltip, cn, toast } from '@/components/ui';
import { formatMinutes } from '@/lib/dates';
import { useRunningTimer, useTask } from '@/lib/hooks/use-data';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { qk } from '@/lib/query-keys';
import type { TimeEntryDTO } from '@/lib/types';
import { stopTimerAction } from '@/server/actions/time';
import { formatClock } from './task-utils';

function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/** Key and title of the task a timer runs on (shared by the pill and the time section). */
export function useTimerTask(entry: TimeEntryDTO | null | undefined) {
  // The running-timer payload carries the task key and title; fetch the task only if it doesn't.
  const task = useTask(entry?.taskId, { enabled: Boolean(entry?.taskId) && !entry?.task, staleTime: 60_000 });
  if (entry?.task) return entry.task;
  return task.data ? { key: task.data.key, title: task.data.title } : null;
}

function Pill() {
  const queryClient = useQueryClient();
  const running = useRunningTimer({ refetchInterval: 60_000, refetchOnWindowFocus: true });
  const entry = running.data ?? null;
  const task = useTimerTask(entry);
  const { openTask } = useTaskDrawer();
  const now = useTick(Boolean(entry));
  const [stopping, setStopping] = useState(false);
  if (!entry) return null;
  const elapsed = now - new Date(entry.startedAt).getTime();
  const label = task ? `${task.key} ${task.title}` : 'your task';

  const stop = async () => {
    setStopping(true);
    const result = await stopTimerAction();
    setStopping(false);
    if (!result.ok) {
      toast.error("Couldn't stop the timer", result.error.message);
      return;
    }
    const stopped = result.data as TimeEntryDTO | null;
    toast.success(`Logged ${formatMinutes(stopped?.durationMinutes ?? Math.floor(elapsed / 60000))}${task ? ` on ${task.key}` : ''}`);
    queryClient.setQueryData(qk.runningTimer(), null);
    void queryClient.invalidateQueries({ queryKey: qk.runningTimer() });
    void queryClient.invalidateQueries({ queryKey: qk.me() });
    void queryClient.invalidateQueries({ queryKey: ['task'] });
  };

  return (
    <div
      data-testid="topbar-timer"
      data-task-keep-open=""
      className="flex h-8 shrink-0 items-center rounded-full border border-danger/40 bg-danger-subtle text-danger-text"
    >
      <Tooltip content={task ? `Timer running on ${task.key}: ${task.title}` : 'Timer running'}>
        <button
          type="button"
          onClick={() => task && openTask(task.key)}
          disabled={!task}
          aria-label={`Timer running on ${label}, ${formatClock(elapsed)}. Open the task`}
          className="flex h-full items-center gap-1.5 rounded-l-full pr-1.5 pl-2.5 text-xs font-semibold outline-none hover:bg-[color-mix(in_srgb,var(--danger-subtle),var(--danger)_10%)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
        >
          <span aria-hidden className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-60 motion-reduce:hidden" />
            <span className="relative inline-flex size-2 rounded-full bg-danger" />
          </span>
          <span className="hidden font-mono md:inline">{task?.key ?? ''}</span>
          <span className="tabular-nums">{formatClock(elapsed)}</span>
        </button>
      </Tooltip>
      <Tooltip content="Stop and save the time">
        <button
          type="button"
          onClick={() => void stop()}
          disabled={stopping}
          aria-label={`Stop the timer on ${label}`}
          data-testid="topbar-timer-stop"
          className={cn(
            'flex h-full items-center rounded-r-full border-l border-danger/30 pr-2 pl-1.5 outline-none hover:bg-[color-mix(in_srgb,var(--danger-subtle),var(--danger)_10%)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:opacity-60',
          )}
        >
          <CircleStop aria-hidden className="size-4" />
        </button>
      </Tooltip>
    </div>
  );
}

export function RunningTimerPill() {
  return (
    <Suspense fallback={null}>
      <Pill />
    </Suspense>
  );
}
