/**
 * `GET /api/warehouses` — Warehouses grid (grid grammar).
 * `POST /api/warehouses`: create (administrators only, within the plan's warehouse count).
 */
import { getPlatformDb } from '@/server/api/db';
import { defineRoute } from '@/server/api/define-route';
import { created, listResult } from '@/server/api/envelope';
import { warehouseSchema } from '@/lib/grid-defs/facility/warehouses';
import { assertWarehouseAvailable } from '@/server/auth/plan';
import { createWarehouse, listWarehouses } from '@/server/repositories/warehouses';

export const GET = defineRoute({
  permission: ['settings.warehouse.view', 'inventory.inventory_by_location.view'],
  handler: async ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = await listWarehouses(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});

export const POST = defineRoute({
  permission: 'settings.warehouse.create',
  body: warehouseSchema,
  handler: async ({ db, auth, actor, body }) => {
    // The plan's warehouse limit (docs/billing/SPEC.md section 6.9): one more warehouse than the
    // plan covers answers PLAN_WAREHOUSE_LIMIT with the price. Nothing is charged from here.
    await assertWarehouseAvailable(await getPlatformDb(), auth.user.orgId, 1);
    return created(await createWarehouse(db, auth, actor, body));
  },
});
