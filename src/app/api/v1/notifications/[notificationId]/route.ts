import { withApi } from '@/server/api';
import { deleteNotification } from '@/server/services/notifications';
import { svc, uuidParams } from '../../_lib/route-helpers';

/** Delete one of the caller's notifications. */
export const DELETE = withApi(
  { permission: 'org:read', rateLimit: 'mutation', params: uuidParams('notificationId') },
  (ctx) => deleteNotification(svc(ctx), ctx.params.notificationId),
);
