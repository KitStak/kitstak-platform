/** `GET /api/monitoring/health/cards?clientId` — channel radio cards (avg success, low-performing setups). */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { healthCards } from '@/server/repositories/monitoring';

export const GET = defineRoute({
  permission: 'integrations.integration_monitoring.view',
  query: z.object({ clientId: z.string().max(64).optional() }),
  handler: async ({ db, auth, query }) => await healthCards(db, auth, query.clientId ?? null),
});
