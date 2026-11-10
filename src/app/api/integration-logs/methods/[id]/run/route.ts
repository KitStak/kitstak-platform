/** `POST /api/integration-logs/methods/[id]/run` — Run a channel method now. */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { runMethodNow } from "@/server/repositories/integration-logs";

export const POST = defineRoute({
  permission: ["integrations.integrations.edit_setup", "integrations.integrations.create_setup"],
  params: idParamsSchema,
  transaction: false,
  rateLimit: false,
  handler: async ({ db, auth, params }) => runMethodNow(db, auth, params.id),
});
