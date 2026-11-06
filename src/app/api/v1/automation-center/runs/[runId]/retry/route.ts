import { withApi } from '@/server/api';
import { retryRun } from '@/server/services/automations-center';
import { emptyBody, svc, uuidParams } from '../../../../_lib/route-helpers';

/** Re-run a past run's automation on the same item. */
export const POST = withApi(
  { permission: 'automation:write', params: uuidParams('runId'), body: emptyBody, rateLimit: 'mutation' },
  (ctx) => retryRun(svc(ctx), ctx.params.runId),
);
