import { apiRoute } from '@/server/http/api';
import { listBuilds } from '@/server/domain/programs';
import { dateParam, listParam } from '../../_lib';

/** GET /api/v1/programs/:key/builds?from=&to=&status=&variant=&assignee=&run=&cursor=&limit= (default today minus 14 to plus 14). */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params, searchParams }) =>
  listBuilds(ctx, decodeURIComponent(params.key), {
    from: dateParam(searchParams.get('from')),
    to: dateParam(searchParams.get('to')),
    status: listParam(searchParams.get('status')),
    variantIds: listParam(searchParams.get('variant')),
    assigneeIds: listParam(searchParams.get('assignee')),
    runId: searchParams.get('run') ?? undefined,
    cursor: searchParams.get('cursor'),
    limit: Number(searchParams.get('limit')) || undefined,
  }),
);
