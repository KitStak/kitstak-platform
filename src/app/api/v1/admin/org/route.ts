import { withApi } from '@/server/api';
import { updateOrgGeneralSchema } from '@/server/services/admin-contracts';
import { getOrgAdmin, updateOrgGeneral } from '@/server/services/admin-org';
import { svc } from '../../_lib/route-helpers';

/** Organization profile + settings for the admin center. */
export const GET = withApi({ permission: 'org:update' }, (ctx) => getOrgAdmin(svc(ctx), ctx.ip));

export const PATCH = withApi(
  {
    permission: 'org:update',
    body: updateOrgGeneralSchema,
    audit: {
      action: 'org.updated',
      target: (ctx) => ({ type: 'organization', id: (ctx.data as { id: string }).id }),
      metadata: (ctx) => ({ fields: Object.keys(ctx.body as object) }),
    },
  },
  (ctx) => updateOrgGeneral(svc(ctx), ctx.body, ctx.ip),
);
