/** `GET|PATCH|DELETE /api/roles/[id]` — detail, edit (optimistic `version`; system roles are view-only), guarded delete. */
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { roleSchema } from "@/lib/grid-defs/admin/roles";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { deleteRoles, getRole, rolesByIds, updateRole } from "@/server/repositories/roles";

export const GET = defineRoute({
  permission: ["settings.roles.view", "settings.users.view"],
  params: idParamsSchema,
  handler: async ({ db, params }) => await getRole(db, params.id),
});

export const PATCH = defineRoute({
  permission: "settings.roles.edit",
  params: idParamsSchema,
  body: roleSchema,
  handler: async ({ db, auth, actor, params, body, audit }) => {
    const result = await updateRole(db, auth, actor, params.id, body);
    await audit({ action: "role.update", entity: "role", entityId: params.id, detail: { permissions: body.permissions.length } });
    return result;
  },
});

export const DELETE = defineRoute({
  permission: "settings.roles.delete",
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params, audit }) => {
    // Snapshot the name first: after the delete the audit grid can't look it up any more.
    const name = (await rolesByIds(db, [params.id]))[0]?.name ?? null;
    const result = await deleteRoles(db, auth, actor, [params.id]);
    const failure = result.failed[0];
    if (failure) throw new AppError(failure.code === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_STATE", failure.message);
    await audit({ action: "role.delete", entity: "role", entityId: params.id, detail: { name } });
    return result;
  },
});
