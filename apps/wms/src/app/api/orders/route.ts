/**
 * `GET /api/orders?view=backlog|shipped` (grid grammar; legacy `tab=` and `status=` kept)
 * and `POST /api/orders` (create wizard → `orders.createOrder`, workflows run).
 */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { created, listResult } from '@/server/api/envelope';
import { SO_STATUSES } from '@/lib/enums';
import { ORDER_PERMISSIONS, ORDER_VIEWS } from '@/lib/grid-defs/orders/shipment-orders';
import { listOrders } from '@/server/repositories/orders';
import {
  createOrder,
  createOrderBodySchema,
  sweepStrandedAllocations,
} from '@/server/repositories/orders-commands';
import { systemCtx } from '@/server/domain';
import { parseOrderBody } from '@/server/repositories/orders-validation';
import { domainCtx } from '@/server/repositories/platform-common';

const querySchema = z
  .object({
    view: z.enum(ORDER_VIEWS).optional(),
    tab: z.enum(['backlog', 'shipped', 'returns']).optional(),
    status: z.enum(SO_STATUSES).optional(),
    pageSize: z.coerce.number().int().min(1).max(1000).optional(),
  })
  .loose();

export const GET = defineRoute({
  permission: ORDER_PERMISSIONS.view,
  query: querySchema,
  handler: async ({ db, auth, query, grid, searchParams }) => {
    const parsed = grid();
    const legacySize = !searchParams.has('ps') && query.pageSize ? { pageSize: query.pageSize } : {};
    const view = query.view ?? (query.tab === 'shipped' ? 'shipped' : 'backlog');
    // Allocated-without-a-job orders go back to Open before the backlog is read (throttled, scope-limited).
    if (view === 'backlog') await sweepStrandedAllocations(db, { ...systemCtx('System'), scope: auth.scope });
    const { rows, total } = await listOrders(db, auth.viewScope, {
      view,
      query: { ...parsed, ...legacySize },
      status: query.status,
    });
    return listResult(rows, { total, page: parsed.page, pageSize: legacySize.pageSize ?? parsed.pageSize });
  },
});

export const POST = defineRoute({
  permission: ORDER_PERMISSIONS.create,
  // Parsed in the handler so field errors use the wizard's copy ("Enter address line 1"), not raw zod text.
  body: z.unknown(),
  handler: async ({ db, auth, actor, body }) =>
    created(await createOrder(db, domainCtx(actor, auth), parseOrderBody(createOrderBodySchema, body))),
});
