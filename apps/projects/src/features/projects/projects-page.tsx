import { listProjects, listSpaces } from '@/server/domain';
import { pageContext } from '@/server/page';
import { ProjectsDirectory } from './projects-directory';

export async function ProjectsPage({ space }: { readonly space?: string }) {
  const { ctx } = await pageContext('/projects');
  const [projects, spaces] = await Promise.all([listProjects(ctx), listSpaces(ctx)]);
  return <ProjectsDirectory initialProjects={projects} initialSpaces={spaces} spaceFilter={space} />;
}
