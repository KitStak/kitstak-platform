'use client';
/**
 * Project context for every /p/[key]/* page. The [key] layout loads ProjectDetail on the server
 * and seeds React Query; tabs read it with `useCurrentProject()` (live, refetches on focus and
 * after mutations that invalidate qk.project(key)).
 *
 *   const { project, statuses, statusById, capabilities } = useCurrentProject();
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { usePeople, useProject, useProjectTasks } from '@/lib/hooks/use-data';
import type { LabelDTO, OrgPerson, ProjectDetail, SectionDTO, StatusDTO, TaskSummary } from '@/lib/types';

interface ProjectContextValue {
  readonly project: ProjectDetail;
  readonly statuses: readonly StatusDTO[];
  readonly statusById: ReadonlyMap<string, StatusDTO>;
  readonly sectionById: ReadonlyMap<string, SectionDTO>;
  readonly labelById: ReadonlyMap<string, LabelDTO>;
  readonly capabilities: ProjectDetail['capabilities'];
  readonly isFetching: boolean;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({
  initial,
  initialTasks,
  initialPeople,
  loadedAt,
  children,
}: {
  readonly initial: ProjectDetail;
  /** Server-loaded tasks (all, with subtasks): seeds qk.projectTasks so tabs render on the first HTML. */
  readonly initialTasks?: readonly TaskSummary[];
  /** Server-loaded org people: names resolve on first paint instead of flashing "Former member". */
  readonly initialPeople?: readonly OrgPerson[];
  readonly loadedAt?: number;
  readonly children: ReactNode;
}) {
  const query = useProject(initial.key, { initialData: initial });
  // Seed only (notifyOnChangeProps: []): the provider never re-renders on task or people changes.
  useProjectTasks(initial.key, {
    initialData: initialTasks ? [...initialTasks] : undefined,
    initialDataUpdatedAt: loadedAt,
    notifyOnChangeProps: [],
  });
  usePeople({ initialData: initialPeople ? [...initialPeople] : undefined, initialDataUpdatedAt: loadedAt, notifyOnChangeProps: [] });
  const project = query.data ?? initial;
  const value = useMemo<ProjectContextValue>(
    () => ({
      project,
      statuses: project.statuses,
      statusById: new Map(project.statuses.map((s) => [s.id, s])),
      sectionById: new Map(project.sections.map((s) => [s.id, s])),
      labelById: new Map(project.labels.map((l) => [l.id, l])),
      capabilities: project.capabilities,
      isFetching: query.isFetching,
    }),
    [project, query.isFetching],
  );
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useCurrentProject(): ProjectContextValue {
  const context = useContext(ProjectContext);
  if (!context) throw new Error('useCurrentProject must be used under /p/[key]');
  return context;
}
