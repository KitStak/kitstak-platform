import { withApi } from '@/server/api';
import { createWebhook, listWebhooks } from '@/server/services/automations-webhooks';
import { createWebhookSchema, type WebhookSecretDto } from '@/server/services/contracts/automations-center';
import { created, svc, uuidParams } from '../../../../_lib/route-helpers';

const params = uuidParams('boardId');

export const GET = withApi({ permission: 'webhook:manage', params, rateLimit: 'default' }, (ctx) =>
  listWebhooks(svc(ctx), ctx.params.boardId),
);

export const POST = withApi(
  {
    permission: 'webhook:manage',
    params,
    body: createWebhookSchema,
    rateLimit: 'heavy',
    audit: {
      action: 'webhook.created',
      target: (ctx) => ({ type: 'webhook', id: (ctx.data as WebhookSecretDto).webhook.id }),
      metadata: (ctx) => ({ events: (ctx.body as { events: string[] }).events }),
    },
  },
  async (ctx) => created(await createWebhook(svc(ctx), ctx.params.boardId, ctx.body)),
);
