import { withApi } from '@/server/api';
import { inboxQuerySchema } from '@/server/services/contracts/inbox-mywork';
import { listInboxFeed } from '@/server/services/inbox-mywork-feed';
import { paged, svc } from '../_lib/route-helpers';

/** Update threads on items the caller follows (Inbox page). `meta.unreadCount` counts unread threads. */
export const GET = withApi(
  { permission: 'update:read', rateLimit: 'default', query: inboxQuerySchema },
  async (ctx) => {
    const page = await listInboxFeed(svc(ctx), ctx.query);
    return paged(page, { unreadCount: page.unreadCount });
  },
);
