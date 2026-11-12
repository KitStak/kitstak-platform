/** `GET /api/company/lookups/[type]/[id]/change-log` — history of one lookup value. */
import { defineRoute } from '@/server/api/define-route';
import { getLookupRow, LOOKUP_ENTITY } from '@/server/repositories/company-lookups';
import { changeLogPageSchema, changeLogResult } from '@/server/repositories/users-shared';
import { DATA_SETUP_PERMISSION, itemParams } from '../../../shared';

export const GET = defineRoute({
  permission: DATA_SETUP_PERMISSION,
  params: itemParams,
  query: changeLogPageSchema,
  handler: async ({ db, auth, params, query }) => {
    await getLookupRow(db, auth, params.type, params.id);
    return await changeLogResult(db, LOOKUP_ENTITY, params.id, query);
  },
});
