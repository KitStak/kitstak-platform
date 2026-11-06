import { withApi } from '@/server/api';
import { markNotifications, markNotificationsSchema } from '@/server/services/notifications';
import { svc } from '../../_lib/route-helpers';

/** `{ ids: [...] }` or `{ all: true }`; `read: false` marks unread. */
export const POST = withApi({ permission: 'org:read', body: markNotificationsSchema }, (ctx) =>
  markNotifications(svc(ctx), ctx.body),
);
