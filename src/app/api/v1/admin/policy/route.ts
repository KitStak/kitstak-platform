import { withApi } from '@/server/api';
import { updateOrgPolicySchema } from '@/server/services/admin-contracts';
import { updateOrgPolicy } from '@/server/services/admin-org';
import { svc } from '../../_lib/route-helpers';

/** Permission + security policy (creation restrictions, email domains, IP allow-list). */
export const PATCH = withApi(
  {
    permission: 'org:update',
    body: updateOrgPolicySchema,
    audit: {
      action: 'org.policy_updated',
      target: (ctx) => ({ type: 'organization', id: (ctx.data as { id: string }).id }),
      metadata: (ctx) => ({ ...(ctx.body as object) }),
    },
  },
  (ctx) => updateOrgPolicy(svc(ctx), ctx.body, ctx.ip),
);
