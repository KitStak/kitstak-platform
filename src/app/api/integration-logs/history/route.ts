/** `GET /api/integration-logs/history[?connectionId]` — Channel History grid. */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listHistory } from "@/server/repositories/integration-logs";

export const GET = defineRoute({
  permission: "integrations.integration_logs.view",
  handler: async ({ db, auth, grid, searchParams }) => {
    const q = grid();
    const { rows, total } = await listHistory(db, auth, q, searchParams.get("connectionId"));
    return listResult(rows, { total, page: q.page, pageSize: q.pageSize });
  },
});
