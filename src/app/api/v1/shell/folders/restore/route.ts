import { withApi } from '@/server/api';
import { restoreFolder, restoreFolderSchema } from '@/server/services/shell-folders';
import { svc } from '../../../_lib/route-helpers';

/** Undo a folder archive. */
export const POST = withApi({ permission: 'workspace:write', body: restoreFolderSchema }, (ctx) =>
  restoreFolder(svc(ctx), ctx.body),
);
