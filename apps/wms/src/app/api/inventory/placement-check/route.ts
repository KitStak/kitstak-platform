/**
 * `GET /api/inventory/placement-check?kind=location|lp&id=&productIds=a,b&exclude=bucketId`
 * Destination pre-flight for the Add Inventory / Transfer drawers: count-plan lock and
 * "only 1 SKU" rules, so a bad pick is flagged before Submit (read-only).
 */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { placementCheck } from '@/server/repositories/inventory-lookups';
import { INVENTORY_PERMISSIONS as P } from '@/lib/grid-defs/inventory/permissions';

const idList = z
  .string()
  .trim()
  .max(4000)
  .optional()
  .transform((v) =>
    v
      ? v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 200)
      : [],
  )
  .pipe(z.array(z.string().min(1).max(64)));

export const GET = defineRoute({
  permission: P.byLocationView,
  query: z.object({
    kind: z.enum(['location', 'lp']),
    id: z.string().trim().min(1).max(64),
    productIds: idList,
    exclude: idList,
  }),
  handler: async ({ db, auth, query }) =>
    await placementCheck(db, auth, {
      kind: query.kind,
      id: query.id,
      productIds: query.productIds,
      excludeInventoryIds: query.exclude,
    }),
});
