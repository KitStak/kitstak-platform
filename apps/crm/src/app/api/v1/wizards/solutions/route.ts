import { withApi } from '@/server/api';
import { installSolution, installSolutionSchema } from '@/server/services/wizards-solutions';
import { created, svc } from '../../_lib/route-helpers';

/** Install a multi-board solution (e.g. the connected CRM suite) as a new workspace. */
export const POST = withApi(
  {
    permission: 'workspace:write',
    rateLimit: 'heavy',
    body: installSolutionSchema,
    audit: {
      action: 'workspace.solution_installed',
      target: (ctx) => ({ type: 'workspace', id: (ctx.data as { workspaceId: string }).workspaceId }),
      metadata: (ctx) => ({ solutionId: (ctx.body as { solutionId: string }).solutionId }),
    },
  },
  async (ctx) => created(await installSolution(svc(ctx), ctx.body)),
);
