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
  handler: async ({ db, auth, params, query }) => await listLookups(db, auth.viewScope, params.type, query),
});

export const POST = defineRoute({
  permission: LOOKUP_MANAGE_PERMISSION,
  params: lookupTypeParamsSchema,
  body: lookupCreateSchema,
  handler: async ({ db, auth, actor, params, body }) =>
    created(await createLookup(db, { ...domainCtx(actor, auth), scope: auth.scope }, params.type, body)),
});
