import { withApi } from '@/server/api';
import { createAutomationSchema } from '@/server/automations-engine/recipes';
import { createAutomation, listAutomations } from '@/server/services/automations';
import { created, svc, uuidParams } from '../../../_lib/route-helpers';

const params = uuidParams('boardId');

export const GET = withApi({ permission: 'automation:read', params }, (ctx) =>
  listAutomations(svc(ctx), ctx.params.boardId),
);

export const POST = withApi(
  {
    permission: 'automation:write',
    params,
    body: createAutomationSchema,
    audit: {
      action: 'automation.created',
      target: (ctx) => ({ type: 'automation', id: (ctx.data as { id: string }).id }),
    },
  },
  async (ctx) => created(await createAutomation(svc(ctx), ctx.params.boardId, ctx.body)),
);
