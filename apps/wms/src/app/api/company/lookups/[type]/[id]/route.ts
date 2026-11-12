/** `GET|PATCH|DELETE /api/company/lookups/[type]/[id]` — detail, edit (optimistic `version`), delete (blocked while in use). */
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { lookupFormSchema } from "@/lib/grid-defs/admin/lookups";
import { deleteLookupValues, getLookupRow, updateLookupValue } from "@/server/repositories/company-lookups";
import { DATA_SETUP_PERMISSION, defOf, itemParams } from "../../shared";

export const GET = defineRoute({
  permission: DATA_SETUP_PERMISSION,
  params: itemParams,
  handler: async ({ db, auth, params }) => await getLookupRow(db, auth, params.type, params.id),
});

export const PATCH = defineRoute({
  permission: DATA_SETUP_PERMISSION,
  params: itemParams,
  body: lookupFormSchema,
  handler: async ({ db, auth, actor, params, body }) => await updateLookupValue(db, auth, actor, defOf(params.type), params.id, body),
});

export const DELETE = defineRoute({
  permission: DATA_SETUP_PERMISSION,
  params: itemParams,
  handler: async ({ db, auth, actor, params }) => {
    const result = await deleteLookupValues(db, auth, actor, defOf(params.type), [params.id]);
    const failure = result.failed[0];
    if (failure) throw new AppError(failure.code === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_STATE", failure.message);
    return result;
  },
});
