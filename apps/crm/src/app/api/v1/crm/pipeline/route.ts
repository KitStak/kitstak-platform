import { withApi } from '@/server/api';
import { pipelineQuerySchema } from '@/server/services/crm-contracts';
import { getPipeline } from '@/server/services/crm-pipeline';
import { svc } from '../../_lib/route-helpers';

/** Pipeline cockpit for a deals board (funnel, forecast, quotas, risk, velocity). */
export const GET = withApi({ permission: 'item:read', query: pipelineQuerySchema }, (ctx) =>
  getPipeline(svc(ctx), ctx.query),
);
