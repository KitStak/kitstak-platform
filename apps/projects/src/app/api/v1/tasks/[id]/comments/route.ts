import { apiRoute } from '@/server/http/api';
import { listComments } from '@/server/domain';
import { resolveTaskParam } from '@/server/http/task-param';

/** `[id]` is the task uuid or its key (OPS-42). */
export const GET = apiRoute<{ id: string }>(async ({ ctx, params }) =>
  listComments(ctx, await resolveTaskParam(ctx, params.id)),
);
