import { apiRoute } from '@/server/http/api';
import { getRunningTimer, getUserPrefs, unreadCount } from '@/server/domain';
import { orgModuleFlags } from '@/server/entitlements';
import { integrationAvailability } from '@/server/integrations';

/** The signed-in person, active org, memberships, unread count, module + integration flags. */
export const GET = apiRoute(async ({ ctx, context }) => {
  const [unread, modules, integrations, runningTimer, prefs] = await Promise.all([
    unreadCount(ctx),
    orgModuleFlags(ctx.orgId),
    integrationAvailability(ctx),
    getRunningTimer(ctx),
    getUserPrefs(ctx),
  ]);
  return {
    user: context.user,
    org: context.org,
    orgRole: context.orgRole,
    orgs: context.orgs,
    unread,
    modules,
    integrations,
    runningTimer,
    prefs,
  };
});
