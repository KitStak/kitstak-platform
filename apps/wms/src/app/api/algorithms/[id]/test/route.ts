/** `POST /api/algorithms/[id]/test` — Test Algorithm (putaway): ranked suggestions + rule trace. Never writes. */
import { defineRoute } from '@/server/api/define-route';
import { AppError } from '@/server/api/errors';
import { putawayTestSchema } from '@/lib/grid-defs/integrations/algorithms';
import { idParamsSchema } from '@/server/repositories/platform-common';
import { loadAlgorithm, testPutaway } from '@/server/repositories/algorithms';

export const POST = defineRoute({
  permission: 'automation.algorithms.test',
  params: idParamsSchema,
  body: putawayTestSchema,
  transaction: false,
  handler: async ({ db, auth, params, body }) => {
    const a = await loadAlgorithm(db, auth, params.id);
    if (a.kind !== 'Putaway')
      throw new AppError(
        'VALIDATION',
        'Test Algorithm is available for putaway algorithms; use Dry run for allocation',
      );
    return await testPutaway(db, auth, a.id, { ...body, warehouseId: a.warehouseId });
  },
});
