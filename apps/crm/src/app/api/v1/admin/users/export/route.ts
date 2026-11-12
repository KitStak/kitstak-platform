import { withApi } from '@/server/api';
import { exportUsersCsv } from '@/server/services/admin-users';
import { svc } from '../../../_lib/route-helpers';
import { csvResponse } from '../../_csv';

export const GET = withApi({ permission: 'data:export', rateLimit: 'heavy' }, async (ctx) => {
  const { csv, count } = await exportUsersCsv(svc(ctx));
  await ctx.audit({ action: 'data.exported', targetType: 'users', metadata: { rows: count, format: 'csv' } });
  return csvResponse(csv, 'kitstak-users');
});
