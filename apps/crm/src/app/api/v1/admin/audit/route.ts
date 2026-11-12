import { withApi } from '@/server/api';
import { adminAuditQuerySchema } from '@/server/services/admin-contracts';
import { listAdminAudit } from '@/server/services/admin-security';
import { paged, svc } from '../../_lib/route-helpers';

export const GET = withApi({ permission: 'audit:read', query: adminAuditQuerySchema }, async (ctx) =>
  paged(await listAdminAudit(svc(ctx), ctx.query)),
);
