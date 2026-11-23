/** `POST /api/warehouses/bulk-active { ids, active }` — Activate / Deactivate (blocked while work is open). */
import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getPlatformDb } from '@/server/api/db';
import { defineRoute } from '@/server/api/define-route';
import { bulkIds } from '@/lib/grid-defs/facility/common';
import { assertWarehouseAvailable } from '@/server/auth/plan';
import { warehouses } from '@/server/db/schema';
import { setWarehousesActive } from '@/server/repositories/warehouses';

export const POST = defineRoute({
  permission: 'settings.warehouse.edit',
  body: bulkIds.extend({ active: z.boolean() }),
  handler: async ({ db, auth, actor, body }) => {
    if (body.active) {
      // Turning a warehouse back on counts toward the plan's warehouse limit (docs/billing/SPEC.md
      // section 6.9). Only the ones that are off today add to the count.
      const rows = await db
        .select({ id: warehouses.id, isActive: warehouses.isActive })
        .from(warehouses)
        .where(inArray(warehouses.id, [...body.ids]));
      const adding = rows.filter((row) => !row.isActive).length;
      await assertWarehouseAvailable(await getPlatformDb(), auth.user.orgId, adding);
    }
    return await setWarehousesActive(db, auth, actor, body.ids, body.active);
  },
});
