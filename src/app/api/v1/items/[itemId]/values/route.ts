import { withApi } from '@/server/api';
import { setCellSchema } from '@/server/services/contracts/item-inputs';
import { setCellValue } from '@/server/services/items';
import { svc, uuidParams } from '../../../_lib/route-helpers';

/** Single cell write: `{ columnKey, value }` (`value: null` clears). */
export const PUT = withApi(
  { permission: 'item:write', params: uuidParams('itemId'), body: setCellSchema },
  (ctx) => setCellValue(svc(ctx), ctx.params.itemId, ctx.body),
);
