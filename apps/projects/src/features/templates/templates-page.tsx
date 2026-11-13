import { listProjects, listTemplates } from '@/server/domain';
import { pageContext } from '@/server/page';
import { TemplatesView } from './templates-view';

export async function TemplatesPage() {
  const { ctx } = await pageContext('/templates');
  const [templates, projects] = await Promise.all([listTemplates(ctx), listProjects(ctx)]);
  return <TemplatesView templates={templates} projects={projects} />;
}
