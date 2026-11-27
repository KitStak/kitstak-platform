'use client';
/**
 * Top bar pill for a running timer, shown on every page: task key, live elapsed time, a link
 * that opens the task, and a stop button that saves the time. Hidden when no timer runs.
 */
import { Suspense, useEffect, useState } from 'react';
import { toast as sonnerToast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { CircleStop } from 'lucide-react';
import { Tooltip, cn, toast } from '@/components/ui';
import { formatMinutes, timerMinutes } from '@/lib/dates';
import { useRunningTimer, useTask } from '@/lib/hooks/use-data';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { qk } from '@/lib/query-keys';
import type { TimeEntryDTO } from '@/lib/types';
import { stopTimerAction } from '@/server/actions/time';
import { formatClock } from './task-utils';

/** Ask about a running timer after this long with no clicks or keys. */
const IDLE_NUDGE_MS = 45 * 60_000;

/**
 * Idle nudge (like Toggl and ClickUp): after 45 minutes with no clicks or keys in this tab while a
 * timer runs, ask once whether to keep it, so a forgotten timer does not log a bogus hour.
 */
function useIdleNudge(entry: TimeEntryDTO | null) {
  const queryClient = useQueryClient();
  const entryId = entry?.id ?? null;
  const startedAt = entry?.startedAt ?? null;
  useEffect(() => {
    if (!entryId || !startedAt) return;
    const started = new Date(startedAt).getTime();
    let last = Date.now();
    let shown = false;
    const mark = () => {
      last = Date.now();
    };
    const check = () => {
      const idle = Date.now() - Math.max(started, last);
      if (shown || idle < IDLE_NUDGE_MS) return;
      shown = true;
      sonnerToast(`Your timer has run ${Math.round(idle / 60000)} minutes with no activity`, {
        id: `timer-idle-${entryId}`,
        description: 'Keep it running, or stop it and save the time so far.',
        duration: Infinity,
        action: {
          label: 'Stop timer',
          onClick: () => {
            void stopTimerAction().then((result) => {
              if (!result.ok) {
                toast.error("Couldn't stop the timer", result.error.message);
                return;
              }
              queryClient.setQueryData(qk.runningTimer(), null);
              void queryClient.invalidateQueries({ queryKey: qk.runningTimer() });
              void queryClient.invalidateQueries({ queryKey: qk.me() });
            });
          },
        },
        cancel: { label: 'Keep it', onClick: () => undefined },
      });
    };
    window.addEventListener('pointerdown', mark, { passive: true });
    window.addEventListener('keydown', mark);
    const timer = window.setInterval(check, 30_000);
    return () => {
      window.removeEventListener('pointerdown', mark);
      window.removeEventListener('keydown', mark);
      window.clearInterval(timer);
    };
  }, [entryId, startedAt, queryClient]);
}

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
  useIdleNudge(entry);
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
    toast.success(`Logged ${formatMinutes(stopped?.durationMinutes ?? timerMinutes(elapsed))}${task ? ` on ${task.key}` : ''}`);
    queryClient.setQueryData(qk.runningTimer(), null);
    void queryClient.invalidateQueries({ queryKey: qk.runningTimer() });
    void queryClient.invalidateQueries({ queryKey: qk.me() });
    void queryClient.invalidateQueries({ queryKey: ['task'] });
  };

  return (
    <div
      data-testid="topbar-timer"
      data-task-keep-open=""
      // A neutral surface pill: a running timer is not an error, so no crimson and no glow.
      className="flex h-8 shrink-0 items-center rounded-full border border-border-default bg-panel text-fg"
    >
      <Tooltip content={task ? `Timer running on ${task.key}: ${task.title}` : 'Timer running'}>
        <button
          type="button"
          onClick={() => task && openTask(task.key)}
          disabled={!task}
          aria-label={`Timer running on ${label}, ${formatClock(elapsed)}. Open the task`}
          className="flex h-full items-center gap-1.5 rounded-full pr-2.5 pl-2.5 sm:rounded-r-none sm:pr-1.5 text-xs font-semibold outline-none hover:bg-hover active:bg-pressed focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
        >
          <span aria-hidden className="inline-flex size-1.5 shrink-0 rounded-full bg-success" />
          <span className="hidden font-key md:inline">{task?.key ?? ''}</span>
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
            // Phones: the pill opens the task, where the timer can be stopped, so the top bar fits 390px.
            'hidden h-full items-center rounded-r-full border-l sm:flex border-border-default pr-2 pl-1.5 text-icon outline-none hover:bg-hover hover:text-icon-strong active:bg-pressed focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:opacity-60',
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
