import { z } from 'zod';
import { withApi } from '@/server/api';
import { createBoardEventStream } from '@/server/realtime/sse';
import { requireBoard } from '@/server/services/access';
import { svc } from '../_lib/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Server-Sent Events for one board (`?boardId=`) plus the caller's notifications.
 * Events are invalidation hints only; clients refetch through the API.
 */
export const GET = withApi(
  { permission: 'board:read', query: z.object({ boardId: z.uuid().optional() }) },
  async (ctx) => {
    const service = svc(ctx);
    if (ctx.query.boardId) await requireBoard(service, ctx.query.boardId, 'read');
    return createBoardEventStream({
      orgId: service.orgId,
      userId: ctx.user.id,
      boardId: ctx.query.boardId ?? null,
      signal: ctx.request.signal,
    });
  },
);
