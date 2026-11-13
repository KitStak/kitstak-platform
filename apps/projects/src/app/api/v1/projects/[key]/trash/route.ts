import { apiRoute } from '@/server/http/api';
import { listDeletedTasks, requireProject } from '@/server/domain';

export const GET = apiRoute<{ key: string }>(async ({ ctx, params }) => {
  const { project } = await requireProject(ctx, /^[0-9a-f-]{36}$/i.test(params.key) ? { id: params.key } : { key: params.key });
  return listDeletedTasks(ctx, project.id);
});
