import { z } from 'zod';
import { withApi } from '@/server/api';
import { setWorkspaceMembers } from '@/server/services/workspaces';
import { svc, uuidParams } from '../../../_lib/route-helpers';

export const PUT = withApi(
  {
    permission: 'workspace:write',
    params: uuidParams('workspaceId'),
    body: z.object({ userIds: z.array(z.uuid()).max(1000) }),
    audit: {
      action: 'workspace.members_changed',
      target: (ctx) => ({ type: 'workspace', id: (ctx.params as { workspaceId: string }).workspaceId }),
    },
  },
  (ctx) => setWorkspaceMembers(svc(ctx), ctx.params.workspaceId, ctx.body.userIds),
);
