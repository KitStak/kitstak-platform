/** `GET /api/end-of-day` — End Of The Day manifests (stored + pending), grid grammar. */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listEndOfDay } from "@/server/repositories/end-of-day";

export const GET = defineRoute({
  permission: "fulfillment.end_of_day.view",
  handler: ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = listEndOfDay(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});
