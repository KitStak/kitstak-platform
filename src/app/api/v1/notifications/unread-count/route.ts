import { withApi } from '@/server/api';
import { countUnread } from '@/server/services/notifications';
import { svc } from '../../_lib/route-helpers';

export const GET = withApi({ permission: 'org:read' }, async (ctx) => ({
  unreadCount: await countUnread(svc(ctx)),
}));
