/** `GET|PATCH /api/users/[id]` — detail and edit (optimistic `version`; password optional). */
import { defineRoute } from "@/server/api/define-route";
import { userUpdateSchema } from "@/lib/grid-defs/admin/users";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { getUser, updateUser } from "@/server/repositories/users";

export const GET = defineRoute({
  permission: "settings.users.view",
  params: idParamsSchema,
  handler: ({ db, params }) => getUser(db, params.id),
});

export const PATCH = defineRoute({
  permission: "settings.users.edit",
  params: idParamsSchema,
  body: userUpdateSchema,
  handler: ({ db, auth, actor, params, body, audit }) => {
    const result = updateUser(db, auth, actor, params.id, body);
    audit({ action: "user.update", entity: "user", entityId: params.id, detail: { sessionsRevoked: result.sessionsRevoked, passwordChanged: Boolean(body.password) } });
    if (result.sessionsRevoked) audit({ action: "session.revoke_all", entity: "user", entityId: params.id, detail: { reason: "access_changed" } });
    return result;
  },
});
