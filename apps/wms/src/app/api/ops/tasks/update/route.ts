/** `POST /api/ops/tasks/update` — retarget a pending task or move it to another job. */
import { defineRoute } from '@/server/api/define-route';
import { tasks } from '@/server/domain';
import { domainCtx } from '@/server/repositories/platform-common';
import { TASK_PERMISSIONS, taskUpdateSchema } from '@/server/repositories/platform-ops';

export const POST = defineRoute({
  permission: TASK_PERMISSIONS.update,
  body: taskUpdateSchema,
  handler: async ({ db, auth, actor, body }) => await tasks.update(db, domainCtx(actor, auth), body),
});
