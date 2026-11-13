import { apiRoute } from '@/server/http/api';
import { listProjectActivity, requireProject } from '@/server/domain';

/** ?before=<iso>&limit=50&verbs=task.created,comment.added */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params, searchParams }) => {
  const { project } = await requireProject(ctx, /^[0-9a-f-]{36}$/i.test(params.key) ? { id: params.key } : { key: params.key });
  return listProjectActivity(ctx, project.id, {
    before: searchParams.get('before') ?? undefined,
    limit: Number(searchParams.get('limit') ?? 50) || 50,
    verbs: searchParams.get('verbs')?.split(',').filter(Boolean),
  });
});
