'use client';
/**
 * The builds of one program in a date window, as task rows for the shared views
 * (docs/programs/SPEC.md 5.7, 8.5). The cache key starts with `qk.projectTasks(key)`, so the shared
 * optimistic task mutations patch it and project invalidations refresh it; build mutations also
 * invalidate it through `programInvalidations`. Pages of the builds API are followed up to the
 * window's end (a window is at most about 3 months, never every build).
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPath } from '@/lib/api-client';
import { useProjectTasks } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import type { BuildsPageDTO, IsoDate } from '@/lib/program-types';
import type { TaskSummary } from '@/lib/types';
import type { TaskSourceValue, WorkKind } from '@/features/views/task-source';

const MAX_PAGES = 8;

export function buildTasksKey(key: string, from: IsoDate, to: IsoDate) {
  return [...qk.projectTasks(key), 'builds', from, to] as const;
}

async function fetchWindow(key: string, from: IsoDate, to: IsoDate): Promise<TaskSummary[]> {
  const out: TaskSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await apiGet<BuildsPageDTO>(apiPath(`programs/${encodeURIComponent(key)}/builds`, { from, to, limit: 500, cursor }));
    out.push(...(data.items as unknown as TaskSummary[]));
    if (!data.nextCursor) break;
    cursor = data.nextCursor;
  }
  return out;
}

export function useBuildTasks(key: string, window: { readonly from: IsoDate; readonly to: IsoDate }, options: { readonly workKind?: WorkKind; readonly initial?: readonly TaskSummary[] } = {}) {
  const query = useQuery({
    queryKey: buildTasksKey(key, window.from, window.to),
    queryFn: () => fetchWindow(key, window.from, window.to),
    staleTime: 15_000,
    placeholderData: (previous) => previous,
  });
  const workKind = options.workKind ?? 'build';
  // Prep tasks of the program (kind task) come from the project list when the Work type asks for them.
  const projectTasks = useProjectTasks(key, { enabled: workKind !== 'build', staleTime: 30_000 });
  const tasks = useMemo(() => {
    const builds = query.data;
    if (!builds) return undefined;
    if (workKind === 'build') return builds;
    const extra = (projectTasks.data ?? []).filter((task) => task.kind !== 'build');
    return [...builds, ...extra];
  }, [projectTasks.data, query.data, workKind]);
  const source: TaskSourceValue = useMemo(
    () => ({ tasks, isLoading: query.isPending, error: query.error, queryKey: buildTasksKey(key, window.from, window.to), workKind, refetch: () => void query.refetch() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, query.isPending, query.error, key, window.from, window.to, workKind],
  );
  return { source, query };
}
