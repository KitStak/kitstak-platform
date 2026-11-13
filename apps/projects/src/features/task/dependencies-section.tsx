'use client';
/**
 * Dependencies in plain words: "Waiting on" (tasks that must finish first) and "Blocking"
 * (tasks waiting on this one). Add with a task picker (loops are refused by the server),
 * remove with one click, and a warning banner (exported) when open tasks still block this one.
 */
import { useMemo, useState } from 'react';
import { Ban, GitBranch, Hourglass, Plus, X } from 'lucide-react';
import {
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ToggleGroup,
  toast,
  cn,
} from '@/components/ui';
import { StatusIcon } from '@/components/pm';
import type { DependencyDTO } from '@/lib/types';
import { addDependencyAction, removeDependencyAction } from '@/server/actions/tasks';
import { SectionHeading } from './property-row';
import { useTaskContext } from './task-context';
import { TaskPickerList } from './task-picker';

type Relation = 'waiting' | 'blocking';

const isOpen = (dep: DependencyDTO) =>
  dep.task.statusCategory !== 'done' && dep.task.statusCategory !== 'cancelled';

/** Banner shown at the top of the task while open tasks still block it. */
export function BlockedBanner() {
  const { task, openTask } = useTaskContext();
  const open = task.blockedBy.filter(isOpen);
  if (open.length === 0 || task.statusCategory === 'done' || task.statusCategory === 'cancelled') return null;
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-md border border-warning bg-warning-subtle px-3 py-2 text-sm text-warning-text"
      data-testid="task-blocked-banner"
    >
      <Hourglass aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0">
        <span className="font-semibold">
          Waiting on {open.length === 1 ? 'another task' : `${open.length} tasks`}.
        </span>{' '}
        Finish{' '}
        {open.slice(0, 3).map((dep, index) => (
          <span key={dep.id}>
            {index > 0 ? (index === open.slice(0, 3).length - 1 ? ' and ' : ', ') : ''}
            <button
              type="button"
              className="font-medium underline underline-offset-2 hover:no-underline"
              onClick={() => openTask(dep.task.key)}
            >
              {dep.task.key}
            </button>
          </span>
        ))}
        {open.length > 3 ? ` and ${open.length - 3} more` : ''} first.
      </p>
    </div>
  );
}

function DependencyRow({
  dep,
  relation,
  onRemove,
}: {
  readonly dep: DependencyDTO;
  readonly relation: Relation;
  readonly onRemove: () => void;
}) {
  const { canEdit, openTask } = useTaskContext();
  const open = isOpen(dep);
  return (
    <li className="group/dep flex h-9 items-center gap-2 rounded-md pr-1 pl-1.5 hover:bg-hover">
      <StatusIcon category={dep.task.statusCategory} size={15} />
      <span className="shrink-0 font-key text-2xs text-fg-muted">{dep.task.key}</span>
      <button
        type="button"
        onClick={() => openTask(dep.task.key)}
        className={cn(
          'min-w-0 flex-1 truncate rounded-xs text-left text-sm hover:underline focus-visible:outline-2 focus-visible:outline-focus',
          open ? 'text-fg' : 'text-fg-muted line-through decoration-1',
        )}
        title={dep.task.title}
      >
        {dep.task.title}
      </button>
      {relation === 'waiting' && open ? (
        <span className="shrink-0 rounded-sm bg-warning-subtle px-1.5 py-0.5 text-2xs font-medium text-warning-text">
          Not done
        </span>
      ) : null}
      {canEdit ? (
        <IconButton
          size="sm"
          label={relation === 'waiting' ? `Stop waiting on ${dep.task.key}` : `Stop blocking ${dep.task.key}`}
          icon={<X aria-hidden />}
          onClick={onRemove}
          className="opacity-0 group-hover/dep:opacity-100 focus-visible:opacity-100"
        />
      ) : null}
    </li>
  );
}

