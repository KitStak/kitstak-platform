/** `POST /api/algorithms/[id]/dry-run { orderId, draft? }` — allocation dry run (never commits). */
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { allocationDryRunSchema } from "@/lib/grid-defs/integrations/algorithms";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { allocationDryRun, loadAlgorithm } from "@/server/repositories/algorithms";

export const POST = defineRoute({
  permission: "automation.algorithms.test",
  params: idParamsSchema,
  body: allocationDryRunSchema,
  transaction: false,
  handler: ({ db, auth, actor, params, body }) => {
    const a = loadAlgorithm(db, auth, params.id);
    if (a.kind !== "Allocation") throw new AppError("VALIDATION", "Dry run is available for allocation algorithms");
    return allocationDryRun(db, auth, body.draft ? null : a.id, body, actor);
  },
});
