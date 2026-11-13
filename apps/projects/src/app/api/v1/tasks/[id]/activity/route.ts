import { apiRoute } from '@/server/http/api';
import { listTaskActivity } from '@/server/domain';

export const GET = apiRoute<{ id: string }>(async ({ ctx, params, searchParams }) =>
  listTaskActivity(ctx, params.id, { before: searchParams.get('before') ?? undefined }),
);
