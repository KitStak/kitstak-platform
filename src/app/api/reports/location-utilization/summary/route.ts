/** `GET /api/reports/location-utilization/summary` — locations per utilization band (M13). */
import { defineRoute } from "@/server/api/define-route";
import { result } from "@/server/api/envelope";
import { UTILIZATION_DEF } from "@/lib/grid-defs/reports/analysis";
import { utilizationSummary } from "@/server/repositories/reports-analysis";

export const GET = defineRoute({
  name: "GET /api/reports/location-utilization/summary",
  permission: UTILIZATION_DEF.permission,
  handler: async ({ db, auth }) => result(await utilizationSummary(db, auth)),
});
