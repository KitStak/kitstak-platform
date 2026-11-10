/** `GET /api/roles/[id]/change-log` — field-level history of a role (incl. granted / revoked permissions). */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { loadRole, ROLE_ENTITY } from "@/server/repositories/roles";
import { changeLogPageSchema, changeLogResult } from "@/server/repositories/users-shared";

export const GET = defineRoute({
  permission: ["settings.roles.change_log", "settings.roles.view"],
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: ({ db, params, query }) => {
    loadRole(db, params.id);
    return changeLogResult(db, ROLE_ENTITY, params.id, query);
  },
});
