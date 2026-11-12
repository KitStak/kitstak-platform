/** `GET /api/carriers/call-logs/[id]` — Transaction Details (request / response JSON). */
import { defineRoute } from '@/server/api/define-route';
import { idParamsSchema } from '@/server/repositories/platform-common';
import { getCallLog } from '@/server/repositories/carriers';

export const GET = defineRoute({
  permission: 'integrations.carrier_monitoring.view',
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => await getCallLog(db, auth, params.id),
});
