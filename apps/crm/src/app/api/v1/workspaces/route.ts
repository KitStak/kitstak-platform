import { withApi } from '@/server/api';
import { createWorkspaceSchema } from '@/server/services/contracts/structure-inputs';
import { createWorkspace, listWorkspaces } from '@/server/services/workspaces';
import { created, svc } from '../_lib/route-helpers';

export const GET = withApi({ permission: 'workspace:read' }, (ctx) => listWorkspaces(svc(ctx)));

export const POST = withApi({ permission: 'workspace:write', body: createWorkspaceSchema }, async (ctx) =>
  created(await createWorkspace(svc(ctx), ctx.body)),
);
