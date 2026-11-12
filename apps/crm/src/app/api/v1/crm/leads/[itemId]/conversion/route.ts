import { withApi } from '@/server/api';
import { getConversionPreview } from '@/server/services/crm-convert';
import { svc, uuidParams } from '../../../../_lib/route-helpers';

/** Everything the conversion wizard needs: lead fields, duplicate matches, deal stages. */
export const GET = withApi({ permission: 'item:read', params: uuidParams('itemId') }, (ctx) =>
  getConversionPreview(svc(ctx), ctx.params.itemId),
);
