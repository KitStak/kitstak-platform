/** `POST /api/company/lookups/[type]/bulk-status` `{ ids, isActive }` — activate / deactivate values. */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { bulkIdsSchema } from '@/lib/grid-defs/admin/common';
import { setLookupsActive } from '@/server/repositories/company-lookups';
import { DATA_SETUP_PERMISSION, defOf, typeParams } from '../../shared';

export const POST = defineRoute({
  permission: DATA_SETUP_PERMISSION,
  params: typeParams,
  body: bulkIdsSchema.extend({ isActive: z.boolean() }),
  handler: async ({ db, auth, actor, params, body }) =>
    await setLookupsActive(db, auth, actor, defOf(params.type), body.ids, body.isActive),
});
