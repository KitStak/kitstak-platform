'use client';
/**
 * Focus mode: one task at a time from today's and overdue work, most urgent first.
 * Done (D) · Tomorrow (T) · Skip (S) · Open details (O). Finishing the list ends with a cheer.
 */
import { useMemo, useState } from 'react';
import { ArrowRight, Check, CornerUpRight, PartyPopper, Sunrise } from 'lucide-react';
import { Button, Dialog, DialogContent, Kbd, ProgressBar, cn, useModKey } from '@/components/ui';
import { DueDate, EntityIcon, PersonAvatar, PriorityIcon } from '@/components/pm';
import { PRIORITY_LABELS } from '@/lib/constants';
import { addDaysIso, todayIso } from '@/lib/dates';
import { useHotkey } from '@/lib/hooks/use-hotkeys';
import type { ProjectSummary, TaskSummary } from '@/lib/types';

export function FocusMode({
  open,
  onOpenChange,
  queue,
  projects,
  onComplete,
  onReschedule,
  onOpenTask,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Snapshot taken when focus mode starts. */
  readonly queue: readonly TaskSummary[];
  readonly projects: ReadonlyMap<string, ProjectSummary>;
  readonly onComplete: (task: TaskSummary) => Promise<boolean>;
  readonly onReschedule: (task: TaskSummary, date: string) => Promise<unknown>;
  readonly onOpenTask: (task: TaskSummary) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <FocusBody
          key={queue.map((t) => t.id).join(',')}
          queue={queue}
          projects={projects}
          onComplete={onComplete}
          onReschedule={onReschedule}
          onOpenTask={onOpenTask}
          onClose={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog>
  );
}

type Outcome = 'done' | 'tomorrow' | 'skipped';

function FocusBody({
  queue,
  projects,
  onComplete,
  onReschedule,
  onOpenTask,
  onClose,
}: {
  readonly queue: readonly TaskSummary[];
  readonly projects: ReadonlyMap<string, ProjectSummary>;
  readonly onComplete: (task: TaskSummary) => Promise<boolean>;
  readonly onReschedule: (task: TaskSummary, date: string) => Promise<unknown>;
  readonly onOpenTask: (task: TaskSummary) => void;
  readonly onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<Readonly<Record<string, Outcome>>>({});
  const [busy, setBusy] = useState(false);
  const task = queue[index];
  const finished = index >= queue.length;
  const doneCount = useMemo(() => Object.values(outcomes).filter((o) => o === 'done').length, [outcomes]);

  const advance = (outcome: Outcome) => {
    if (!task) return;
    setOutcomes((current) => ({ ...current, [task.id]: outcome }));
    setIndex((i) => i + 1);
  };
  const done = async () => {
    if (!task || busy) return;
    setBusy(true);
    const ok = await onComplete(task);
    setBusy(false);
    if (ok) advance('done');
  };
  const tomorrow = async () => {
    if (!task || busy) return;
    setBusy(true);
    await onReschedule(task, addDaysIso(todayIso(), 1));
    setBusy(false);
    advance('tomorrow');
  };

  const mod = useModKey();
  // Same key map as everywhere else: Ctrl/Cmd+Enter done, Shift+T tomorrow, Enter open.
  // N (next) skips; S stays "status" across the app, so it is not reused here.
  useHotkey('mod+Enter', () => void done(), { allowInDialogs: true, enabled: Boolean(task) });
  useHotkey('shift+t', () => void tomorrow(), { allowInDialogs: true, enabled: Boolean(task) });
  useHotkey('n', () => advance('skipped'), { allowInDialogs: true, enabled: Boolean(task) });
  useHotkey('Enter', () => task && onOpenTask(task), { allowInDialogs: true, enabled: Boolean(task), preventDefault: false });

  const project = task ? projects.get(task.projectId) : undefined;
  const progress = queue.length ? Math.round((Math.min(index, queue.length) / queue.length) * 100) : 100;

  return (
    <DialogContent size="lg" className="overflow-hidden" data-testid="focus-mode" aria-describedby={undefined}>
      <div className="flex items-center gap-3 border-b border-border-subtle px-6 py-4 pr-14">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-fg">Focus mode</h2>
          <p className="text-sm text-fg-muted">One thing at a time. Today’s and overdue work, most urgent first.</p>
        </div>
        <span className="shrink-0 text-sm font-medium text-fg-secondary tabular-nums" aria-live="polite">
          {finished ? `${queue.length} of ${queue.length}` : `${index + 1} of ${queue.length}`}
        </span>
      </div>
      <ProgressBar value={progress} size="sm" tone="success" label="Focus progress" className="[&>div]:rounded-none" />

      {finished || !task ? (
        <div className="flex flex-col items-center gap-3 px-8 py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-success-subtle text-success-text">
            <PartyPopper aria-hidden className="size-7" />
          </span>
          <h3 className="text-xl font-semibold text-fg">{doneCount === queue.length && queue.length > 0 ? 'You cleared your list!' : 'That’s everything for now'}</h3>
          <p className="max-w-md text-sm text-fg-muted">
            You finished {doneCount} {doneCount === 1 ? 'task' : 'tasks'}
            {Object.values(outcomes).some((o) => o === 'tomorrow') ? ` and moved ${Object.values(outcomes).filter((o) => o === 'tomorrow').length} to tomorrow` : ''}. Nice focus.
          </p>
          <Button onClick={onClose} className="mt-2" data-testid="focus-finish">
            Back to My work
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-6 px-6 py-8 sm:px-10" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg-secondary">
            {project ? <EntityIcon icon={project.icon} color={project.color} size={20} /> : null}
            <span className="font-medium">{project?.name ?? task.projectKey}</span>
            <span className="text-fg-muted">· {task.key}</span>
          </div>
          <h3 className="text-2xl leading-8 font-semibold tracking-[-0.01em] text-fg" data-testid="focus-title">
            {task.title}
          </h3>
          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div className="flex items-center gap-2">
              <dt className="text-fg-muted">Due</dt>
              <dd>
                <DueDate date={task.dueDate} />
              </dd>
            </div>
            {task.priority !== 'none' ? (
              <div className="flex items-center gap-2">
                <dt className="text-fg-muted">Priority</dt>
                <dd className="flex items-center gap-1.5 text-fg">
                  <PriorityIcon priority={task.priority} /> {PRIORITY_LABELS[task.priority]}
                </dd>
              </div>
            ) : null}
            {task.subtaskCount > 0 ? (
              <div className="flex items-center gap-2">
                <dt className="text-fg-muted">Subtasks</dt>
                <dd className="text-fg tabular-nums">
                  {task.subtaskDoneCount} of {task.subtaskCount} done
                </dd>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <dt className="text-fg-muted">Owner</dt>
              <dd>
                <PersonAvatar userId={task.assigneeId} size="xs" showName />
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="lg" leadingIcon={<Check aria-hidden />} onClick={() => void done()} loading={busy} data-testid="focus-done">
              Mark done <Kbd tone="inverse" className="ml-1">{mod}</Kbd><Kbd tone="inverse">Enter</Kbd>
            </Button>
            <Button size="lg" variant="secondary" leadingIcon={<Sunrise aria-hidden />} onClick={() => void tomorrow()} disabled={busy} data-testid="focus-tomorrow">
              Do it tomorrow <Kbd className="ml-1">Shift</Kbd><Kbd>T</Kbd>
            </Button>
            <Button size="lg" variant="ghost" leadingIcon={<CornerUpRight aria-hidden />} onClick={() => advance('skipped')} disabled={busy} data-testid="focus-skip">
              Skip <Kbd className="ml-1">N</Kbd>
            </Button>
            <Button variant="ghost" trailingIcon={<ArrowRight aria-hidden />} onClick={() => onOpenTask(task)} className="ml-auto">
              Open details <Kbd className="ml-1">Enter</Kbd>
            </Button>
          </div>
          <ol className="flex gap-1" aria-label="Your list">
            {queue.map((item, i) => (
              <li
                key={item.id}
                title={item.title}
                className={cn(
                  'h-1.5 flex-1 rounded-full',
                  outcomes[item.id] === 'done' ? 'bg-success' : outcomes[item.id] ? 'bg-border-strong' : i === index ? 'bg-primary' : 'bg-sunken',
                )}
              >
                <span className="sr-only">
                  {item.title}: {outcomes[item.id] ?? (i === index ? 'current' : 'waiting')}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </DialogContent>
  );
}
