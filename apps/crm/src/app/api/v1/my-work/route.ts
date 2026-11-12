import { withApi } from '@/server/api';
import { myWorkQuerySchema } from '@/server/services/contracts/inbox-mywork';
import { listMyWork } from '@/server/services/inbox-mywork-my-work';
import { svc } from '../_lib/route-helpers';

/** Items assigned to the caller across every visible board (My work page). */
export const GET = withApi(
  { permission: 'item:read', rateLimit: 'default', query: myWorkQuerySchema },
  (ctx) => listMyWork(svc(ctx), ctx.query),
);
