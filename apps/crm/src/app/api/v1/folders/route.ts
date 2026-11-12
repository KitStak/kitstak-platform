import { withApi } from '@/server/api';
import { createFolderSchema } from '@/server/services/contracts/structure-inputs';
import { createFolder } from '@/server/services/workspaces';
import { created, svc } from '../_lib/route-helpers';

export const POST = withApi({ permission: 'workspace:write', body: createFolderSchema }, async (ctx) =>
  created(await createFolder(svc(ctx), ctx.body)),
);
