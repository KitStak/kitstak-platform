/**
 * `POST /api/tags/apply` — bulk add/remove `{ entityType, ids, tagIds, mode }`.
 * Returns the bulk result `{ succeeded, failed: [{ id, code, message }] }`.
 */
import { defineRoute } from '@/server/api/define-route';
import { applyTags, tagApplySchema, TAG_MANAGE_PERMISSIONS } from '@/server/repositories/platform-tags';

export const POST = defineRoute({
  permission: TAG_MANAGE_PERMISSIONS,
  body: tagApplySchema,
  handler: async ({ db, auth, body }) => await applyTags(db, auth, body),
});
