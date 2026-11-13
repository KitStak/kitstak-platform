'use client';
/**
 * Project context for every /p/[key]/* page. The [key] layout loads ProjectDetail on the server
 * and seeds React Query; tabs read it with `useCurrentProject()` (live, refetches on focus and
 * after mutations that invalidate qk.project(key)).
 *
 *   const { project, statuses, statusById, capabilities } = useCurrentProject();
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useProject } from '@/lib/hooks/use-data';
import type { LabelDTO, ProjectDetail, SectionDTO, StatusDTO } from '@/lib/types';

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

export function ProjectProvider({ initial, children }: { readonly initial: ProjectDetail; readonly children: ReactNode }) {
  const query = useProject(initial.key, { initialData: initial });
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
