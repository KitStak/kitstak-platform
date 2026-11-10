/**
 * `GET /api/tasks?kind=order|count|replenishment` — Task Details grids (grid grammar:
 * `page`, `ps`, `sort`, `q`, `f.*`). `pageSize` is accepted as an alias of `ps`.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { TASK_KINDS } from "@/lib/grid-defs/jobs/tasks";
import { listTasks } from "@/server/repositories/tasks";
import { withBusyRetry } from "@/server/repositories/jobs-read-retry";

const MAX_PAGE_SIZE = 500;

export const GET = defineRoute({
  permission: "fulfillment.task_details.view",
  query: z.object({
    kind: z.enum(TASK_KINDS).default("order"),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
    ps: z.string().optional(),
  }).passthrough(),
  handler: async ({ db, auth, query, grid }) => {
    const parsed = grid();
    const g = query.pageSize !== undefined && query.ps === undefined ? { ...parsed, pageSize: query.pageSize } : parsed;
    const { rows, total } = await withBusyRetry(() => listTasks(db, auth, query.kind, g));
    return listResult(rows, { total, page: g.page, pageSize: g.pageSize });
  },
});
