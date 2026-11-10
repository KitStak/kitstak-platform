/** `POST /api/algorithms/test` — test an unsaved putaway draft (rolled-back savepoint). */
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { putawayTestSchema } from "@/lib/grid-defs/integrations/algorithms";
import { testPutaway } from "@/server/repositories/algorithms";

export const POST = defineRoute({
  permission: "automation.algorithms.test",
  body: putawayTestSchema,
  transaction: false,
  handler: ({ db, auth, body }) => {
    if (!body.draft) throw new AppError("VALIDATION", "Send the draft rules to test");
    return testPutaway(db, auth, null, { ...body, warehouseId: body.draft.warehouseId });
  },
});
