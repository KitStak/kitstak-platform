import { withApi } from '@/server/api';
import { unlinkItemWork } from '@/server/services/projects-bridge';
import { svc, uuidParams } from '../../../../../../_lib/route-helpers';

const params = uuidParams('itemId', 'linkId');

/** Unlink a project or task from this record (the project/task itself is kept). */
export const DELETE = withApi({ permission: 'item:read', params }, async (ctx) => {
  await unlinkItemWork(svc(ctx), ctx.params.itemId, ctx.params.linkId);
  return { removed: true };
});
