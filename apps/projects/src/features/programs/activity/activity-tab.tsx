'use client';
/**
 * Program Activity tab (docs/programs/SPEC.md 5.15): every change in plain sentences, grouped by
 * day, newest first. Filter by kind (Output, Prices, Variants, Builds, Runs, Schedules, Links,
 * Month close, Settings, People). Money shows only for people who see money: the server removes
 * it from the rows, and the sentences have a units only form. Owners export the loaded rows as CSV.
 */
import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Activity as ActivityIcon, Download, Zap } from 'lucide-react';
import { Button, EmptyState, Select, Skeleton } from '@/components/ui';
import { PersonAvatar } from '@/components/pm';
import { describeActivity, describeActivityParts } from '@/lib/activity-text';
import { useProjectTasks } from '@/lib/hooks/use-data';
import { apiGet, apiPath } from '@/lib/api-client';
import { usePeopleMap } from '@/lib/hooks/use-people';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { qk } from '@/lib/query-keys';
import type { ActivityDTO } from '@/lib/types';
import type { ProgramActivityPage } from '@/lib/hooks/use-programs';
import { useCurrentProgram } from '../program-context';
import { ACTIVITY_FILTERS, activityCsv, dayGroups, matchesFilter, type ActivityFilter } from './activity-model';

export function ActivityTab() {
  const { key, statusById, variantById, capabilities } = useCurrentProgram();
  const people = usePeopleMap();
  const { openTask } = useTaskDrawer();
  const tasks = useProjectTasks(key);
  const taskById = useMemo(() => new Map((tasks.data ?? []).map((task) => [task.id, task])), [tasks.data]);
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const spec = ACTIVITY_FILTERS[filter];
  const activity = useInfiniteQuery({
    queryKey: [...qk.programActivity(key, spec.server), 'pages'],
    queryFn: ({ pageParam }) => apiGet<ProgramActivityPage>(apiPath(`programs/${encodeURIComponent(key)}/activity`, { filter: spec.server, cursor: pageParam ?? undefined })),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const lookups = useMemo(() => ({ personName: (id: string) => people.get(id)?.name, statusName: (id: string) => statusById.get(id)?.name, variantName: (id: string) => variantById.get(id)?.name }), [people, statusById, variantById]);
  const rows = useMemo(() => (activity.data?.pages ?? []).flatMap((page) => page.items).filter((row) => matchesFilter(row, filter)), [activity.data, filter]);
  const groups = useMemo(() => dayGroups(rows), [rows]);
  const actorName = (row: ActivityDTO) => (row.actorKind === 'automation' ? 'Automation' : row.actorKind === 'system' ? 'KitStak' : row.actorId ? (people.get(row.actorId)?.name ?? 'Someone') : 'KitStak');
  const exportCsv = () => {
    const csv = activityCsv(rows, (row) => actorName(row), (row) => describeActivity(row, lookups));
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${key}-activity.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-5" data-testid="activity-tab">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-fg">Activity</h2>
        <Select aria-label="Show" value={filter} onValueChange={(value) => setFilter(value as ActivityFilter)} options={(Object.keys(ACTIVITY_FILTERS) as ActivityFilter[]).map((id) => ({ value: id, label: ACTIVITY_FILTERS[id].label }))} className="w-44" />
        {capabilities.canManage && rows.length > 0 ? (
          <Button variant="secondary" className="ml-auto" onClick={exportCsv}>
            <Download aria-hidden />
            Export CSV
          </Button>
        ) : null}
      </header>
      {activity.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton height={20} width={120} />
          <Skeleton height={180} rounded="lg" />
        </div>
      ) : activity.isError ? (
        <EmptyState illustration="error" size="sm" title="We couldn't load activity" description={activity.error.message} actions={<Button variant="secondary" onClick={() => void activity.refetch()}>Try again</Button>} />
      ) : rows.length === 0 && !activity.hasNextPage ? (
        <EmptyState visual={<ActivityIcon aria-hidden className="size-10 text-icon" />} title={filter === 'all' ? 'Nothing has happened yet' : 'Nothing like that yet'} description="Output, prices, variants, schedules and links show up here as they change." />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.key} aria-label={group.label}>
              <h3 className="sticky top-0 z-[1] -mx-1 mb-2 bg-app/95 px-1 py-1 text-xs font-semibold tracking-wide text-fg-muted uppercase backdrop-blur">{group.label}</h3>
              <ol className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs">
                {group.items.map((row) => {
                  const automated = row.actorKind === 'automation' || row.actorKind === 'system';
                  const task = row.taskId ? taskById.get(row.taskId) : undefined;
                  const parts = task ? describeActivityParts(row, lookups) : null;
                  return (
                    <li key={row.id} className="flex gap-3" data-testid="activity-item" data-verb={row.verb}>
                      {automated ? (
                        <span aria-hidden className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary-text">
                          <Zap className="size-3.5" />
                        </span>
                      ) : (
                        <PersonAvatar userId={row.actorId} size="sm" />
                      )}
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="text-fg-secondary">
                          <span className="font-semibold text-fg">{actorName(row)}</span>{' '}
                          {task && parts ? (
                            <>
                              {parts.before}{' '}
                              <button type="button" onClick={() => openTask(task.key)} className="rounded-sm text-left font-medium text-fg-link outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus">
                                {task.key} {task.title}
                              </button>
                              {parts.after ? ` ${parts.after}` : null}
                            </>
                          ) : (
                            describeActivity(row, lookups)
                          )}
                        </p>
                        {row.verb === 'program.update_posted' && typeof (row.after as { note?: unknown } | null)?.note === 'string' ? <p className="mt-1 rounded-md bg-sunken px-3 py-2 text-sm whitespace-pre-wrap text-fg">{(row.after as { note: string }).note}</p> : null}
                        <time dateTime={row.createdAt} className="text-xs text-fg-muted" suppressHydrationWarning>
                          {new Date(row.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                        </time>
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
            <p className="text-center text-xs text-fg-muted">That is everything.</p>
          )}
        </div>
      )}
    </div>
  );
}
