/** `GET /api/imports/batches/[id]?errorsOnly=&page=&ps=` — batch summary + row results. */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { importBatchDetails, importBatchParamsSchema, importBatchQuerySchema } from "@/server/repositories/platform-imports";

export const GET = defineRoute({
  params: importBatchParamsSchema,
  query: importBatchQuerySchema,
  handler: ({ db, auth, params, query }) => {
    const { batch, rows, total } = importBatchDetails(db, auth, params.id, query);
    return listResult(rows, { total, page: query.page, pageSize: query.ps, batch });
  },
});
