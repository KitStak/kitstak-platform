/** `GET /api/counts/suggest?warehouseId&countType=Location|SKU&limit=` - AI Count Plan: risk-ranked locations or SKUs with reasons. */
import { defineRoute } from '@/server/api/define-route';
import { COUNT_PERMISSIONS as P } from '@/lib/grid-defs/counts/count-grids';
import { countSuggestQuerySchema, suggestCountTargets } from '@/server/repositories/counts-suggest';

export const GET = defineRoute({
  permission: [P.create, P.edit],
  query: countSuggestQuerySchema,
  handler: async ({ db, auth, query }) => await suggestCountTargets(db, auth.scope, query),
});
