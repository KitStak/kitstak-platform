/**
 * `POST /api/integration-logs/methods/[id]/run` — Run a channel method now.
 * Body `{ simulateError: true }` (Download Orders on a KitStak Sandbox or demo-feed store) adds one unknown-SKU
 * order to this run so Missing Orders / Retry Download can be demonstrated on demand.
 */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { idParamsSchema } from '@/server/repositories/platform-common';
import { runMethodNow } from '@/server/repositories/integration-logs';

export const POST = defineRoute({
  permission: ['integrations.integrations.edit_setup', 'integrations.integrations.create_setup'],
  params: idParamsSchema,
  body: z.object({ simulateError: z.boolean().optional() }).strict(),
  transaction: false,
  rateLimit: false,
  handler: async ({ db, auth, params, body }) =>
    runMethodNow(db, auth, params.id, { simulateError: body.simulateError }),
});
