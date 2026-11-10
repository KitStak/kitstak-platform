/** `GET /api/users/[id]/change-log` — field-level history of a user. */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { loadUser, USER_ENTITY } from "@/server/repositories/users";
import { changeLogPageSchema, changeLogResult } from "@/server/repositories/users-shared";

export const GET = defineRoute({
  permission: ["settings.users.change_log", "settings.users.view"],
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: ({ db, params, query }) => {
    loadUser(db, params.id);
    return changeLogResult(db, USER_ENTITY, params.id, query);
  },
});
