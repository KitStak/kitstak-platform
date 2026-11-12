/** `GET /api/putaway` — putaway worklist (grid grammar: q/qm, f.*, sort, page, ps): received stock still in a receiving location (M05). */
import { listResult } from "@/server/api/envelope";
import { defineRoute } from "@/server/api/define-route";
import { listPutawayTasks } from "@/server/repositories/putaway-worklist";

export const GET = defineRoute({
  permission: "inventory.purchase_orders.view",
  handler: async ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total, units } = await listPutawayTasks(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize, units });
  },
});
