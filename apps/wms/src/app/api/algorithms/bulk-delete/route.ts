/** `POST /api/algorithms/bulk-delete { ids }` — per-id result; system and in-use algorithms are skipped with a reason. */
import { defineRoute } from '@/server/api/define-route';
import { bulkIds } from '@/lib/grid-defs/integrations/common';
import { deleteAlgorithms } from '@/server/repositories/algorithms';

export const POST = defineRoute({
  permission: 'automation.algorithms.delete',
  body: bulkIds,
  handler: async ({ db, auth, actor, body }) => await deleteAlgorithms(db, auth, actor, body.ids),
});