export function DependenciesSection() {
  const { task, canEdit, refresh } = useTaskContext();
  const [open, setOpen] = useState(false);
  const [relation, setRelation] = useState<Relation>('waiting');
  const [busy, setBusy] = useState(false);
  const exclude = useMemo(
    () =>
      new Set([
        task.id,
        ...task.blockedBy.map((dep) => dep.task.id),
        ...task.blocking.map((dep) => dep.task.id),
        ...task.subtasks.map((s) => s.id),
        ...(task.parent ? [task.parent.id] : []),
      ]),
    [task.blockedBy, task.blocking, task.id, task.parent, task.subtasks],
  );
  const total = task.blockedBy.length + task.blocking.length;

  const add = async (otherId: string, otherKey: string) => {
    setBusy(true);
    const result = await addDependencyAction(
      relation === 'waiting'
        ? { blockingTaskId: otherId, blockedTaskId: task.id }
        : { blockingTaskId: task.id, blockedTaskId: otherId },
    );
    setBusy(false);
    if (!result.ok) {
      toast.error("Couldn't add that dependency", result.error.message);
      return;
    }
    setOpen(false);
    toast.success(
      relation === 'waiting' ? `Now waiting on ${otherKey}` : `${otherKey} now waits on ${task.key}`,
    );
    refresh();
  };

  const remove = async (dep: DependencyDTO) => {
    const result = await removeDependencyAction({ dependencyId: dep.id });
    if (!result.ok) {
      toast.error("Couldn't remove that dependency", result.error.message);
      return;
    }
    refresh();
  };

  if (!canEdit && total === 0) return null;

  return (
    <section aria-labelledby="task-deps-heading" data-testid="task-dependencies">
      <SectionHeading
        id="task-deps-heading"
        icon={<GitBranch aria-hidden />}
        count={total || undefined}
        actions={
          canEdit ? (
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button size="sm" variant="ghost" leadingIcon={<Plus aria-hidden />} loading={busy}>
                  Add
                </Button>
              </PopoverTrigger>
              <PopoverContent
                flush
                align="end"
                className="w-[min(380px,calc(100vw-24px))]"
                aria-label="Add a dependency"
              >
                <div className="border-b border-border-subtle p-2">
                  <ToggleGroup
                    size="sm"
                    label="Kind of dependency"
                    value={relation}
                    onValueChange={setRelation}
                    options={[
                      { value: 'waiting', label: 'This waits on…', icon: <Hourglass aria-hidden /> },
                      { value: 'blocking', label: 'This blocks…', icon: <Ban aria-hidden /> },
                    ]}
                    className="w-full [&>*]:flex-1"
                  />
                  <p className="mt-1.5 px-1 text-xs text-fg-muted">
                    {relation === 'waiting'
                      ? `Pick a task that must be finished before ${task.key} can start.`
                      : `Pick a task that can't start until ${task.key} is done.`}
                  </p>
                </div>
                <TaskPickerList
                  projectKey={task.projectKey}
                  exclude={exclude}
                  onPick={(picked) => void add(picked.id, picked.key)}
                />
              </PopoverContent>
            </Popover>
          ) : null
        }
      >
        Dependencies
      </SectionHeading>
      {total === 0 ? (
        <p className="mt-1 text-sm text-fg-muted">
          Nothing is waiting on this, and it isn&apos;t waiting on anything.
        </p>
      ) : (
        <div className="mt-1 flex flex-col gap-2">
          {task.blockedBy.length ? (
            <div>
              <p className="flex items-center gap-1.5 px-1.5 text-xs font-medium text-fg-secondary">
                <Hourglass aria-hidden className="size-3.5 text-icon" /> Waiting on
              </p>
              <ul className="mt-0.5 flex flex-col">
                {task.blockedBy.map((dep) => (
                  <DependencyRow
                    key={dep.id}
                    dep={dep}
                    relation="waiting"
                    onRemove={() => void remove(dep)}
                  />
                ))}
              </ul>
            </div>
          ) : null}
          {task.blocking.length ? (
            <div>
              <p className="flex items-center gap-1.5 px-1.5 text-xs font-medium text-fg-secondary">
                <Ban aria-hidden className="size-3.5 text-icon" /> Blocking
              </p>
              <ul className="mt-0.5 flex flex-col">
                {task.blocking.map((dep) => (
                  <DependencyRow
                    key={dep.id}
                    dep={dep}
                    relation="blocking"
                    onRemove={() => void remove(dep)}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
