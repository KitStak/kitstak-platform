/** `POST /api/vendors/bulk/active { ids, active }` — bulk activate / deactivate (deactivate blocked per vendor with open POs). */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { bulkIdsBodySchema } from '@/lib/grid-defs/receiving/po-schemas';
import { RATE_LIMITS } from '@/server/auth/rate-limit';
import { runBulk } from '@/server/domain';
import { domainCtx } from '@/server/repositories/platform-common';
import { setVendorActive } from '@/server/repositories/vendors';

export const POST = defineRoute({
  permission: 'settings.vendors.edit',
  rateLimit: RATE_LIMITS.bulkIo,
  body: bulkIdsBodySchema.extend({ active: z.boolean() }),
  handler: async ({ db, auth, actor, body }) =>
    await runBulk(db, body.ids, async (tx, id) => {
      await setVendorActive(tx, domainCtx(actor, auth), auth.scope, id, body.active);
    }),
});
