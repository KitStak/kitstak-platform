'use client';
/**
 * Followers ("watchers"): people who get inbox updates about this task. One-click follow /
 * unfollow for you; editors can add or remove teammates. Optimistic, with the avatars shown.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, Eye, UserPlus } from 'lucide-react';
import {
  Avatar,
  AvatarGroup,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  UserPicker,
  cn,
  toast,
} from '@/components/ui';
import { usePeople } from '@/lib/hooks/use-data';
import { usePeopleMap } from '@/lib/hooks/use-people';
import { qk } from '@/lib/query-keys';
import type { TaskDetail } from '@/lib/types';
import { setWatchingAction } from '@/server/actions/tasks';
import { useShell } from '@/features/shell/shell-context';
import { useTaskContext } from './task-context';

export function useWatchToggle() {
  const { task, taskRef, refresh } = useTaskContext();
  const queryClient = useQueryClient();
  return async (userId: string, watching: boolean, me: boolean) => {
    const key = qk.task(taskRef);
    const before = queryClient.getQueryData<TaskDetail>(key);
    if (before) {
      const ids = new Set(before.watcherIds);
      if (watching) ids.add(userId);
      else ids.delete(userId);
      queryClient.setQueryData<TaskDetail>(key, { ...before, watcherIds: [...ids] });
    }
    const result = await setWatchingAction({ taskId: task.id, watching, ...(me ? {} : { userId }) });
    if (!result.ok) {
      if (before) queryClient.setQueryData(key, before);
      toast.error("Couldn't change who follows this task", result.error.message);
      return false;
    }
    refresh();
    return true;
  };
}

export function WatchersButton() {
  const { task, canEdit } = useTaskContext();
  const { user } = useShell();
  const people = usePeople();
  const peopleMap = usePeopleMap();
  const toggle = useWatchToggle();
  const [open, setOpen] = useState(false);
  const watching = task.watcherIds.includes(user.id);
  const watchers = task.watcherIds.map((id) => peopleMap.get(id)).filter((person) => person !== undefined);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content={watching ? 'You follow this task' : 'Follow to get updates'}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="task-watchers"
            aria-label={`${watchers.length} ${watchers.length === 1 ? 'follower' : 'followers'}${watching ? ', including you' : ''}`}
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus',
              watching ? 'text-primary-text' : 'text-fg-secondary',
            )}
          >
            <Eye aria-hidden className="size-4" />
            <span className="tabular-nums">{watchers.length}</span>
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="w-72" aria-label="Followers">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-semibold text-fg">Followers</p>
            <p className="text-xs text-fg-muted">
              They get an inbox update when this task changes or someone comments.
            </p>
          </div>
          <Button
            size="sm"
            variant={watching ? 'secondary' : 'primary'}
            leadingIcon={watching ? <BellOff aria-hidden /> : <Bell aria-hidden />}
            onClick={() => void toggle(user.id, !watching, true)}
            data-testid="task-follow-toggle"
          >
            {watching ? 'Stop following' : 'Follow this task'}
          </Button>
          {watchers.length ? (
            <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
              {watchers.map((person) => (
                <li key={person.id} className="flex items-center gap-2 rounded-md px-1 py-1">
                  <Avatar name={person.name} src={person.image} size="xs" />
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">
                    {person.id === user.id ? `${person.name} (you)` : person.name}
                  </span>
                  {canEdit && person.id !== user.id ? (
                    <button
                      type="button"
                      className="shrink-0 rounded-sm px-1.5 py-0.5 text-xs text-fg-muted hover:bg-hover hover:text-fg"
                      onClick={() => void toggle(person.id, false, false)}
                    >
                      Remove
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-muted">No one follows this task yet.</p>
          )}
          {canEdit ? (
            <UserPicker
              multiple
              people={people.data ?? []}
              meId={user.id}
              value={task.watcherIds}
              onChange={(next) => {
                const added = next.filter((id) => !task.watcherIds.includes(id));
                const removed = task.watcherIds.filter((id) => !next.includes(id));
                for (const id of added) void toggle(id, true, id === user.id);
                for (const id of removed) void toggle(id, false, id === user.id);
              }}
              trigger={
                <Button
                  size="sm"
                  variant="ghost"
                  leadingIcon={<UserPlus aria-hidden />}
                  className="justify-start"
                >
                  Add or remove people
                </Button>
              }
            />
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Compact avatars of followers (page sidebar). */
export function WatcherAvatars() {
  const { task } = useTaskContext();
  const peopleMap = usePeopleMap();
  const people = task.watcherIds
    .map((id) => peopleMap.get(id))
    .filter((person) => person !== undefined)
    .map((person) => ({ id: person.id, name: person.name, src: person.image }));
  if (!people.length) return <span className="text-sm text-fg-muted">No followers</span>;
  return <AvatarGroup people={people} max={6} size="xs" />;
}
