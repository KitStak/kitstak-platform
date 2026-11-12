/** `/api/tags/[id]` — read, rename/recolor (optimistic `version`) and delete a tag. */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { deleteTag, getTag, TAG_MANAGE_PERMISSIONS, tagUpdateSchema, updateTag } from "@/server/repositories/platform-tags";

export const GET = defineRoute({
  params: idParamsSchema,
  handler: async ({ db, params }) => await getTag(db, params.id),
});

export const PATCH = defineRoute({
  permission: TAG_MANAGE_PERMISSIONS,
  params: idParamsSchema,
  body: tagUpdateSchema,
  handler: async ({ db, auth, params, body }) => await updateTag(db, auth.user.id, params.id, body),
});

export const DELETE = defineRoute({
  permission: TAG_MANAGE_PERMISSIONS,
  params: idParamsSchema,
  handler: async ({ db, params }) => await deleteTag(db, params.id),
});
