import { withApi } from '@/server/api';
import { rotateWebhookSecret } from '@/server/services/automations-webhooks';
import { emptyBody, svc, uuidParams } from '../../../../_lib/route-helpers';

/** Replace the signing secret; the new raw secret is returned once. */
export const POST = withApi(
  {
    permission: 'webhook:manage',
    params: uuidParams('webhookId'),
    body: emptyBody,
    rateLimit: 'heavy',
    audit: {
      action: 'webhook.secret_rotated',
      target: (ctx) => ({ type: 'webhook', id: (ctx.params as { webhookId: string }).webhookId }),
    },
  },
  (ctx) => rotateWebhookSecret(svc(ctx), ctx.params.webhookId),
);
