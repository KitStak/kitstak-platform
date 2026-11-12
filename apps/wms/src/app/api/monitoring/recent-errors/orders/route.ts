/** `GET /api/monitoring/recent-errors/orders?connectionId&reason&day&tz` — drilldown to the affected orders. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { recentErrorOrders } from "@/server/repositories/monitoring";

export const GET = defineRoute({
  permission: "integrations.integration_monitoring.view",
  query: z.object({ connectionId: z.string().min(1).max(64), reason: z.string().min(1).max(200), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), tz: z.string().max(64).optional() }),
  handler: async ({ db, auth, query }) => await recentErrorOrders(db, auth, query.connectionId, query.reason, query.day, query.tz),
});
