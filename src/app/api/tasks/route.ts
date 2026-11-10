/** `GET /api/tasks?kind=order|count|replenishment` — Task Details grids (grid grammar). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { TASK_KINDS } from "@/lib/grid-defs/jobs/tasks";
import { listTasks } from "@/server/repositories/tasks";

export const GET = defineRoute({
  permission: "fulfillment.task_details.view",
  query: z.object({ kind: z.enum(TASK_KINDS).default("order") }).passthrough(),
  handler: ({ db, auth, query, grid }) => {
    const g = grid();
    const { rows, total } = listTasks(db, auth, query.kind, g);
    return listResult(rows, { total, page: g.page, pageSize: g.pageSize });
  },
});
