import { apiRoute } from '@/server/http/api';
import { pulseAccessFor } from '@/server/domain';
import { orgModuleFlags } from '@/server/entitlements';
import { integrationAvailability } from '@/server/integrations';
import type { MeResponse } from '@/lib/types';

/** The signed-in person, active org, memberships, Pulse role, money rights, module and integration flags. */
export const GET = apiRoute(async ({ ctx, context }): Promise<MeResponse> => {
  const [access, modules, integrations] = await Promise.all([pulseAccessFor(ctx), orgModuleFlags(ctx.orgId), integrationAvailability(ctx)]);
  return {
    user: context.user,
    org: context.org,
    orgRole: context.orgRole,
    orgs: context.orgs,
    pulseRole: access.role,
    seesMoney: access.seesMoney,
    seesWages: access.seesWages,
    modules,
    integrations,
  };
});
