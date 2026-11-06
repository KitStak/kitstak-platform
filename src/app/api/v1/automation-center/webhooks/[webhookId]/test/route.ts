import { withApi } from '@/server/api';
import { testWebhook } from '@/server/services/automations-webhooks';
import { emptyBody, svc, uuidParams } from '../../../../_lib/route-helpers';

/** Send a signed `webhook.test` delivery now and return the logged attempt. */
export const POST = withApi(
  { permission: 'webhook:manage', params: uuidParams('webhookId'), body: emptyBody, rateLimit: 'heavy' },
  (ctx) => testWebhook(svc(ctx), ctx.params.webhookId),
);
