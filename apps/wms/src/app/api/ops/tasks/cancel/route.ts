/** `POST /api/ops/tasks/cancel` `{ ids }` — cancels pending tasks; per-id bulk result. */
import { defineRoute } from '@/server/api/define-route';
import { domainCtx } from '@/server/repositories/platform-common';
import { cancelTasks, TASK_PERMISSIONS, taskCancelSchema } from '@/server/repositories/platform-ops';

export const POST = defineRoute({
  permission: TASK_PERMISSIONS.cancel,
  body: taskCancelSchema,
  handler: async ({ db, auth, actor, body }) => await cancelTasks(db, domainCtx(actor, auth), body.ids),
});
