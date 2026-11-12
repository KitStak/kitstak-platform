/** `POST /api/rate-shopping-presets/bulk-delete { ids }` — per-id result; in-use presets are skipped with a reason. */
import { defineRoute } from '@/server/api/define-route';
import { bulkIds } from '@/lib/grid-defs/integrations/common';
import { deletePresets } from '@/server/repositories/rate-shopping';

export const POST = defineRoute({
  permission: 'automation.rate_shopping.delete',
  body: bulkIds,
  handler: async ({ db, auth, actor, body }) => await deletePresets(db, auth, actor, body.ids),
});
