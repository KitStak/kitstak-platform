/** `POST /api/roles/bulk-delete` `{ ids }` — deletes custom roles with no users; per-id result. */
import { defineRoute } from "@/server/api/define-route";
import { bulkIdsSchema } from "@/lib/grid-defs/admin/common";
import { deleteRoles } from "@/server/repositories/roles";

export const POST = defineRoute({
  permission: "settings.roles.delete",
  body: bulkIdsSchema,
  handler: ({ db, auth, actor, body, audit }) => {
    const result = deleteRoles(db, auth, actor, body.ids);
    for (const id of result.succeeded) audit({ action: "role.delete", entity: "role", entityId: id });
    return result;
  },
});
