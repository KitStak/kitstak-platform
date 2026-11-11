/** `POST /api/roles/restrictions` `{ ids, restrictions }` — Manage Restrictions for the selected roles. */
import { defineRoute } from "@/server/api/define-route";
import { restrictionsSchema } from "@/lib/grid-defs/admin/roles";
import { setRestrictions } from "@/server/repositories/roles";

export const POST = defineRoute({
  permission: "settings.roles.manage_restrictions",
  body: restrictionsSchema,
  handler: async ({ db, auth, actor, body, audit }) => {
    const result = await setRestrictions(db, auth, actor, body.ids, body.restrictions);
    for (const id of result.succeeded) await audit({ action: "role.restrictions", entity: "role", entityId: id, detail: { restrictions: body.restrictions } });
    return result;
  },
});
