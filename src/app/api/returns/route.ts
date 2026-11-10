/**
 * `GET /api/returns` — Return Orders grid (one row per RMA line, grid grammar).
 * `POST /api/returns` — Create RMA (Pending) for a shipped order, optionally buying a return label.
 */
import { defineRoute } from "@/server/api/define-route";
import { created, listResult } from "@/server/api/envelope";
import { createRma, createRmaSchema, RETURN_PERMISSIONS, scopedCtx } from "@/server/repositories/returns";
import { listReturnLines } from "@/server/repositories/returns-grid";

export const GET = defineRoute({
  permission: RETURN_PERMISSIONS.view,
  handler: ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = listReturnLines(db, auth.viewScope, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});

export const POST = defineRoute({
  permission: RETURN_PERMISSIONS.createRma,
  transaction: false,
  body: createRmaSchema,
  handler: async ({ db, auth, actor, body }) => created(await createRma(db, scopedCtx(actor, auth), body)),
});
