/** `POST /api/roles/[id]/duplicate` — copies a role (system roles included) as an editable custom role. */
import { defineRoute } from "@/server/api/define-route";
import { created } from "@/server/api/envelope";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { duplicateRole } from "@/server/repositories/roles";

export const POST = defineRoute({
  permission: "settings.roles.create",
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params, audit }) => {
    const role = await duplicateRole(db, auth, actor, params.id);
    await audit({ action: "role.duplicate", entity: "role", entityId: role.id, detail: { from: params.id, name: role.name } });
    return created(role);
  },
});
