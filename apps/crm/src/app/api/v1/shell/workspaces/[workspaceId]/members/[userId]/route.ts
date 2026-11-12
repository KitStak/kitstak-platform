import { withApi } from '@/server/api';
import {
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
  updateWorkspaceMemberSchema,
} from '@/server/services/shell-workspace';
import { svc, uuidParams } from '../../../../../_lib/route-helpers';

const params = uuidParams('workspaceId', 'userId');
const audit = {
  action: 'workspace.members_changed',
  target: (ctx: { params: unknown }) => ({ type: 'workspace', id: (ctx.params as { workspaceId: string }).workspaceId }),
};

/** Change a member's workspace role (owner / member). */
export const PATCH = withApi(
  { permission: 'workspace:write', params, body: updateWorkspaceMemberSchema, audit },
  (ctx) => updateWorkspaceMemberRole(svc(ctx), ctx.params.workspaceId, ctx.params.userId, ctx.body),
);

/** Remove a member from the workspace. */
export const DELETE = withApi({ permission: 'workspace:write', params, audit }, (ctx) =>
  removeWorkspaceMember(svc(ctx), ctx.params.workspaceId, ctx.params.userId),
);
