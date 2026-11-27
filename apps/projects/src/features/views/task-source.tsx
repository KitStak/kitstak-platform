'use client';
/**
 * Where a shared view (board, list, table, calendar, timeline) gets its tasks
 * (docs/programs/SPEC.md 5.7). Projects mount nothing and the views read `useProjectTasks` as
 * before. Programs mount a provider backed by the builds window, so the same views show builds
 * without forking.
 *
 *   <TaskSourceProvider source={{ tasks, isLoading, error, queryKey, workKind: 'build' }}>…</TaskSourceProvider>
 *   const source = useTaskSource(); // { data, isLoading, error, queryKey, workKind, refetch }
 *
 * The `queryKey` must start with `qk.projectTasks(key)` so the shared optimistic task mutations
 * (src/lib/hooks/use-task-mutations.ts patch every `['project', key, 'tasks', ...]` list) and
 * every project invalidation reach it.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { QueryKey } from '@tanstack/react-query';
import { useProjectTasks } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import type { TaskSummary } from '@/lib/types';
import { useCurrentProject } from '@/features/projects/project-context';

export type WorkKind = 'task' | 'build' | 'both';

export interface TaskSourceValue {
  readonly tasks: readonly TaskSummary[] | undefined;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly queryKey: QueryKey;
  /** What the source holds: builds only, tasks only, or both. */
  readonly workKind: WorkKind;
  readonly refetch?: () => void;
}

export interface TaskSourceResult {
  readonly data: TaskSummary[] | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: Error | null;
  readonly queryKey: QueryKey;
  readonly workKind: WorkKind;
  readonly fromProvider: boolean;
  refetch(): unknown;
}

const TaskSourceContext = createContext<TaskSourceValue | null>(null);

export function TaskSourceProvider({ source, children }: { readonly source: TaskSourceValue; readonly children: ReactNode }) {
  return <TaskSourceContext.Provider value={source}>{children}</TaskSourceContext.Provider>;
}

/** The mounted source, or the project's task list (projects unchanged). */
export function useTaskSource(): TaskSourceResult {
  const provided = useContext(TaskSourceContext);
  const { project } = useCurrentProject();
  // Hooks always run; the project query is cheap and already seeded when a provider is mounted.
  const projectTasks = useProjectTasks(project.key, { enabled: !provided });
  const providedTasks = provided?.tasks;
  const data = useMemo(() => (providedTasks ? [...providedTasks] : undefined), [providedTasks]);
  if (provided) {
    return {
      data,
      isLoading: provided.isLoading,
      isError: Boolean(provided.error),
      error: provided.error,
      queryKey: provided.queryKey,
      workKind: provided.workKind,
      fromProvider: true,
      refetch: () => provided.refetch?.(),
    };
  }
  return {
    data: projectTasks.data,
    isLoading: projectTasks.isLoading,
    isError: projectTasks.isError,
    error: projectTasks.error,
    queryKey: qk.projectTasks(project.key),
    workKind: 'both',
    fromProvider: false,
    refetch: () => projectTasks.refetch(),
  };
}

/** The query key of the current source (for optimistic patches). */
export function useTaskSourceKey(): QueryKey {
  const provided = useContext(TaskSourceContext);
  const { project } = useCurrentProject();
  return provided?.queryKey ?? qk.projectTasks(project.key);
}
