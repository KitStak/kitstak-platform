/** `POST /api/algorithms/dry-run { orderId, draft }` — dry run of an unsaved allocation draft. */
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { allocationDryRunSchema } from "@/lib/grid-defs/integrations/algorithms";
import { allocationDryRun } from "@/server/repositories/algorithms";

export const POST = defineRoute({
  permission: "automation.algorithms.test",
  body: allocationDryRunSchema,
  transaction: false,
  handler: async ({ db, auth, actor, body }) => {
    if (!body.draft) throw new AppError("VALIDATION", "Send the draft rules to dry run");
    return await allocationDryRun(db, auth, null, body, actor);
  },
});
