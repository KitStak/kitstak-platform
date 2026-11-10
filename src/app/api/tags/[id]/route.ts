/** `/api/tags/[id]` — read, rename/recolor (optimistic `version`) and delete a tag. */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { deleteTag, getTag, TAG_MANAGE_PERMISSIONS, tagUpdateSchema, updateTag } from "@/server/repositories/platform-tags";

export const GET = defineRoute({
  params: idParamsSchema,
  handler: ({ db, params }) => getTag(db, params.id),
});

export const PATCH = defineRoute({
  permission: TAG_MANAGE_PERMISSIONS,
  params: idParamsSchema,
  body: tagUpdateSchema,
  handler: ({ db, auth, params, body }) => updateTag(db, auth.user.id, params.id, body),
});

export const DELETE = defineRoute({
  permission: TAG_MANAGE_PERMISSIONS,
  params: idParamsSchema,
  handler: ({ db, params }) => deleteTag(db, params.id),
});
