import { apiRoute, boolParam } from '@/server/http/api';
import { listProjectTasks, requireProject } from '@/server/domain';

/** ?completed=0 hides done/cancelled, ?subtasks=0 hides subtasks. */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params, searchParams }) => {
  const { project } = await requireProject(ctx, /^[0-9a-f-]{36}$/i.test(params.key) ? { id: params.key } : { key: params.key });
  return listProjectTasks(ctx, project.id, {
    includeCompleted: boolParam(searchParams.get('completed'), true),
    includeSubtasks: boolParam(searchParams.get('subtasks'), true),
  });
});
