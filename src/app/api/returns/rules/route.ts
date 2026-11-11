/** `GET /api/returns/rules` — the Return Process parameters the Return Station enforces (read-only). */
import { defineRoute } from "@/server/api/define-route";
import { getReturnRules } from "@/server/repositories/company-return-rules";
import { RETURN_PERMISSIONS } from "@/server/repositories/returns";

export const GET = defineRoute({
  permission: RETURN_PERMISSIONS.station,
  handler: async ({ db }) => await getReturnRules(db),
});
