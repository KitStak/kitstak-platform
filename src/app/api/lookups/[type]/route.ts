/** `/api/lookups/[type]` — Data Setup values: list (global + scoped) and create. */
import { defineRoute } from "@/server/api/define-route";
import { created } from "@/server/api/envelope";
import { domainCtx } from "@/server/repositories/platform-common";
import {
  createLookup, listLookups, LOOKUP_MANAGE_PERMISSION, lookupCreateSchema, lookupListQuerySchema, lookupTypeParamsSchema,
} from "@/server/repositories/platform-lookups";

export const GET = defineRoute({
  params: lookupTypeParamsSchema,
  query: lookupListQuerySchema,
  handler: ({ db, auth, params, query }) => listLookups(db, auth.viewScope, params.type, query),
});

export const POST = defineRoute({
  permission: LOOKUP_MANAGE_PERMISSION,
  params: lookupTypeParamsSchema,
  body: lookupCreateSchema,
  handler: ({ db, auth, actor, params, body }) =>
    created(createLookup(db, { ...domainCtx(actor, auth), scope: auth.scope }, params.type, body)),
});
