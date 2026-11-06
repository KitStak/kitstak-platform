import { z } from 'zod';
import { withApi } from '@/server/api';
import { setFormPublished } from '@/server/services/board-views-forms';
import { svc, uuidParams } from '../../../_lib/route-helpers';

/** Publish / unpublish a Form view's public link (mints the token on first publish). */
export const POST = withApi(
  {
    permission: 'board:write',
    params: uuidParams('viewId'),
    body: z.object({ published: z.boolean() }).strict(),
    audit: {
      action: 'form.publish_changed',
      target: (ctx) => ({ type: 'view', id: (ctx.params as { viewId: string }).viewId }),
      metadata: (ctx) => ({ published: (ctx.body as { published: boolean }).published }),
    },
  },
  (ctx) => setFormPublished(svc(ctx), ctx.params.viewId, ctx.body.published),
);
