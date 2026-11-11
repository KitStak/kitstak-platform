/** `GET /api/returns/[id]/history?page=&ps=` — field-level change log of one RMA (scope-checked). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { listChangeLog } from "@/server/repositories/platform-change-log";
import { getReturnDetail, RETURN_PERMISSIONS } from "@/server/repositories/returns";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  ps: z.coerce.number().int().min(1).max(500).default(100),
});

export const GET = defineRoute({
  permission: RETURN_PERMISSIONS.view,
  params: idParamsSchema,
  query: querySchema,
  handler: async ({ db, auth, params, query }) => {
    // Throws NOT_FOUND (JSON envelope) when the RMA is missing or out of scope.
    const ro = await getReturnDetail(db, auth.scope, params.id);
    const { rows, total } = await listChangeLog(db, auth, { entityType: "return_order", entityId: ro.id, page: query.page, ps: query.ps, includeLines: true });
    return listResult(rows, { total, page: query.page, pageSize: query.ps });
  },
});
