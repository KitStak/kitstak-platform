import { withApi } from '@/server/api';
import { auditQuerySchema, listAuditLog } from '@/server/services/org';
import { paged, svc } from '../_lib/route-helpers';

export const GET = withApi({ permission: 'audit:read', query: auditQuerySchema }, async (ctx) =>
  paged(await listAuditLog(svc(ctx), ctx.query)),
);
