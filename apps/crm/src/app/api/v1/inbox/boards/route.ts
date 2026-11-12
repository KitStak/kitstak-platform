import { withApi } from '@/server/api';
import { listInboxBoards } from '@/server/services/inbox-mywork-feed';
import { svc } from '../../_lib/route-helpers';

/** Boards that have inbox threads (board filter options). */
export const GET = withApi({ permission: 'update:read', rateLimit: 'default' }, (ctx) =>
  listInboxBoards(svc(ctx)),
);
