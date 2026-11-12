/** `GET /api/monitoring/listing-exceptions` — Multi Listing / SKU Difference. */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listListingExceptions } from "@/server/repositories/monitoring";

export const GET = defineRoute({
  permission: "integrations.integration_monitoring.view",
  handler: async ({ db, auth, grid }) => {
    const q = grid();
    const { rows, total } = await listListingExceptions(db, auth, q);
    return listResult(rows, { total, page: q.page, pageSize: q.pageSize });
  },
});
