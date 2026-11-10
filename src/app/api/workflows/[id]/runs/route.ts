/** `GET /api/workflows/[id]/runs` — run history (grid grammar). */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { listWorkflowRuns } from "@/server/repositories/workflows";

export const GET = defineRoute({
  permission: "automation.workflows.view",
  params: idParamsSchema,
  handler: ({ db, auth, params, grid }) => {
    const q = grid();
    const { rows, total } = listWorkflowRuns(db, auth, params.id, q);
    return listResult(rows, { total, page: q.page, pageSize: q.pageSize });
  },
});
