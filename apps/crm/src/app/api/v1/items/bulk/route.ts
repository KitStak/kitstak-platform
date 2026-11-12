import { withApi } from '@/server/api';
import { ForbiddenError } from '@/server/http/errors';
import { hasPermission } from '@/server/rbac';
import { bulkItemsSchema } from '@/server/services/contracts/item-inputs';
import { bulkItems } from '@/server/services/items-bulk';
import { svc } from '../../_lib/route-helpers';

/** Multi-select actions: update values, move, duplicate, archive, delete, restore. */
export const POST = withApi(
  { permission: 'item:write', rateLimit: 'heavy', body: bulkItemsSchema },
  (ctx) => {
    if (ctx.body.action === 'delete' && !hasPermission(ctx.org.roles, 'item:delete')) {
      throw new ForbiddenError(undefined, { permission: 'item:delete' });
    }
    return bulkItems(svc(ctx), ctx.body);
  },
);
