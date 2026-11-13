import { listForms, listProjects } from '@/server/domain';
import { pageContext } from '@/server/page';
import { FormsView } from './forms-view';

export async function FormsPage() {
  const { ctx } = await pageContext('/forms');
  const [forms, projects] = await Promise.all([listForms(ctx), listProjects(ctx)]);
  return <FormsView forms={forms} projects={projects} />;
}
