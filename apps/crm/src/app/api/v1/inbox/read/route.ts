import { withApi } from '@/server/api';
import { inboxReadSchema } from '@/server/services/contracts/inbox-mywork';
import { markInboxRead } from '@/server/services/inbox-mywork-feed';
import { svc } from '../../_lib/route-helpers';

/** `{ updateIds, read }` marks threads/replies read (or unread) for the caller. */
export const POST = withApi(
  { permission: 'update:read', rateLimit: 'mutation', body: inboxReadSchema },
  (ctx) => markInboxRead(svc(ctx), ctx.body),
);
