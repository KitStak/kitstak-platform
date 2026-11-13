import { apiRoute } from '@/server/http/api';
import { getTaskDetail } from '@/server/domain';
import { resolveTaskParam } from '@/server/http/task-param';

/** `[id]` is the task uuid or its key (OPS-42). */
export const GET = apiRoute<{ id: string }>(async ({ ctx, params }) =>
  getTaskDetail(ctx, await resolveTaskParam(ctx, params.id)),
);
