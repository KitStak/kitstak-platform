/** `POST /api/company/lookups/[type]/bulk-delete` `{ ids }` — deletes unused values; in-use values fail with a reason. */
import { defineRoute } from '@/server/api/define-route';
import { bulkIdsSchema } from '@/lib/grid-defs/admin/common';
import { deleteLookupValues } from '@/server/repositories/company-lookups';
import { DATA_SETUP_PERMISSION, defOf, typeParams } from '../../shared';

export const POST = defineRoute({
  permission: DATA_SETUP_PERMISSION,
  params: typeParams,
  body: bulkIdsSchema,
  handler: async ({ db, auth, actor, params, body }) =>
    await deleteLookupValues(db, auth, actor, defOf(params.type), body.ids),
});
