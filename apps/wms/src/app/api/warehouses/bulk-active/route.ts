/** `POST /api/warehouses/bulk-active { ids, active }` — Activate / Deactivate (blocked while work is open). */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { bulkIds } from '@/lib/grid-defs/facility/common';
import { setWarehousesActive } from '@/server/repositories/warehouses';

export const POST = defineRoute({
  permission: 'settings.warehouse.edit',
  body: bulkIds.extend({ active: z.boolean() }),
  handler: async ({ db, auth, actor, body }) =>
    await setWarehousesActive(db, auth, actor, body.ids, body.active),
});
