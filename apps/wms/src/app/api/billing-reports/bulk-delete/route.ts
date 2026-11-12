/** `POST /api/billing-reports/bulk-delete { ids }` — Draft bills only. */
import { defineRoute } from '@/server/api/define-route';
import { bulkIds } from '@/lib/grid-defs/organization/common';
import { deleteReports } from '@/server/repositories/billing-reports';

export const POST = defineRoute({
  permission: 'settings.billing_report.delete',
  body: bulkIds,
  handler: async ({ db, auth, actor, body }) => await deleteReports(db, auth, actor, body.ids),
});
