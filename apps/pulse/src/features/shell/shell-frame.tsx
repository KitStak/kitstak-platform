import 'server-only';
import { AppShell } from './app-shell';
import type { ShellContextValue } from './shell-context';
import { pulseAccessFor, toDomainContext } from '@/server/domain';
import { orgHasPulseModule, orgModuleFlags } from '@/server/entitlements';
import { appUrls } from '@/server/env';
import { integrationAvailability } from '@/server/integrations';
import type { PulseContext } from '@/server/session';

/**
 * Everything the signed-in app shell needs: the entitlement gate, the person's Pulse role and
 * money rights, sibling app flags and URLs. Shared by the (app) layout and the root not-found
 * page, so a 404 keeps the shell. Navigation badges (`shellContext.badges`) are filled here too.
 */
export async function loadShell(context: PulseContext) {
  const ctx = toDomainContext(context);
  const [entitled, modules, integrations, access] = await Promise.all([
    orgHasPulseModule(context.org.id),
    orgModuleFlags(context.org.id),
    integrationAvailability(ctx),
    pulseAccessFor(ctx),
  ]);
  const urls = appUrls();
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
  };
  return { ctx, entitled, access, urls, shellContext };
}

/** The signed-in shell around arbitrary content. */
export async function ShellFrame({ context, children }: { readonly context: PulseContext; readonly children: React.ReactNode }) {
  const shell = await loadShell(context);
  return <AppShell context={shell.shellContext}>{children}</AppShell>;
}
