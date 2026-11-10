/** `/api/custom-fields/[id]` — read and update (name, options, active, `version`). */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import {
  ANY_CUSTOM_FIELD_PERMISSION, customFieldUpdateSchema, getCustomField, updateCustomField,
} from "@/server/repositories/platform-custom-fields";

export const GET = defineRoute({
  params: idParamsSchema,
  handler: ({ db, params }) => getCustomField(db, params.id),
});

export const PATCH = defineRoute({
  permission: ANY_CUSTOM_FIELD_PERMISSION,
  params: idParamsSchema,
  body: customFieldUpdateSchema,
  handler: ({ db, auth, params, body }) => updateCustomField(db, auth, params.id, body),
});
