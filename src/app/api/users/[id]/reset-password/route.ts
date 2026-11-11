/** `POST /api/users/[id]/reset-password` — one-time temporary password; every session ends. */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { resetUserPassword } from "@/server/repositories/users";

export const POST = defineRoute({
  permission: "settings.users.edit",
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params, audit }) => {
    const result = await resetUserPassword(db, auth, actor, params.id);
    await audit({ action: "user.password_reset", entity: "user", entityId: params.id, detail: { email: result.email } });
    return result;
  },
});
