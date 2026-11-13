import { apiRoute } from '@/server/http/api';
import { getTaskDetail, resolveTaskKey } from '@/server/domain';
import { parseTaskKey } from '@/lib/task-key';
import { notFound } from '@/server/errors';

/** `[id]` is the task uuid or its key (OPS-42). */
export const GET = apiRoute<{ id: string }>(async ({ ctx, params }) => {
  if (/^[0-9a-f-]{36}$/i.test(params.id)) return getTaskDetail(ctx, params.id);
  const ref = parseTaskKey(params.id);
  if (!ref) throw notFound('That task');
  return getTaskDetail(ctx, await resolveTaskKey(ctx, ref.projectKey, ref.number));
});
