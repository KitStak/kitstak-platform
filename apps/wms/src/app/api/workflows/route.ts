/** `GET /api/workflows` — grid (grid grammar). `POST` — create. */
import { defineRoute } from '@/server/api/define-route';
import { created, listResult } from '@/server/api/envelope';
import { workflowSaveSchema } from '@/lib/grid-defs/integrations/workflows';
import { createWorkflow, listWorkflows } from '@/server/repositories/workflows';

export const GET = defineRoute({
  permission: 'automation.workflows.view',
  handler: async ({ db, auth, grid }) => {
    const q = grid();
    const { rows, total } = await listWorkflows(db, auth, q);
    return listResult(rows, { total, page: q.page, pageSize: q.pageSize });
  },
});

export const POST = defineRoute({
  permission: 'automation.workflows.create',
  body: workflowSaveSchema,
  handler: async ({ db, auth, actor, body }) => created(await createWorkflow(db, auth, actor, body)),
});
