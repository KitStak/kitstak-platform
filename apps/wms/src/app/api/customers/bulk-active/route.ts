/** `POST /api/customers/bulk-active { ids, isActive }` — Activate / Deactivate customers. */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { bulkIds } from '@/lib/grid-defs/organization/common';
import { setCustomersActive } from '@/server/repositories/customers';

export const POST = defineRoute({
  permission: 'settings.customers.edit',
  body: bulkIds.extend({ isActive: z.boolean() }),
  handler: async ({ db, auth, actor, body }) =>
    await setCustomersActive(db, auth, actor, body.ids, body.isActive),
});
