/** `GET /api/counts/[id]/sheet` — countable lines + expected stock (orphaned lines carry no task). `POST` — submit one line (executes its Count task). */
import { defineRoute } from "@/server/api/define-route";
import { COUNT_ANY_VIEW, COUNT_EXECUTE_PERMISSIONS } from "@/lib/grid-defs/counts/count-grids";
import { resolvePlanId } from "@/server/repositories/counts-plans";
import { countSheet, sheetSubmitSchema, submitSheetLine } from "@/server/repositories/counts-sheet";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";

export const GET = defineRoute({
  permission: COUNT_ANY_VIEW,
  params: idParamsSchema,
  handler: ({ db, auth, params }) => countSheet(db, auth.scope, resolvePlanId(db, auth.scope, params.id)),
});

export const POST = defineRoute({
  permission: COUNT_EXECUTE_PERMISSIONS,
  params: idParamsSchema,
  body: sheetSubmitSchema,
  handler: ({ db, auth, actor, params, body }) => submitSheetLine(db, domainCtx(actor, auth), auth, resolvePlanId(db, auth.scope, params.id), body),
});
