/** `POST /api/monitoring/missing-orders/retry { ids }` — Retry Download (re-fetch from the channel and import). */
import { defineRoute } from '@/server/api/define-route';
import { bulkIds } from '@/lib/grid-defs/integrations/common';
import { retryMissing } from '@/server/repositories/monitoring';

export const POST = defineRoute({
  permission: ['integrations.integrations.edit_setup', 'integrations.integrations.create_setup'],
  body: bulkIds,
  transaction: false,
  rateLimit: false,
  handler: async ({ db, auth, body }) => retryMissing(db, auth, body.ids),
});
