import { listProjects, listTemplates } from '@/server/domain';
import { listProgramTemplates } from '@/server/domain/programs';
import { pageContext } from '@/server/page';
import { TemplatesView } from './templates-view';

export async function TemplatesPage() {
  const { ctx } = await pageContext('/templates');
  const [templates, projects, programTemplates] = await Promise.all([listTemplates(ctx), listProjects(ctx), listProgramTemplates(ctx).catch(() => [])]);
  return <TemplatesView templates={templates} projects={projects} programTemplates={programTemplates} />;
}
