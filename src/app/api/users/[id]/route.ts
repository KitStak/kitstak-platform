/** `GET|PATCH /api/users/[id]` — detail and edit (optimistic `version`; password optional). */
import { z } from "zod";
import { AppError } from "@/server/api/errors";
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { getUser, parseUserSave, updateUser } from "@/server/repositories/users";

export const GET = defineRoute({
  permission: "settings.users.view",
  params: idParamsSchema,
  handler: ({ db, params }) => getUser(db, params.id),
});

export const PATCH = defineRoute({
  permission: "settings.users.edit",
  params: idParamsSchema,
  // Parsed in the handler: schema + company password policy report together.
  body: z.unknown(),
  handler: ({ db, auth, actor, params, body: raw, audit }) => {
    const body = parseUserSave(db, "update", raw);
    // Optimistic concurrency is mandatory for an edit: a save without the loaded version could
    // silently overwrite someone else's change (or the editor's own earlier save).
    if (body.version === undefined) throw new AppError("VALIDATION", "Reload the user before saving", { fieldErrors: { version: ["Required"] } });
    const result = updateUser(db, auth, actor, params.id, body);
    audit({ action: "user.update", entity: "user", entityId: params.id, detail: { sessionsRevoked: result.sessionsRevoked, passwordChanged: Boolean(body.password) } });
    if (result.sessionsRevoked) audit({ action: "session.revoke_all", entity: "user", entityId: params.id, detail: { reason: "access_changed" } });
    return result;
  },
});
