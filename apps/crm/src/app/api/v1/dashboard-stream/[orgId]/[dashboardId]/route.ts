import { z } from 'zod';
import { withApi } from '@/server/api';
import { createBoardEventStream } from '@/server/realtime/sse';
import { filterVisibleBoardIds } from '@/server/services/access';
import { getDashboard } from '@/server/services/dashboards';
import { dashboardStreamFilter } from '@/server/services/dashboards-realtime';
import { svc, uuidParams } from '../../../_lib/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BOARDS = 50;

/**
 * Server-Sent Events for one dashboard: its own widget / layout changes plus item, column and
 * group changes on the source boards the client lists (`?boardIds=a,b`). Boards the caller cannot
 * see are dropped. Events are invalidation hints only; the client refetches through the API.
 */
export const GET = withApi(
  {
    permission: 'dashboard:read',
    params: uuidParams('orgId', 'dashboardId'),
    query: z.object({
      boardIds: z
        .string()
        .max(MAX_BOARDS * 37)
        .optional()
        .transform((value) => (value ? value.split(',').filter(Boolean) : []))
        .pipe(z.array(z.uuid()).max(MAX_BOARDS)),
    }),
  },
  async (ctx) => {
    const service = svc(ctx);
    await getDashboard(service, ctx.params.dashboardId);
    const boardIds = ctx.query.boardIds.length ? await filterVisibleBoardIds(service, ctx.query.boardIds) : [];
    return createBoardEventStream({
      orgId: service.orgId,
      userId: ctx.user.id,
      boardId: null,
      signal: ctx.request.signal,
      deliver: dashboardStreamFilter(service.orgId, ctx.params.dashboardId, boardIds),
    });
  },
);
