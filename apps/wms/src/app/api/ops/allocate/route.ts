/**
 * `POST /api/ops/allocate` `{ action?: "allocate" | "deallocate", orderIds, warehouseId, algorithmId?, mode? }`
 * Manual allocation through the warehouse allocation algorithm; per-order bulk result.
 */
import { defineRoute } from '@/server/api/define-route';
import { domainCtx } from '@/server/repositories/platform-common';
import {
  ALLOCATE_PERMISSION,
  allocateSchema,
  DEALLOCATE_PERMISSION,
  runAllocation,
} from '@/server/repositories/platform-ops';

export const POST = defineRoute({
  permission: [ALLOCATE_PERMISSION, DEALLOCATE_PERMISSION],
  body: allocateSchema,
  handler: async ({ db, auth, actor, body }) => await runAllocation(db, auth, domainCtx(actor, auth), body),
});
