import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { ProjectFrame, ProjectProvider } from '@/features/projects';
import { getProjectDetail, recordVisit } from '@/server/domain';
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
  await recordVisit(ctx, 'project', project.id);
  return (
    <ProjectProvider initial={project}>
      <ProjectFrame>{children}</ProjectFrame>
    </ProjectProvider>
  );
}
