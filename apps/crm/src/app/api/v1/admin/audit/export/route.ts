import { withApi } from '@/server/api';
import { adminAuditQuerySchema } from '@/server/services/admin-contracts';
import { exportAuditCsv } from '@/server/services/admin-security';
import { svc } from '../../../_lib/route-helpers';
import { csvResponse } from '../../_csv';

export const GET = withApi(
  { permission: 'audit:read', rateLimit: 'heavy', query: adminAuditQuerySchema },
  async (ctx) => {
    const filters = {
      category: ctx.query.category,
      actorId: ctx.query.actorId,
      from: ctx.query.from,
      to: ctx.query.to,
      tz: ctx.query.tz,
      q: ctx.query.q,
    };
    const { csv, count } = await exportAuditCsv(svc(ctx), filters);
    await ctx.audit({ action: 'data.exported', targetType: 'audit_log', metadata: { rows: count, format: 'csv', filters } });
    return csvResponse(csv, 'kitstak-audit-log');
  },
);
