/** `GET /api/counts` — Count Plan grid (grid grammar). `POST` — Create New Count. */
import { defineRoute } from "@/server/api/define-route";
import { created, listResult } from "@/server/api/envelope";
import { COUNT_PERMISSIONS as P } from "@/lib/grid-defs/counts/count-grids";
import { countPlanInputSchema, createCountPlan, listCountPlans } from "@/server/repositories/counts-plans";
import { domainCtx } from "@/server/repositories/platform-common";

export const GET = defineRoute({
  permission: P.view,
  handler: ({ db, auth, grid }) => {
    const page = listCountPlans(db, auth.viewScope, grid());
    return listResult(page.rows, { total: page.total, page: page.page, pageSize: page.pageSize });
  },
});

export const POST = defineRoute({
  permission: P.create,
  body: countPlanInputSchema,
  handler: ({ db, auth, actor, body }) => created(createCountPlan(db, domainCtx(actor, auth), auth, body)),
});
