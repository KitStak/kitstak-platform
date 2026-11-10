/** `POST /api/workflows/test { orderId, draft }` — Test against order (dry run, always rolled back). */
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { workflowTestSchema } from "@/lib/grid-defs/integrations/workflows";
import { testWorkflow } from "@/server/repositories/workflows";

export const POST = defineRoute({
  permission: "automation.workflows.view",
  body: workflowTestSchema,
  transaction: false,
  handler: ({ db, auth, actor, body }) => {
    if (!body.draft) throw new AppError("VALIDATION", "Send the workflow to test");
    return testWorkflow(db, auth, actor, body.draft, body.orderId);
  },
});
