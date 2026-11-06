import { withApi } from '@/server/api';
import { deleteWebhook, updateWebhook } from '@/server/services/automations-webhooks';
import { updateWebhookSchema } from '@/server/services/contracts/automations-center';
import { svc, uuidParams } from '../../../_lib/route-helpers';

const params = uuidParams('webhookId');
const target = (ctx: { params: unknown }) => ({
  type: 'webhook',
  id: (ctx.params as { webhookId: string }).webhookId,
});

export const PATCH = withApi(
  {
    permission: 'webhook:manage',
    params,
    body: updateWebhookSchema,
    rateLimit: 'mutation',
    audit: { action: 'webhook.updated', target },
  },
  (ctx) => updateWebhook(svc(ctx), ctx.params.webhookId, ctx.body),
);

export const DELETE = withApi(
  { permission: 'webhook:manage', params, rateLimit: 'mutation', audit: { action: 'webhook.deleted', target } },
  (ctx) => deleteWebhook(svc(ctx), ctx.params.webhookId),
);
