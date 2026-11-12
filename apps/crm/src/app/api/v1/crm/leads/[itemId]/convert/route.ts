import { withApi } from '@/server/api';
import { convertLeadSchema } from '@/server/services/crm-contracts';
import { convertLead } from '@/server/services/crm-convert';
import { created, svc, uuidParams } from '../../../../_lib/route-helpers';

/** Convert a lead into an account + contact (+ optional deal), all linked. */
export const POST = withApi(
  {
    permission: 'item:write',
    params: uuidParams('itemId'),
    body: convertLeadSchema,
    audit: { action: 'crm.lead_converted', target: (ctx) => ({ type: 'item', id: (ctx.params as { itemId: string }).itemId }) },
  },
  async (ctx) => created(await convertLead(svc(ctx), ctx.params.itemId, ctx.body)),
);
