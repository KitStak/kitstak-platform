/** `GET /api/audit` — security Audit Log (grid grammar; newest first). Counters: `/api/audit/stats`. */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listAuditLog } from "@/server/repositories/audit";

export const GET = defineRoute({
  permission: "settings.users.view",
  handler: ({ db, grid }) => {
    const query = grid();
    const { rows, total } = listAuditLog(db, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});
