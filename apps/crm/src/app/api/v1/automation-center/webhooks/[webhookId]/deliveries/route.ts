import { withApi } from '@/server/api';
import { listWebhookDeliveries } from '@/server/services/automations-webhooks';
import { listDeliveriesQuerySchema } from '@/server/services/contracts/automations-center';
import { paged, svc, uuidParams } from '../../../../_lib/route-helpers';

export const GET = withApi(
  { permission: 'webhook:manage', params: uuidParams('webhookId'), query: listDeliveriesQuerySchema, rateLimit: 'default' },
  async (ctx) => paged(await listWebhookDeliveries(svc(ctx), ctx.params.webhookId, ctx.query)),
);
