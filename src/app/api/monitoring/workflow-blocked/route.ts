/** `GET /api/monitoring/workflow-blocked` — Workflow Blocked Shipment Orders. */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listBlocked } from "@/server/repositories/monitoring";

export const GET = defineRoute({
  permission: "integrations.integration_monitoring.view",
  handler: ({ db, auth, grid }) => {
    const q = grid();
    const { rows, total } = listBlocked(db, auth, q);
    return listResult(rows, { total, page: q.page, pageSize: q.pageSize });
  },
});
