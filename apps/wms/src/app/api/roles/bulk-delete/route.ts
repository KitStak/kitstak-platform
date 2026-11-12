/** `POST /api/roles/bulk-delete` `{ ids }` — deletes custom roles with no users; per-id result. */
import { defineRoute } from "@/server/api/define-route";
import { bulkIdsSchema } from "@/lib/grid-defs/admin/common";
import { deleteRoles, rolesByIds } from "@/server/repositories/roles";

export const POST = defineRoute({
  permission: "settings.roles.delete",
  body: bulkIdsSchema,
  handler: async ({ db, auth, actor, body, audit }) => {
    // Snapshot names first: after the delete the audit grid can't look them up any more.
    const names = new Map((await rolesByIds(db, body.ids)).map((x) => [x.id, x.name]));
    const result = await deleteRoles(db, auth, actor, body.ids);
    for (const id of result.succeeded) await audit({ action: "role.delete", entity: "role", entityId: id, detail: { name: names.get(id) ?? null } });
    return result;
  },
});
