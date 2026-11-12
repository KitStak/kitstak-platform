import { withApi } from '@/server/api';
import {
  addWorkspaceMember,
  addWorkspaceMemberSchema,
  listWorkspaceMembers,
} from '@/server/services/shell-workspace';
import { created, svc, uuidParams } from '../../../../_lib/route-helpers';

const params = uuidParams('workspaceId');

/** Explicit members of a workspace, with user details and role. */
export const GET = withApi({ permission: 'workspace:read', params }, (ctx) =>
  listWorkspaceMembers(svc(ctx), ctx.params.workspaceId),
);

/** Add one member (existing members keep their role). */
export const POST = withApi(
  {
    permission: 'workspace:write',
    params,
    body: addWorkspaceMemberSchema,
    audit: {
      action: 'workspace.members_changed',
      target: (ctx) => ({ type: 'workspace', id: (ctx.params as { workspaceId: string }).workspaceId }),
    },
  },
  async (ctx) => created(await addWorkspaceMember(svc(ctx), ctx.params.workspaceId, ctx.body)),
);
