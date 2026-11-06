import { withApi } from '@/server/api';
import { createViewSchema } from '@/server/services/contracts/structure-inputs';
import { createView, listViews } from '@/server/services/views';
import { created, svc, uuidParams } from '../../../_lib/route-helpers';

const params = uuidParams('boardId');

export const GET = withApi({ permission: 'board:read', params }, (ctx) =>
  listViews(svc(ctx), ctx.params.boardId),
);

/** Personal views need only read access; the service enforces write access for shared views. */
export const POST = withApi({ permission: 'board:read', params, body: createViewSchema }, async (ctx) =>
  created(await createView(svc(ctx), ctx.params.boardId, ctx.body)),
);
