import 'server-only';
import { AppShell } from './app-shell';
import type { ShellContextValue } from './shell-context';
import { canClaimLedger, ensureLedgerSetup, ledgerAccessFor, toDomainContext } from '@/server/domain';
import { orgLedgerAccess, orgModuleFlags } from '@/server/entitlements';
import { appUrls } from '@/server/env';
import type { LedgerContext } from '@/server/session';

/**
 * Everything the signed in shell needs: the preview gate (SPEC 3.1), the person's Ledger role
 * and rights, the claim step, sibling app flags and URLs. Shared by the (app) layout and the root
 * not found page, so a 404 keeps the shell. Makes the org's defaults on the first read (SPEC 4).
 */
export async function loadShell(context: LedgerContext) {
  const ctx = toDomainContext(context);
  const gate = orgLedgerAccess(context.org);
  const urls = appUrls();
  const modules = await orgModuleFlags(context.org.id);
  if (gate === 'locked') {
    return { ctx, gate, urls, access: null, claimable: false, shellContext: null, modules };
  }
  await ensureLedgerSetup(context.org.id);
  const [access, claimable] = await Promise.all([ledgerAccessFor(ctx), canClaimLedger(ctx)]);
  const shellContext: ShellContextValue = {
    user: context.user,
    org: context.org,
    orgRole: context.orgRole,
    orgs: context.orgs,
    ledgerRole: access.role,
    rights: access.rights,
    appUrls: urls,
    modules,
  };
  return { ctx, gate, urls, access, claimable, shellContext, modules };
}

/** The signed in shell around arbitrary content (falls back to the bare content when locked). */
export async function ShellFrame({ context, children }: { readonly context: LedgerContext; readonly children: React.ReactNode }) {
  const shell = await loadShell(context);
  if (!shell.shellContext) return <>{children}</>;
  return <AppShell context={shell.shellContext}>{children}</AppShell>;
}
