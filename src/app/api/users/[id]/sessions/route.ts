/** `GET /api/users/[id]/sessions` — live sessions. `DELETE` — revoke all (bumps session version). */
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { bumpSessionVersion } from "@/server/auth/session-store";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { loadUser, userSessions } from "@/server/repositories/users";

export const GET = defineRoute({
  permission: "settings.users.view",
  params: idParamsSchema,
  handler: ({ db, auth, params }) => userSessions(db, auth, params.id),
});

export const DELETE = defineRoute({
  permission: "settings.users.edit",
  params: idParamsSchema,
  handler: ({ db, auth, params, audit }) => {
    loadUser(db, params.id);
    if (params.id === auth.user.id) throw new AppError("INVALID_STATE", "Use Log out of all devices to end your own sessions");
    const before = userSessions(db, auth, params.id).length;
    bumpSessionVersion(db, params.id);
    audit({ action: "session.revoke_all", entity: "user", entityId: params.id, detail: { sessions: before } });
    return { revoked: before };
  },
});
