'use client';
/**
 * Time tracking: a start/stop timer that keeps running when you close the task or reload (it is
 * stored on the server; starting one stops any other), manual entries ("1h 30m" yesterday,
 * billable or not), every entry with who logged it, and the total against the estimate.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CirclePlay, CircleStop, Clock, Hand, Plus, Timer, Trash2 } from 'lucide-react';
import {
  Button,
  Checkbox,
  IconButton,
  IsoDatePicker,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ProgressBar,
  Skeleton,
  Tooltip,
  cn,
  toast,
} from '@/components/ui';
import { PersonAvatar } from '@/components/pm';
import { formatDue, formatMinutes, formatRelative, todayIso } from '@/lib/dates';
import { useRunningTimer, useTaskTime } from '@/lib/hooks/use-data';
import { usePeopleMap } from '@/lib/hooks/use-people';
import { qk } from '@/lib/query-keys';
import type { TaskDetail, TimeEntryDTO } from '@/lib/types';
import {
  addManualTimeAction,
  deleteTimeEntryAction,
  startTimerAction,
  stopTimerAction,
} from '@/server/actions/time';
import { useShell } from '@/features/shell/shell-context';
import { SectionHeading } from './property-row';
import { useTaskContext } from './task-context';
import { formatClock, parseDuration } from './task-utils';
import { LocalTime } from './local-time';
import { useTimerTask } from './running-timer-pill';

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

function ManualEntry({ onDone }: { readonly onDone: () => void }) {
  const { task, refresh } = useTaskContext();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState('');
  const [date, setDate] = useState<string | null>(todayIso());
  const [note, setNote] = useState('');
  const [billable, setBillable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const minutes = parseDuration(duration);
    if (!minutes) {
      setError('Try a time like 45m, 1h 30m or 2:15.');
      return;
    }
    if (minutes > 1440) {
      setError('One entry can be up to 24 hours.');
      return;
    }
    setSaving(true);
    const result = await addManualTimeAction({
      taskId: task.id,
      minutes,
      date: date ?? undefined,
      note: note.trim() || null,
      billable,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    toast.success(`Logged ${formatMinutes(minutes)} on ${task.key}`);
    setOpen(false);
    setDuration('');
    setNote('');
    void queryClient.invalidateQueries({ queryKey: qk.taskTime(task.id) });
    refresh();
    onDone();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setError(null);
          setDate(todayIso());
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="secondary" leadingIcon={<Plus aria-hidden />}>
          Log time
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px]" aria-label="Log time">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="task-time-duration" className="text-xs font-semibold text-fg-secondary">
              How long did you work?
            </label>
            <input
              id="task-time-duration"
              autoFocus
              value={duration}
              onChange={(event) => {
                setDuration(event.target.value);
                setError(null);
              }}
              placeholder="e.g. 1h 30m"
              aria-invalid={error ? true : undefined}
              className="h-8 rounded-sm border border-border-input bg-panel px-2.5 text-sm text-fg outline-none placeholder:text-fg-placeholder focus:border-primary focus:shadow-[0_0_0_3px_var(--focus-ring-soft)] aria-[invalid=true]:border-danger"
            />
            <div className="flex flex-wrap gap-1">
              {['15m', '30m', '1h', '2h', '4h'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setDuration(preset);
                    setError(null);
                  }}
                  className={cn(
                    'h-6 rounded-full border px-2 text-2xs font-medium transition-colors',
                    duration === preset
                      ? 'border-primary bg-primary-subtle text-primary-text'
                      : 'border-border-subtle text-fg-secondary hover:bg-hover',
                  )}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-fg-secondary">Day</span>
            <IsoDatePicker value={date} onChange={setDate} placeholder="Today" aria-label="Day worked" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="task-time-note" className="text-xs font-semibold text-fg-secondary">
              Note <span className="font-normal text-fg-muted">(optional)</span>
            </label>
            <input
              id="task-time-note"
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What did you do?"
              className="h-8 rounded-sm border border-border-input bg-panel px-2.5 text-sm text-fg outline-none placeholder:text-fg-placeholder focus:border-primary focus:shadow-[0_0_0_3px_var(--focus-ring-soft)]"
            />
          </div>
          <Checkbox
            checked={billable}
            onCheckedChange={(checked) => setBillable(checked === true)}
            label="Billable to the client"
            size="sm"
          />
          {error ? (
            <p role="alert" className="text-xs text-danger-text">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-1.5">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={saving}>
              Log time
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function EntryRow({ entry, onDelete }: { readonly entry: TimeEntryDTO; readonly onDelete?: () => void }) {
  const people = usePeopleMap();
  const running = entry.endedAt === null;
  const now = useNow(running);
  const minutes = running
    ? Math.floor((now - new Date(entry.startedAt).getTime()) / 60000)
    : (entry.durationMinutes ?? 0);
  return (
    <li className="group/time flex min-h-9 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-hover">
      <PersonAvatar userId={entry.userId} size="xs" decorative />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-fg">
          <span className="font-medium">{people.get(entry.userId)?.name ?? 'Former member'}</span>
          {entry.note ? <span className="text-fg-secondary"> · {entry.note}</span> : null}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 overflow-hidden text-2xs whitespace-nowrap text-fg-muted">
          {entry.source === 'timer' ? (
            <Timer aria-hidden className="size-3" />
          ) : (
            <Hand aria-hidden className="size-3" />
          )}
          {running ? 'Timer running' : entry.source === 'timer' ? 'Timer' : 'Added by hand'}
          {' · '}
          <LocalTime iso={entry.startedAt}>
            {entry.source === 'manual'
              ? formatDue(entry.startedAt.slice(0, 10))
              : formatRelative(entry.startedAt)}
          </LocalTime>
          {entry.billable ? (
            <span className="rounded-xs bg-success-subtle px-1 font-medium text-success-text">Billable</span>
          ) : null}
        </span>
      </span>
      <span
        className={cn(
          'shrink-0 text-sm font-semibold tabular-nums',
          running ? 'text-danger-text' : 'text-fg',
        )}
      >
        {minutes < 1 ? 'under 1m' : formatMinutes(minutes)}
      </span>
      {onDelete && !running ? (
        <IconButton
          size="sm"
          label="Delete this entry"
          icon={<Trash2 aria-hidden />}
          onClick={onDelete}
          className="opacity-0 group-hover/time:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
        />
      ) : (
        <span className="w-7 shrink-0" />
      )}
    </li>
  );
}

const noopSubscribe = () => () => undefined;

export function TimeSection() {
  const { task, canLogTime, refresh, live, openTask } = useTaskContext();
  const { user } = useShell();
  const queryClient = useQueryClient();
  const entries = useTaskTime(task.id, { enabled: live });
  const running = useRunningTimer();
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const mine = task.runningTimer ?? (running.data && running.data.taskId === task.id ? running.data : null);
  // The running-timer cache can be filled before hydration (shell prefetch), so only show the
  // "running on another task" note after mount to keep server and client markup identical.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const elsewhere = hydrated && running.data && running.data.taskId !== task.id ? running.data : null;
  const elsewhereTask = useTimerTask(elsewhere);
  const now = useNow(Boolean(mine));
  const elapsedMs = mine ? now - new Date(mine.startedAt).getTime() : 0;
  const runningMinutes = mine ? Math.floor(elapsedMs / 60000) : 0;
  const total = task.timeTotalMinutes + runningMinutes;
  const estimate = task.estimateMinutes;
  const over = estimate !== null && total > estimate;
  const list = entries.data ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: qk.taskTime(task.id) });
    void queryClient.invalidateQueries({ queryKey: qk.runningTimer() });
    void queryClient.invalidateQueries({ queryKey: qk.me() });
    refresh();
  };

  /**
   * Optimistic: the button, the elapsed clock, the top bar pill and the "running on" note flip in
   * the same frame as the click, and the toast shows right away. A failed save puts it all back.
   */
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const isDetail = (key: readonly unknown[]) => key[0] === 'task' && key.length === 2;
    const saved = [
      ...queryClient.getQueriesData({ predicate: (query) => isDetail(query.queryKey) }),
      [qk.runningTimer(), queryClient.getQueryData(qk.runningTimer())] as const,
      [qk.taskTime(task.id), queryClient.getQueryData(qk.taskTime(task.id))] as const,
    ];
    const stopping = Boolean(mine);
    const loggedMinutes = Math.max(1, runningMinutes);
    const optimistic: TimeEntryDTO | null = stopping
      ? null
      : {
          id: `optimistic-${task.id}`,
          projectId: task.projectId,
          taskId: task.id,
          userId: user.id,
          startedAt: new Date().toISOString(),
          endedAt: null,
          durationMinutes: null,
          note: null,
          billable: false,
          source: 'timer',
        };
    queryClient.setQueryData(qk.runningTimer(), optimistic);
    const endedAt = new Date().toISOString();
    queryClient.setQueryData<TimeEntryDTO[]>(qk.taskTime(task.id), (rows) => {
      if (!Array.isArray(rows)) return rows;
      if (optimistic) return [optimistic, ...rows];
      return rows.map((row) => (row.endedAt === null && row.userId === user.id ? { ...row, endedAt, durationMinutes: loggedMinutes } : row));
    });
    queryClient.setQueriesData<TaskDetail>({ predicate: (query) => isDetail(query.queryKey) }, (detail) => {
      if (!detail || typeof detail !== 'object' || !('runningTimer' in detail)) return detail;
      if (detail.id === task.id) {
        return { ...detail, runningTimer: optimistic, timeTotalMinutes: stopping ? detail.timeTotalMinutes + loggedMinutes : detail.timeTotalMinutes };
      }
      return detail.runningTimer ? { ...detail, runningTimer: null } : detail;
    });
    const toastId = stopping
      ? toast.success(`Logged ${formatMinutes(loggedMinutes)} on ${task.key}`)
      : elsewhere
        ? toast.info('Timer moved here', `We stopped and saved the timer on ${elsewhereTask?.key ?? 'your other task'}.`)
        : null;
    const result = stopping ? await stopTimerAction() : await startTimerAction({ taskId: task.id });
    setBusy(false);
    if (!result.ok) {
      for (const [key, data] of saved) queryClient.setQueryData(key, data);
      if (toastId !== null) toast.dismiss(toastId);
      toast.error(stopping ? "Couldn't stop the timer" : "Couldn't start the timer", result.error.message);
      return;
    }
    if (!stopping) queryClient.setQueryData(qk.runningTimer(), result.data as TimeEntryDTO | null);
    invalidate();
  };

  const remove = async (entry: TimeEntryDTO) => {
    const result = await deleteTimeEntryAction({ entryId: entry.id });
    if (!result.ok) {
      toast.error("Couldn't delete that entry", result.error.message);
      return;
    }
    toast.success(`Removed ${formatMinutes(entry.durationMinutes)} from ${task.key}`);
    invalidate();
  };

  if (!canLogTime && task.timeTotalMinutes === 0 && list.length === 0) return null;

  const shown = showAll ? list : list.slice(0, 4);

  return (
    <section aria-labelledby="task-time-heading" data-testid="task-time">
      <SectionHeading
        id="task-time-heading"
        icon={<Clock aria-hidden />}
        actions={canLogTime ? <ManualEntry onDone={() => undefined} /> : null}
      >
        Time
      </SectionHeading>
      <div className="mt-1.5 flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-panel p-3">
        {canLogTime ? (
          <Tooltip
            content={
              mine
                ? 'Stop and save the time'
                : elsewhere
                  ? 'Starts here and stops your other timer'
                  : 'Start a timer for this task'
            }
          >
            <button
              type="button"
              onClick={() => void toggle()}
              aria-busy={busy}
              data-testid="task-timer-toggle"
              aria-pressed={Boolean(mine)}
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60',
                mine
                  ? 'border border-danger bg-danger-subtle text-danger-text hover:bg-[color-mix(in_srgb,var(--danger-subtle),var(--danger)_12%)]'
                  : 'bg-primary text-primary-fg hover:bg-primary-hover',
              )}
            >
              {mine ? (
                <span aria-hidden className="relative flex size-2.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-60 motion-reduce:hidden" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-danger" />
                </span>
              ) : (
                <CirclePlay aria-hidden className="size-4" />
              )}
              {mine ? (
                <>
                  <span className="tabular-nums">{formatClock(elapsedMs)}</span>
                  <CircleStop aria-hidden className="size-4" />
                  <span className="sr-only">Stop timer</span>
                </>
              ) : (
                'Start timer'
              )}
            </button>
          </Tooltip>
        ) : null}
        <div className="min-w-[160px] flex-1">
          <p className="text-sm text-fg">
            <span className="font-semibold tabular-nums">{formatMinutes(total)}</span>{' '}
            <span className="text-fg-secondary">
              {estimate !== null ? `of ${formatMinutes(estimate)} estimated` : 'logged'}
            </span>
          </p>
          {estimate !== null && estimate > 0 ? (
            <ProgressBar
              value={Math.min(100, (total / estimate) * 100)}
              label={`${Math.round((total / estimate) * 100)}% of the estimate used`}
              size="sm"
              tone={over ? 'danger' : total / estimate > 0.8 ? 'warning' : 'success'}
              className="mt-1.5"
            />
          ) : (
            <p className="text-2xs text-fg-muted">Add a time estimate above to compare.</p>
          )}
          {over ? (
            <p className="mt-1 text-2xs font-medium text-danger-text">
              {formatMinutes(total - (estimate ?? 0))} over the estimate
            </p>
          ) : null}
        </div>
      </div>
      {elsewhere && canLogTime ? (
        <p className="mt-1.5 text-xs text-fg-muted">
          <Timer aria-hidden className="mr-1 inline size-3.5 align-[-2px]" />
          Your timer is running on{' '}
          {elsewhereTask ? (
            // A link, not a button: buttons are atomic inline blocks and break the sentence apart.
            <a
              href={`?task=${encodeURIComponent(elsewhereTask.key)}`}
              onClick={(event) => {
                event.preventDefault();
                openTask(elsewhereTask.key);
              }}
              className="font-medium text-fg-link hover:underline focus-visible:outline-2 focus-visible:outline-focus"
              data-testid="task-timer-elsewhere"
            >
              {elsewhereTask.key} {elsewhereTask.title}
            </a>
          ) : (
            'another task'
          )}
          . Starting here stops and saves it.
        </p>
      ) : null}
      {entries.isLoading ? (
        <div className="mt-2 flex flex-col gap-1.5">
          <Skeleton height={32} />
          <Skeleton height={32} />
        </div>
      ) : list.length ? (
        <>
          <ul className="mt-1.5 flex flex-col" aria-label="Time entries">
            {shown.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                onDelete={entry.userId === user.id ? () => void remove(entry) : undefined}
              />
            ))}
          </ul>
          {list.length > 4 ? (
            <button
              type="button"
              className="mt-0.5 px-1.5 text-xs font-medium text-fg-link hover:underline"
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll ? 'Show fewer' : `Show all ${list.length} entries`}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
