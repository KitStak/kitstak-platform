/** `GET /api/screen-configs/[id]/change-log` — Screen configuration change log. */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { assertScreenConfigExists, SCREEN_CONFIG_ENTITY } from "@/server/repositories/screen-configs";
import { changeLogPageSchema, changeLogResult } from "@/server/repositories/users-shared";

export const GET = defineRoute({
  permission: "settings.screen_configuration.view",
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: async ({ db, auth, params, query }) => {
    await assertScreenConfigExists(db, auth, params.id);
    return await changeLogResult(db, SCREEN_CONFIG_ENTITY, params.id, query);
  },
});
