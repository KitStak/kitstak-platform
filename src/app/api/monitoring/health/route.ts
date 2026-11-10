/** `GET /api/monitoring/health` — Channel Health Overview grid (24h). */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listHealth } from "@/server/repositories/monitoring";

export const GET = defineRoute({
  permission: "integrations.integration_monitoring.view",
  handler: ({ db, auth, grid }) => {
    const q = grid();
    const { rows, total } = listHealth(db, auth, q);
    return listResult(rows, { total, page: q.page, pageSize: q.pageSize });
  },
});
