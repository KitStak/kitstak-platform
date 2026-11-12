import { withApi } from '@/server/api';
import { getCustomerLink, setCustomerLink } from '@/server/services/wms-link';
import { setCustomerLinkSchema } from '@/server/services/wms-link-contracts';
import { svc, uuidParams } from '../../../../_lib/route-helpers';

const params = uuidParams('itemId');

/** The WMS client (core customer) linked to this account, or `customer: null`. */
export const GET = withApi({ permission: 'item:read', params }, (ctx) =>
  getCustomerLink(svc(ctx), ctx.params.itemId),
);

/** Link this account to a core customer (`coreCustomerId: null` unlinks). */
export const PUT = withApi(
  {
    permission: 'item:write',
    params,
    body: setCustomerLinkSchema,
    audit: {
      action: 'crm.wms_link_updated',
      target: (ctx) => ({ type: 'item', id: (ctx.params as { itemId: string }).itemId }),
      metadata: (ctx) => ({ coreCustomerId: (ctx.body as { coreCustomerId: string | null }).coreCustomerId }),
    },
  },
  (ctx) => setCustomerLink(svc(ctx), ctx.params.itemId, ctx.body),
);
