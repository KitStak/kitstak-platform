/** `GET /api/integration-logs/methods` — Channel Methods grid (next run, job status). */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listMethods } from "@/server/repositories/integration-logs";

export const GET = defineRoute({
  permission: "integrations.integration_logs.view",
  handler: ({ db, auth, grid }) => {
    const q = grid();
    const { rows, total } = listMethods(db, auth, q);
    return listResult(rows, { total, page: q.page, pageSize: q.pageSize });
  },
});
