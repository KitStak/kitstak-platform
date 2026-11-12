/** `PATCH /api/clients/[id]/settings` — Settings tab: currency + the 28 switches (optimistic `version`). */
import { defineRoute } from "@/server/api/define-route";
import { clientSettingsPatchSchema } from "@/lib/grid-defs/organization/clients";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { updateClientSettings } from "@/server/repositories/clients";

export const PATCH = defineRoute({
  permission: "settings.clients.edit",
  params: idParamsSchema,
  body: clientSettingsPatchSchema,
  handler: async ({ db, auth, actor, params, body }) => await updateClientSettings(db, auth, actor, params.id, body),
});
