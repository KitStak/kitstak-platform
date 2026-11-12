/** `/api/lookups/[type]/[id]` — read, update (`version`) and delete one lookup value. */
import { defineRoute } from '@/server/api/define-route';
import { domainCtx } from '@/server/repositories/platform-common';
import {
  deleteLookup,
  getLookup,
  LOOKUP_MANAGE_PERMISSION,
  lookupItemParamsSchema,
  lookupUpdateSchema,
  updateLookup,
} from '@/server/repositories/platform-lookups';

export const GET = defineRoute({
  params: lookupItemParamsSchema,
  handler: async ({ db, auth, params }) => await getLookup(db, auth.scope, params.type, params.id),
});

export const PATCH = defineRoute({
  permission: LOOKUP_MANAGE_PERMISSION,
  params: lookupItemParamsSchema,
  body: lookupUpdateSchema,
  handler: async ({ db, auth, actor, params, body }) =>
    await updateLookup(db, { ...domainCtx(actor, auth), scope: auth.scope }, params.type, params.id, body),
});

export const DELETE = defineRoute({
  permission: LOOKUP_MANAGE_PERMISSION,
  params: lookupItemParamsSchema,
  handler: async ({ db, auth, actor, params }) =>
    await deleteLookup(db, { ...domainCtx(actor, auth), scope: auth.scope }, params.type, params.id),
});
