/** `GET /api/audit` — security Audit Log (grid grammar; newest first). Counters: `/api/audit/stats`. */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listAuditLog } from "@/server/repositories/audit";

export const GET = defineRoute({
  permission: "settings.users.view",
  handler: ({ db, grid, request }) => {
    const query = grid();
    // `group=0` shows every raw event; default collapses repeats (CSRF/permission bursts) into one row.
    const params = request.nextUrl.searchParams;
    const groupRepeats = params.get("group") !== "0";
    const entityId = params.get("entityId");
    const entity = params.get("entity") ?? params.get("entityType");
    const { rows, total } = listAuditLog(db, query, { groupRepeats, entityId, entity });
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});
