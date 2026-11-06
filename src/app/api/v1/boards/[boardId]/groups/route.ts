import { z } from 'zod';
import { withApi } from '@/server/api';
import { createGroupSchema } from '@/server/services/contracts/structure-inputs';
import { createGroup, listGroups } from '@/server/services/groups';
import { created, svc, uuidParams } from '../../../_lib/route-helpers';

const params = uuidParams('boardId');

export const GET = withApi(
  {
    permission: 'board:read',
    params,
    query: z.object({ includeArchived: z.enum(['true', 'false']).default('false') }),
  },
  (ctx) => listGroups(svc(ctx), ctx.params.boardId, ctx.query.includeArchived === 'true'),
);

export const POST = withApi({ permission: 'board:write', params, body: createGroupSchema }, async (ctx) =>
  created(await createGroup(svc(ctx), ctx.params.boardId, ctx.body)),
);
