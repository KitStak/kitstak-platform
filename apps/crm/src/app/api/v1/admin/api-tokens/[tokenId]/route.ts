import { withApi } from '@/server/api';
import { revokeApiToken } from '@/server/services/admin-security';
import { svc, uuidParams } from '../../../_lib/route-helpers';

export const DELETE = withApi(
  {
    permission: 'api_token:manage',
    params: uuidParams('tokenId'),
    audit: {
      action: 'api_token.revoked',
      target: (ctx) => ({ type: 'api_token', id: (ctx.params as { tokenId: string }).tokenId }),
      metadata: (ctx) => ({ name: (ctx.data as { name: string }).name }),
    },
  },
  (ctx) => revokeApiToken(svc(ctx), ctx.params.tokenId),
);
