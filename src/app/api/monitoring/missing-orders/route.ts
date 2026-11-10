/** `GET /api/monitoring/missing-orders` — Missing Shipment Orders (unresolved unless a status filter is set). */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listMissing } from "@/server/repositories/monitoring";

export const GET = defineRoute({
  permission: "integrations.integration_monitoring.view",
  handler: ({ db, auth, grid }) => {
    const q = grid();
    const { rows, total } = listMissing(db, auth, q);
    return listResult(rows, { total, page: q.page, pageSize: q.pageSize });
  },
});
