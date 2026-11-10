/** `/api/tags` — list (GET) and create (POST) tag definitions (BUILD_PLAN F7). */
import { defineRoute } from "@/server/api/define-route";
import { created } from "@/server/api/envelope";
import { createTag, listTags, TAG_MANAGE_PERMISSIONS, tagCreateSchema, tagListQuerySchema } from "@/server/repositories/platform-tags";

export const GET = defineRoute({
  query: tagListQuerySchema,
  handler: ({ db, query }) => listTags(db, query),
});

export const POST = defineRoute({
  permission: TAG_MANAGE_PERMISSIONS,
  body: tagCreateSchema,
  handler: ({ db, auth, body }) => created(createTag(db, auth.user.id, body)),
});
