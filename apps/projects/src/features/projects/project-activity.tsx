'use client';
/**
 * Activity tab: the project's audit trail in plain language, newest first, grouped by day.
 * Filter by kind (tasks, comments, files, project changes, automations) and load older events.
 */
import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Activity as ActivityIcon, Zap } from 'lucide-react';
import { Button, EmptyState, Select, Skeleton } from '@/components/ui';
import { PersonAvatar } from '@/components/pm';
import { describeActivity, describeActivityParts } from '@/lib/activity-text';
import { apiGet, apiPath } from '@/lib/api-client';
import { useProjectTasks, type ActivityPage } from '@/lib/hooks/use-data';
import { usePeopleMap } from '@/lib/hooks/use-people';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { qk } from '@/lib/query-keys';
import type { ActivityDTO } from '@/lib/types';
import { LocalTime, useHydrated } from '@/features/task/local-time';
import { useCurrentProject } from './project-context';

const FILTERS = {
  all: { label: 'Everything', verbs: [] as string[] },
  tasks: { label: 'Task changes', verbs: ['task.created', 'task.updated', 'task.moved', 'task.deleted', 'task.restored', 'task.label_added', 'task.label_removed', 'task.dependency_added', 'task.dependency_removed', 'task.moved_project'] },
  comments: { label: 'Comments', verbs: ['comment.added', 'comment.edited', 'comment.deleted'] },
  files: { label: 'Files and links', verbs: ['attachment.added', 'attachment.deleted', 'task.link_added', 'task.link_removed', 'link.added', 'link.removed'] },
  project: { label: 'Project changes', verbs: ['project.created', 'project.updated', 'project.update_posted', 'project.archived', 'project.restored', 'project.member_added', 'project.member_updated', 'project.member_removed', 'status.created', 'status.updated', 'status.deleted', 'label.created', 'label.updated', 'label.deleted', 'field.created', 'field.updated', 'field.deleted', 'milestone.created', 'milestone.updated', 'milestone.deleted'] },
  automations: { label: 'Automations', verbs: ['automation.ran'] },
} as const;

type FilterKey = keyof typeof FILTERS;

/**
 * Posting a status update also records the health / note / stage field changes it made. Hide
 * those echoes (same person, within a few seconds) so the feed shows one clear entry.
 */
export function withoutUpdateEchoes(items: readonly ActivityDTO[]): ActivityDTO[] {
  const posts = items.filter((event) => event.verb === 'project.update_posted');
  if (posts.length === 0) return [...items];
  return items.filter((event) => {
    if (event.verb !== 'project.updated' || !['health', 'healthNote', 'status'].includes(event.field ?? '')) return true;
    const at = Date.parse(event.createdAt);
    return !posts.some((post) => post.actorId === event.actorId && Math.abs(Date.parse(post.createdAt) - at) < 5000);
  });
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
}

export function ProjectActivity() {
  const { project, statusById, labelById } = useCurrentProject();
  const [filter, setFilter] = useState<FilterKey>('all');
  const tasks = useProjectTasks(project.key);
  const people = usePeopleMap();
  const hydrated = useHydrated();
  const { openTask } = useTaskDrawer();
  const taskById = useMemo(() => new Map((tasks.data ?? []).map((t) => [t.id, t])), [tasks.data]);
  const verbs = FILTERS[filter].verbs;
  const activity = useInfiniteQuery({
    queryKey: [...qk.projectActivity(project.key), 'feed', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiGet<ActivityPage>(apiPath(`projects/${encodeURIComponent(project.key)}/activity`, { before: pageParam, limit: 50, verbs: verbs.length ? verbs.join(',') : undefined })),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = useMemo(() => withoutUpdateEchoes((activity.data?.pages ?? []).flatMap((page) => page.items)), [activity.data]);
  const groups = useMemo(() => {
    const out: { label: string; key: string; items: ActivityDTO[] }[] = [];
    for (const event of items) {
      const key = hydrated ? new Date(event.createdAt).toDateString() : event.createdAt.slice(0, 10);
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(event);
      else out.push({ key, label: hydrated ? dayLabel(event.createdAt) : event.createdAt.slice(0, 10), items: [event] });
    }
    return out;
  }, [items, hydrated]);

  return (
    <div className="mx-auto w-full max-w-[880px] px-4 py-5 sm:px-6" data-testid="project-activity">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 className="text-md font-semibold text-fg">Activity</h2>
          <p className="text-xs text-fg-muted">Every change to this project and its tasks, in order. Nothing here can be edited.</p>
        </div>
        <Select aria-label="Show" value={filter} onValueChange={(value) => setFilter(value as FilterKey)} options={(Object.keys(FILTERS) as FilterKey[]).map((key) => ({ value: key, label: FILTERS[key].label }))} className="w-44" />
      </div>
      {activity.isPending ? (
        <Skeleton height={240} rounded="lg" />
      ) : items.length === 0 ? (
        <EmptyState visual={<ActivityIcon aria-hidden className="size-10 text-icon" />} title={filter === 'all' ? 'Nothing has happened yet' : 'Nothing like that yet'} description="Changes to the project and its tasks show up here as they happen." />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.key} aria-label={group.label}>
              <h3 className="sticky top-0 z-[1] -mx-1 mb-2 bg-app/95 px-1 py-1 text-xs font-semibold tracking-wide text-fg-muted uppercase backdrop-blur">{group.label}</h3>
              <ol className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs">
                {group.items.map((event) => {
                  const task = event.taskId ? taskById.get(event.taskId) : undefined;
                  const automated = event.actorKind === 'automation';
                  return (
                    <li key={event.id} className="flex gap-3" data-testid="activity-item">
                      {automated ? (
                        <span aria-hidden className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary-text">
                          <Zap className="size-3.5" />
                        </span>
                      ) : (
                        <PersonAvatar userId={event.actorId} size="sm" />
                      )}
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="text-fg-secondary">
                          <span className="font-semibold text-fg">{automated ? 'Automation' : event.actorId ? (people.get(event.actorId)?.name ?? 'Someone') : 'KitStak'}</span>{' '}
                          {task ? (
                            (() => {
                              const parts = describeActivityParts(event, { statusName: (id) => statusById.get(id)?.name, personName: (id) => people.get(id)?.name, labelName: (id) => labelById.get(id)?.name });
                              return (
                                <>
                                  {parts.before}{' '}
                                  <button type="button" data-task-key={task.key} onClick={() => openTask(task.key)} className="rounded-sm font-medium text-fg-link outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus">
                                    {task.key} {task.title}
                                  </button>
                                  {parts.after ? ` ${parts.after}` : null}
                                </>
                              );
                            })()
                          ) : (
                            describeActivity(event, { statusName: (id) => statusById.get(id)?.name, personName: (id) => people.get(id)?.name, labelName: (id) => labelById.get(id)?.name })
                          )}
                        </p>
                        {event.verb === 'project.update_posted' && typeof (event.after as { note?: unknown } | null)?.note === 'string' ? (
                          <p className="mt-1 rounded-md bg-sunken px-3 py-2 text-sm whitespace-pre-wrap text-fg">{(event.after as { note: string }).note}</p>
                        ) : null}
                        <LocalTime iso={event.createdAt} className="text-xs text-fg-muted" />
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
          {activity.hasNextPage ? (
            <Button variant="secondary" className="self-center" loading={activity.isFetchingNextPage} onClick={() => void activity.fetchNextPage()}>
              Show older activity
            </Button>
          ) : (
            <p className="text-center text-xs text-fg-muted">That’s everything.</p>
          )}
        </div>
      )}
    </div>
  );
}
