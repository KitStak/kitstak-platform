/** `POST /api/ops/tasks/execute` — executes tasks into a target location/LP (all or nothing). */
import { defineRoute } from "@/server/api/define-route";
import { tasks } from "@/server/domain";
import { domainCtx } from "@/server/repositories/platform-common";
import { TASK_PERMISSIONS, taskExecuteSchema } from "@/server/repositories/platform-ops";

export const POST = defineRoute({
  permission: TASK_PERMISSIONS.execute,
  body: taskExecuteSchema,
  handler: async ({ db, auth, actor, body }) => await tasks.execute(db, domainCtx(actor, auth), body),
});
