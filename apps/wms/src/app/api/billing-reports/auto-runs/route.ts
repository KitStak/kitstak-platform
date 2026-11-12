/** `GET /api/billing-reports/auto-runs` — the period-end scheduler's state and the bills each run wrote (Billing Report panel). */
import { defineRoute } from '@/server/api/define-route';
import { autoRunHistory } from '@/server/repositories/billing-reports';

export const GET = defineRoute({
  permission: 'settings.billing_report.view',
  handler: async ({ db, auth }) => await autoRunHistory(db, auth),
});
