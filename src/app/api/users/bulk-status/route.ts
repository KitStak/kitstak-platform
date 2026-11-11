/** `POST /api/users/bulk-status` `{ ids, isActive }` — activate / deactivate; per-id result. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { bulkIdsSchema } from "@/lib/grid-defs/admin/common";
import { setUsersActive } from "@/server/repositories/users";

export const POST = defineRoute({
  permission: "settings.users.edit",
  body: bulkIdsSchema.extend({ isActive: z.boolean() }),
  handler: async ({ db, auth, actor, body, audit }) => {
    const result = await setUsersActive(db, auth, actor, body.ids, body.isActive);
    for (const id of result.succeeded) await audit({ action: body.isActive ? "user.activate" : "user.deactivate", entity: "user", entityId: id });
    return result;
  },
});
