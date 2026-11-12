/** `GET /api/rate-shopping-presets/[id]/change-log` — field-level history. */
import { defineRoute } from '@/server/api/define-route';
import { idParamsSchema } from '@/server/repositories/platform-common';
import { changeLogPageSchema, changeLogResult } from '@/server/repositories/integration-logs-kit';
import { loadPreset } from '@/server/repositories/rate-shopping';

export const GET = defineRoute({
  permission: 'automation.rate_shopping.change_log',
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: async ({ db, auth, params, query }) => {
    await loadPreset(db, auth, params.id);
    return await changeLogResult(db, 'rate_shopping_preset', params.id, query);
  },
});
