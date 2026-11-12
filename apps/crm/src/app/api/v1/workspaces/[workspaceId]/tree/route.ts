import { withApi } from '@/server/api';
import { getWorkspaceTree } from '@/server/services/workspaces';
import { svc, uuidParams } from '../../../_lib/route-helpers';

export const GET = withApi({ permission: 'workspace:read', params: uuidParams('workspaceId') }, (ctx) =>
  getWorkspaceTree(svc(ctx), ctx.params.workspaceId),
);
