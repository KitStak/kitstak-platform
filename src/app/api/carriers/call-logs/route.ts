/** `GET /api/carriers/call-logs?step=LabelGeneration|RateCall|VoidLabel` — Carrier Errors grids (errors unless a status filter is set). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listCallLogs } from "@/server/repositories/carriers";

export const GET = defineRoute({
  permission: "integrations.carrier_monitoring.view",
  query: z.object({ step: z.enum(["LabelGeneration", "RateCall", "VoidLabel"]).default("LabelGeneration") }).loose(),
  handler: async ({ db, auth, grid, query }) => {
    const q = grid();
    const { rows, total } = await listCallLogs(db, auth, query.step, q);
    return listResult(rows, { total, page: q.page, pageSize: q.pageSize });
  },
});
