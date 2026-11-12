import { withApi } from '@/server/api';
import { archiveFolder } from '@/server/services/shell-folders';
import { emptyBody, svc, uuidParams } from '../../../../_lib/route-helpers';

/** Archive a folder: its boards are archived and the folder hidden; returns ids for Undo. */
export const POST = withApi(
  { permission: 'workspace:write', params: uuidParams('folderId'), body: emptyBody },
  (ctx) => archiveFolder(svc(ctx), ctx.params.folderId),
);
