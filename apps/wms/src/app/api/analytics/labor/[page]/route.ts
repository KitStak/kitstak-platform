/** `GET /api/analytics/labor/[page]?from=&to=&wh=` — Labor Analytics dashboards (M13 §4). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { getLaborAnalytics } from "@/server/repositories/analytics";
import { analyticsQuerySchema } from "@/server/repositories/analytics-common";
import { LABOR_APP, LABOR_PAGES } from "@/server/repositories/analytics-types";

export const GET = defineRoute({
  name: "GET /api/analytics/labor/[page]",
  permission: LABOR_APP.permission,
  params: z.object({ page: z.enum(LABOR_PAGES) }),
  query: analyticsQuerySchema,
  handler: async ({ db, auth, params, query }) => await getLaborAnalytics(db, auth, params.page, query),
});
