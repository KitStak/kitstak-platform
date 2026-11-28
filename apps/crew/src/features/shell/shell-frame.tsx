import 'server-only';
import { AppShell } from './app-shell';
import type { ShellContextValue } from './shell-context';
import { crewAccessFor, type CrewAccess } from '@/server/domain/access';
import { toDomainContext } from '@/server/domain/_shared';
import { orgCrewAccess, orgSiblingFlags } from '@/server/entitlements';
import { appUrls } from '@/server/env';
import type { CrewContext } from '@/server/session';

export interface LoadedShell {
  /** False when the workspace is not in the preview: the layout shows the locked screen (SPEC 3.4). */
  readonly entitled: boolean;
  readonly access: CrewAccess;
  readonly urls: ReturnType<typeof appUrls>;
  readonly shellContext: ShellContextValue;
}

/**
 * Everything the signed in shell needs: the preview gate, the person's Crew access and sibling
 * flags and URLs. Shared by the (app) layout and the root not-found page, so a 404 keeps the shell.
 */
export async function loadShell(context: CrewContext): Promise<LoadedShell> {
  const ctx = toDomainContext(context);
  const [gate, modules] = await Promise.all([orgCrewAccess(context.org), orgSiblingFlags(context.org.id)]);
  const entitled = gate !== 'locked';
  // A locked workspace never reads crew tables.
  const access = entitled ? await crewAccessFor(ctx) : { role: 'none' as const, siteIds: null, canSeePay: false, canSeePrivate: false, source: 'org' as const, linkedPersonId: null };
  const urls = appUrls();
  const shellContext: ShellContextValue = {
    user: context.user,
    org: context.org,
    orgRole: context.orgRole,
    orgs: context.orgs,
    crewRole: access.role,
    canSeePay: access.canSeePay,
    linkedPersonId: access.linkedPersonId,
    appUrls: urls,
    modules,
  };
  return { entitled, access, urls, shellContext };
}

/** The signed in shell around arbitrary content. */
export async function ShellFrame({ context, children }: { readonly context: CrewContext; readonly children: React.ReactNode }) {
  const shell = await loadShell(context);
  return <AppShell context={shell.shellContext}>{children}</AppShell>;
}
