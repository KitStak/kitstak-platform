/** `GET /api/allocation-exceptions` — Allocation Exceptions grid. */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listAllocationExceptions } from "@/server/repositories/waves";
import { withBusyRetry } from "@/server/repositories/jobs-read-retry";

export const GET = defineRoute({
  permission: "reports.wave_exceptions.view",
  handler: async ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = await withBusyRetry(async () => await listAllocationExceptions(db, auth, query));
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});
