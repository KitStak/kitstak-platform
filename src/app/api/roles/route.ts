/** `GET /api/roles` — Roles grid (grid grammar). `POST` — Add Role with the permission matrix. */
import { defineRoute } from "@/server/api/define-route";
import { created, listResult } from "@/server/api/envelope";
import { roleSchema } from "@/lib/grid-defs/admin/roles";
import { createRole, listRoles } from "@/server/repositories/roles";

export const GET = defineRoute({
  permission: ["settings.roles.view", "settings.users.view"],
  handler: ({ db, grid }) => {
    const query = grid();
    const { rows, total } = listRoles(db, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});

export const POST = defineRoute({
  permission: "settings.roles.create",
  body: roleSchema,
  handler: ({ db, auth, actor, body, audit }) => {
    const role = createRole(db, auth, actor, body);
    audit({ action: "role.create", entity: "role", entityId: role.id, detail: { name: role.name, permissions: body.permissions.length } });
    return created(role);
  },
});
