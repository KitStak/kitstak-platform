/** `GET /api/apps/[key]/change-log` — activation and settings history of an app. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { APP_ENTITY, loadApp } from "@/server/repositories/apps";
import { changeLogPageSchema, changeLogResult } from "@/server/repositories/users-shared";

export const GET = defineRoute({
  permission: ["settings.add_ons.view", "settings.company_settings.view"],
  params: z.object({ key: z.string().trim().min(1).max(60) }),
  query: changeLogPageSchema,
  handler: async ({ db, params, query }) => {
    await loadApp(db, params.key);
    return await changeLogResult(db, APP_ENTITY, params.key, query);
  },
});
