import { withApi } from '@/server/api';
import { updateFolderSchema } from '@/server/services/contracts/structure-inputs';
import { deleteFolder, updateFolder } from '@/server/services/workspaces';
import { svc, uuidParams } from '../../_lib/route-helpers';

const params = uuidParams('folderId');

export const PATCH = withApi({ permission: 'workspace:write', params, body: updateFolderSchema }, (ctx) =>
  updateFolder(svc(ctx), ctx.params.folderId, ctx.body),
);

export const DELETE = withApi({ permission: 'workspace:write', params }, (ctx) =>
  deleteFolder(svc(ctx), ctx.params.folderId),
);
