/** `GET /api/end-of-day/overdue` — Open manifests from past ship days (EOD warning banner). */
import { defineRoute } from '@/server/api/define-route';
import { overdueManifests } from '@/server/repositories/shipping-carrier-ops';

export const GET = defineRoute({
  permission: 'fulfillment.end_of_day.view',
  handler: async ({ db, auth }) => await overdueManifests(db, auth),
});
