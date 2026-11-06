import { withApi } from '@/server/api';
import { listUpdateReaders } from '@/server/services/item-panel';
import { svc, uuidParams } from '../../../../_lib/route-helpers';

/** People who have read an update ("Seen by" popover). */
export const GET = withApi({ permission: 'update:read', params: uuidParams('updateId') }, (ctx) =>
  listUpdateReaders(svc(ctx), ctx.params.updateId),
);
