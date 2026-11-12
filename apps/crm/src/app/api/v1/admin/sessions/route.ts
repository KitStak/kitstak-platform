import { withApi } from '@/server/api';
import { listOrgSessions } from '@/server/services/admin-security';
import { svc } from '../../_lib/route-helpers';

/** Active sessions of every member of the organization. */
export const GET = withApi({ permission: 'org:update' }, (ctx) =>
  listOrgSessions(svc(ctx), ctx.session.session.token ?? null),
);
