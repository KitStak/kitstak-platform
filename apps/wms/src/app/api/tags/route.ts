/** `/api/tags` — list (GET) and create (POST) tag definitions (BUILD_PLAN F7). */
import { defineRoute } from "@/server/api/define-route";
import { created } from "@/server/api/envelope";
import { createTag, listTags, TAG_MANAGE_PERMISSIONS, tagCreateSchema, tagListQuerySchema } from "@/server/repositories/platform-tags";

export const GET = defineRoute({
  query: tagListQuerySchema,
  handler: async ({ db, query }) => await listTags(db, query),
});

export const POST = defineRoute({
  permission: TAG_MANAGE_PERMISSIONS,
  body: tagCreateSchema,
  handler: async ({ db, auth, body }) => created(await createTag(db, auth.user.id, body)),
});
