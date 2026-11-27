import { apiRoute } from '@/server/http/api';
import { requireProject } from '@/server/domain';
import { listRecordLinksFor, projectProgramChips } from '@/server/domain/programs';

/** GET /api/v1/projects/:key/record-links (project Linked panel and overview program chips). */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params }) => {
  const { project } = await requireProject(ctx, { key: decodeURIComponent(params.key) }, 'project:read', undefined, { kind: 'project' });
  const [links, programs] = await Promise.all([listRecordLinksFor(ctx, { type: 'pm_project', id: project.id }), projectProgramChips(ctx, project.id)]);
  return { links, programs };
});
