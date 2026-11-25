import 'server-only';
import { AppShell } from './app-shell';
import type { ShellContextValue } from './shell-context';
import { getBadges, pulseAccessFor, toDomainContext } from '@/server/domain';
import { orgModuleFlags } from '@/server/entitlements';
import { appUrls } from '@/server/env';
import { integrationAvailability } from '@/server/integrations';
import { getPlanView, pulseBillingLink } from '@/server/plan';
import type { PulseContext } from '@/server/session';

/**
 * Everything the signed-in app shell needs: the entitlement gate, the person's Pulse role and
 * money rights, sibling app flags and URLs. Shared by the (app) layout and the root not-found
 * page, so a 404 keeps the shell. Navigation badges (`shellContext.badges`) are filled here too.
 */
export async function loadShell(context: PulseContext) {
  const ctx = toDomainContext(context);
  const [plan, modules, integrations, access] = await Promise.all([
    getPlanView({ orgId: context.org.id, userId: context.user.id, role: context.org.roleString }),
    orgModuleFlags(context.org.id),
    integrationAvailability(ctx),
    pulseAccessFor(ctx),
  ]);
  // Not in the plan: the lock screen. View only (trial over, payment late, paused, plan ended)
  // still opens the app, with the banner on top; the server refuses every change.
  const entitled = plan.access !== 'locked';
  const urls = appUrls();
  // Counts for the Jobs entry and the bell. Never blocks the shell: a failed read shows no badge.
  const counts = entitled && access.role !== 'none' ? await getBadges(ctx).catch(() => null) : null;
  const shellContext: ShellContextValue = {
    user: context.user,
    org: context.org,
    orgRole: context.orgRole,
    orgs: context.orgs,
    pulseRole: access.role,
    seesMoney: access.seesMoney,
    seesWages: access.seesWages,
    appUrls: urls,
    modules: { ...modules, pulse: entitled },
    integrations,
    // One separate warehouse per organization: any org may hold WMS; the entitlement flags
    // drive the switcher, so nothing is "not in plan".
    notInPlan: [],
    // Plan state per app (Trial, Active, Payment due, View only, Not in your plan, Included).
    // A row that is not in the plan opens the plan picker with that app turned on.
    planBadges: plan.badges,
    addHrefs: {
      crm: pulseBillingLink({ to: 'add', product: 'crm' }),
      wms: pulseBillingLink({ to: 'add', product: 'wms' }),
      projects: pulseBillingLink({ to: 'add', product: 'projects' }),
      pulse: pulseBillingLink({ to: 'add', product: 'pulse' }),
    },
    plan: { access: plan.access === 'read_only' ? 'read_only' : 'full', notice: plan.notice },
    badges: counts ? { jobsAtRisk: counts.jobsAtRisk, openAlerts: counts.openAlerts } : undefined,
  };
  return { ctx, entitled, plan, access, urls, shellContext };
}

/** The signed-in shell around arbitrary content. */
export async function ShellFrame({ context, children }: { readonly context: PulseContext; readonly children: React.ReactNode }) {
  const shell = await loadShell(context);
  return <AppShell context={shell.shellContext}>{children}</AppShell>;
}
