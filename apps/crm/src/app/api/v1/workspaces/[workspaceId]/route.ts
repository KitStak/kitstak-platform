import { withApi } from '@/server/api';
import { updateWorkspaceSchema } from '@/server/services/contracts/structure-inputs';
import { deleteWorkspace, getWorkspace, updateWorkspace } from '@/server/services/workspaces';
import { svc, uuidParams } from '../../_lib/route-helpers';

const params = uuidParams('workspaceId');

export const GET = withApi({ permission: 'workspace:read', params }, (ctx) =>
  getWorkspace(svc(ctx), ctx.params.workspaceId),
);

export const PATCH = withApi({ permission: 'workspace:write', params, body: updateWorkspaceSchema }, (ctx) =>
  updateWorkspace(svc(ctx), ctx.params.workspaceId, ctx.body),
);

export const DELETE = withApi(
  {
    permission: 'workspace:delete',
    params,
    audit: {
      action: 'workspace.deleted',
      target: (ctx) => ({ type: 'workspace', id: (ctx.params as { workspaceId: string }).workspaceId }),
    },
  },
  (ctx) => deleteWorkspace(svc(ctx), ctx.params.workspaceId),
);
