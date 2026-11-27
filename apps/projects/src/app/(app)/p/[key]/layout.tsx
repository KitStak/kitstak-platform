import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { ProjectFrame, ProjectProvider } from '@/features/projects';
import { getProjectDetail, listOrgPeople, listProjectTasks, recordVisit } from '@/server/domain';
import { isDomainError } from '@/server/errors';
import { pageContext } from '@/server/page';

/** One project load per request, shared by the layout and its metadata. */
const loadProject = cache(async (key: string) => {
  const { ctx } = await pageContext(`/p/${key}`);
  const project = await getProjectDetail(ctx, { key }).catch((error: unknown) => {
    if (isDomainError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    throw error;
  });
  return { ctx, project };
});

/** Every task (with subtasks and done ones, like GET /projects/:key/tasks) and the org people. */
async function loadTabData(ctx: Awaited<ReturnType<typeof loadProject>>['ctx'], projectId: string) {
  const [tasks, people] = await Promise.all([listProjectTasks(ctx, projectId, { includeCompleted: true, includeSubtasks: true }), listOrgPeople(ctx)]);
  return { tasks, people, loadedAt: Date.now() };
}

export async function generateMetadata({ params }: { readonly params: Promise<{ key: string }> }): Promise<Metadata> {
  const { key } = await params;
  const { project } = await loadProject(decodeURIComponent(key));
  // Tabs read "Board · Holiday peak readiness · KitStak Projects"; the overview gets the project name alone.
  return { title: { default: project.name, template: `%s · ${project.name} · KitStak Projects` } };
}

/** Loads the project once for every tab and seeds the client cache. */
export default async function ProjectLayout({ children, params }: { readonly children: React.ReactNode; readonly params: Promise<{ key: string }> }) {
  const { key } = await params;
  const { ctx, project } = await loadProject(decodeURIComponent(key));
  if (project.kind === 'program') {
    // Programs live at /programs/KEY (docs/programs/SPEC.md 4.1): keep the tab or build number.
    const path = (await headers()).get('x-ks-path') ?? '';
    const rest = path.replace(/^\/p\/[^/?#]+/, '');
    const tab = /^\/(board|list|table|calendar|timeline)(?:[/?#]|$)/.exec(rest);
    redirect(tab ? `/programs/${project.key}/builds/${tab[1]}` : `/programs/${project.key}${rest}`);
  }
  // Tasks and people ride along with the first HTML so every tab (board, list, table, timeline,
  // calendar, workload, overview) paints real rows instead of skeletons. The layout persists across
  // tab switches, so the client cache seeded here makes later switches instant.
  const [{ tasks, people, loadedAt }] = await Promise.all([loadTabData(ctx, project.id), recordVisit(ctx, 'project', project.id)]);
  return (
    <ProjectProvider initial={project} initialTasks={tasks} initialPeople={people} loadedAt={loadedAt}>
      <ProjectFrame>{children}</ProjectFrame>
    </ProjectProvider>
  );
}
