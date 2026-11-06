import { withApi } from '@/server/api';
import { revokeOrgSession } from '@/server/services/admin-security';
import { svc, uuidParams } from '../../../_lib/route-helpers';

export const DELETE = withApi(
  {
    permission: 'org:update',
    params: uuidParams('sessionId'),
    audit: {
      action: 'session.revoked',
      target: (ctx) => ({ type: 'user', id: (ctx.data as { userId: string }).userId }),
      metadata: (ctx) => ({ sessionId: (ctx.params as { sessionId: string }).sessionId }),
    },
  },
  (ctx) => revokeOrgSession(svc(ctx), ctx.params.sessionId, ctx.session.session.token ?? null),
);
