/** `GET|PATCH|DELETE /api/roles/[id]` — detail, edit (optimistic `version`; system roles are view-only), guarded delete. */
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { roleSchema } from "@/lib/grid-defs/admin/roles";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { deleteRoles, getRole, updateRole } from "@/server/repositories/roles";

export const GET = defineRoute({
  permission: ["settings.roles.view", "settings.users.view"],
  params: idParamsSchema,
  handler: ({ db, params }) => getRole(db, params.id),
});

export const PATCH = defineRoute({
  permission: "settings.roles.edit",
  params: idParamsSchema,
  body: roleSchema,
  handler: ({ db, auth, actor, params, body, audit }) => {
    const result = updateRole(db, auth, actor, params.id, body);
    audit({ action: "role.update", entity: "role", entityId: params.id, detail: { permissions: body.permissions.length } });
    return result;
  },
});

export const DELETE = defineRoute({
  permission: "settings.roles.delete",
  params: idParamsSchema,
  handler: ({ db, auth, actor, params, audit }) => {
    const result = deleteRoles(db, auth, actor, [params.id]);
    const failure = result.failed[0];
    if (failure) throw new AppError(failure.code === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_STATE", failure.message);
    audit({ action: "role.delete", entity: "role", entityId: params.id });
    return result;
  },
});
