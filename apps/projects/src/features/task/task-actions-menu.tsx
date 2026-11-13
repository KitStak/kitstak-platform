'use client';
/**
 * The task "…" menu: copy link / key, open full page, done / reopen, won't do, follow,
 * duplicate, move to another project, make it a subtask (or a regular task again), delete with
 * undo. Also exports `useTaskActions` so keyboard shortcuts and buttons share the same logic.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  ArrowUpRight,
  Ban,
  Bell,
  BellOff,
  CircleCheckBig,
  Copy,
  CornerDownRight,
  CornerLeftUp,
  Hash,
  Link2,
  MoreHorizontal,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  IconButton,
  toast,
} from '@/components/ui';
import { EntityIcon } from '@/components/pm';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import { useProjects } from '@/lib/hooks/use-data';
import { useTaskMutations } from '@/lib/hooks/use-task-mutations';
import { duplicateTaskAction, moveTaskAction, moveTaskToProjectAction } from '@/server/actions/tasks';
import { useShell } from '@/features/shell/shell-context';
import { useTaskContext } from './task-context';
import { TaskPickerList } from './task-picker';
import { useWatchToggle } from './watchers';
import { toggleDoneWithUndo } from './done-toggle';

export function useTaskActions() {
  const context = useTaskContext();
  const { task, statuses, statusById, patch, refresh, openTask, onDeleted, retire } = context;
  const queryClient = useQueryClient();
  const router = useRouter();
  const { deleteTasks } = useTaskMutations({ statusCategory: (id) => statusById.get(id)?.category });
  const url = () => `${window.location.origin}${routes.task(task.projectKey, task.number)}`;
  const doneStatus = statuses.find((status) => status.category === 'done');
  const todoStatus = statuses.find((status) => status.category === 'todo') ?? statuses[0];
  const cancelledStatus = statuses.find((status) => status.category === 'cancelled');
  const isClosed = task.statusCategory === 'done' || task.statusCategory === 'cancelled';

  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(message);
    } catch {
      toast.error("Couldn't copy", text);
    }
  };

  return {
    ...context,
    doneStatus,
    cancelledStatus,
    isClosed,
    copyLink: () => copy(url(), `Link to ${task.key} copied`),
    copyKey: () => copy(task.key, `Copied ${task.key}`),
    toggleDone: async () => {
      const target = isClosed ? todoStatus : doneStatus;
      if (!target) return;
      await toggleDoneWithUndo({ taskKey: task.key, closing: !isClosed, target: target.id, previous: task.statusId, save: (statusId) => patch({ statusId }) });
    },
    wontDo: async () => {
      if (!cancelledStatus) return;
      const ok = await patch({ statusId: cancelledStatus.id });
      if (ok) toast.success(`${task.key} closed as “${cancelledStatus.name}”`);
    },
    duplicate: async () => {
      const result = await duplicateTaskAction({ taskId: task.id, includeSubtasks: true });
      if (!result.ok) {
        toast.error("Couldn't duplicate this task", result.error.message);
        return;
      }
      refresh();
      toast.success(
        `Made a copy: ${result.data.key}`,
        task.subtasks.length ? 'Subtasks were copied too.' : undefined,
      );
      openTask(result.data.key);
    },
    moveToProject: async (target: { id: string; name: string }) => {
      const result = await moveTaskToProjectAction({ taskId: task.id, projectId: target.id });
      if (!result.ok) {
        toast.error(`Couldn't move ${task.key}`, result.error.message);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['project'] });
      void queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
      toast.success(`Moved to ${target.name}`, `${task.key} is now ${result.data.key}.`);
      openTask(result.data.key);
    },
    setParent: async (parent: { id: string; key: string } | null) => {
      const result = await moveTaskAction({ taskId: task.id, parentTaskId: parent?.id ?? null });
      if (!result.ok) {
        toast.error(
          parent ? `Couldn't put this under ${parent.key}` : "Couldn't move this out",
          result.error.message,
        );
        return false;
      }
      if (task.parent) void queryClient.invalidateQueries({ queryKey: qk.task(task.parent.id) });
      if (parent) void queryClient.invalidateQueries({ queryKey: qk.task(parent.id) });
      refresh();
      toast.success(
        parent ? `${task.key} is now a subtask of ${parent.key}` : `${task.key} is now a regular task`,
      );
      return true;
    },
    remove: async () => {
      // Leave the task first so nothing tries to reload it after it's gone; come back if it fails.
      const leave = onDeleted ?? (() => router.push(routes.project(task.projectKey)));
      retire();
      leave();
      const ok = await deleteTasks(
        [task.id],
        task.subtasks.length
          ? `Deleted ${task.key} and ${task.subtasks.length} ${task.subtasks.length === 1 ? 'subtask' : 'subtasks'}`
          : `Deleted ${task.key}`,
      );
      if (!ok) openTask(task.key);
    },
  };
}

function ParentDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const actions = useTaskActions();
  const { task } = actions;
  const exclude = useMemo(
    () =>
      new Set([task.id, ...task.subtasks.map((child) => child.id), ...(task.parent ? [task.parent.id] : [])]),
    [task.id, task.parent, task.subtasks],
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" className="overflow-hidden">
        <DialogHeader
          title={`Make ${task.key} a subtask`}
          description="Pick the task it belongs under. Subtasks stay in the same project."
        />
        <div className="border-t border-border-subtle">
          <TaskPickerList
            projectKey={task.projectKey}
            exclude={exclude}
            sameProjectOnly
            topLevelOnly
            placeholder="Find the parent task…"
            onPick={(picked) => {
              void actions
                .setParent({ id: picked.id, key: picked.key })
                .then((ok) => ok && onOpenChange(false));
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TaskActionsMenu() {
  const actions = useTaskActions();
  const { task, project, variant, canEdit, canDelete, canCreate, doneStatus, cancelledStatus, isClosed } =
    actions;
  const { user } = useShell();
  const watch = useWatchToggle();
  const projects = useProjects({}, { enabled: canEdit });
  const [parentOpen, setParentOpen] = useState(false);
  const watching = task.watcherIds.includes(user.id);
  const others = (projects.data ?? []).filter(
    (entry) =>
      entry.id !== project.id &&
      !entry.archivedAt &&
      !entry.isTemplate &&
      (entry.role === 'owner' || entry.role === 'editor'),
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label="More actions" icon={<MoreHorizontal aria-hidden />} data-testid="task-actions" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem icon={<Link2 aria-hidden />} onSelect={() => void actions.copyLink()}>
            Copy link
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Hash aria-hidden />} onSelect={() => void actions.copyKey()}>
            Copy task key ({task.key})
          </DropdownMenuItem>
          {variant === 'drawer' ? (
            <DropdownMenuItem
              icon={<ArrowUpRight aria-hidden />}
              onSelect={() => window.location.assign(routes.task(task.projectKey, task.number))}
            >
              Open full page
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            icon={watching ? <BellOff aria-hidden /> : <Bell aria-hidden />}
            onSelect={() => void watch(user.id, !watching, true)}
          >
            {watching ? 'Stop following' : 'Follow this task'}
          </DropdownMenuItem>
          {canEdit ? (
            <>
              <DropdownMenuSeparator />
              {isClosed ? (
                <DropdownMenuItem icon={<RotateCcw aria-hidden />} onSelect={() => void actions.toggleDone()}>
                  Reopen
                </DropdownMenuItem>
              ) : doneStatus ? (
                <DropdownMenuItem
                  icon={<CircleCheckBig aria-hidden />}
                  onSelect={() => void actions.toggleDone()}
                >
                  Mark done
                </DropdownMenuItem>
              ) : null}
              {cancelledStatus && !isClosed ? (
                <DropdownMenuItem
                  icon={<Ban aria-hidden />}
                  onSelect={() => void actions.wontDo()}
                  description={`Moves it to “${cancelledStatus.name}”`}
                >
                  Close without doing it
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
          {canCreate || canEdit ? <DropdownMenuSeparator /> : null}
          {canCreate ? (
            <DropdownMenuItem icon={<Copy aria-hidden />} onSelect={() => void actions.duplicate()}>
              Duplicate
            </DropdownMenuItem>
          ) : null}
          {canEdit && !task.parent && others.length ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger icon={<ArrowRightLeft aria-hidden />}>
                Move to project
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 w-64 overflow-y-auto">
                <DropdownMenuLabel>Move {task.key} and its subtasks to…</DropdownMenuLabel>
                {others.map((entry) => (
                  <DropdownMenuItem
                    key={entry.id}
                    icon={<EntityIcon icon={entry.icon} color={entry.color} size={16} />}
                    onSelect={() => void actions.moveToProject({ id: entry.id, name: entry.name })}
                  >
                    {`${entry.name} (${entry.key})`}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          {canEdit ? (
            task.parent ? (
              <DropdownMenuItem
                icon={<CornerLeftUp aria-hidden />}
                onSelect={() => void actions.setParent(null)}
                description={`Moves it out of ${task.parent.key}`}
              >
                Make it a regular task
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem icon={<CornerDownRight aria-hidden />} onSelect={() => setParentOpen(true)}>
                Make it a subtask of…
              </DropdownMenuItem>
            )
          ) : null}
          {canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                icon={<Trash2 aria-hidden />}
                variant="danger"
                onSelect={() => void actions.remove()}
                description="You can undo right after"
              >
                Delete task
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {parentOpen ? <ParentDialog open={parentOpen} onOpenChange={setParentOpen} /> : null}
    </>
  );
}

/** "Open full page" icon link used in the drawer header. */
export function OpenFullPageLink() {
  const { task } = useTaskContext();
  return (
    <Link
      href={routes.task(task.projectKey, task.number)}
      aria-label="Open full page"
      title="Open full page"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-icon transition-colors hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus"
    >
      <ArrowUpRight aria-hidden className="size-4" />
    </Link>
  );
}
