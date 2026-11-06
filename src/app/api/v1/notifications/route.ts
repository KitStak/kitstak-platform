import { withApi } from '@/server/api';
import { listNotifications, listNotificationsQuerySchema } from '@/server/services/notifications';
import { paged, svc } from '../_lib/route-helpers';

export const GET = withApi({ permission: 'org:read', query: listNotificationsQuerySchema }, async (ctx) => {
  const page = await listNotifications(svc(ctx), ctx.query);
  return paged(page, { unreadCount: page.unreadCount });
});
