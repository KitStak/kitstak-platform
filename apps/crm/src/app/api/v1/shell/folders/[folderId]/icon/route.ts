import { withApi } from '@/server/api';
import { folderIconSchema, setFolderIcon } from '@/server/services/shell-folders';
import { svc, uuidParams } from '../../../../_lib/route-helpers';

/** Set (or clear) a folder's custom icon. */
export const PUT = withApi(
  { permission: 'workspace:write', params: uuidParams('folderId'), body: folderIconSchema },
  (ctx) => setFolderIcon(svc(ctx), ctx.params.folderId, ctx.body),
);
