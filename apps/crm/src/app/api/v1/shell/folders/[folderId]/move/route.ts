import { withApi } from '@/server/api';
import { moveFolderSchema, moveFolderToWorkspace } from '@/server/services/shell-folders';
import { svc, uuidParams } from '../../../../_lib/route-helpers';

/** Move a folder (with its sub-folders and boards) to another workspace. */
export const POST = withApi(
  { permission: 'workspace:write', params: uuidParams('folderId'), body: moveFolderSchema },
  (ctx) => moveFolderToWorkspace(svc(ctx), ctx.params.folderId, ctx.body),
);
