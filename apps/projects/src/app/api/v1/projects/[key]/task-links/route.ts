import { apiRoute } from '@/server/http/api';
import { listProjectTaskLinks, requireProject } from '@/server/domain';

/** Task-level CRM/WMS links of every task in the project (chips on board, list and table). */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params }) => {
  const { project } = await requireProject(ctx, /^[0-9a-f-]{36}$/i.test(params.key) ? { id: params.key } : { key: params.key });
  return listProjectTaskLinks(ctx, project.id);
});
