/**
 * Page helper for server components:
 *   const page = await ledgerPage('/invoices', 'invoices');
 *   if (page.blocked) return <PageBlocked />;
 * Redirects to sign in when signed out (returning to `returnTo`), builds the DomainContext and
 * resolves the person's Ledger role, so a page can hide what the role may not do. The domain
 * layer re-checks every read and write.
 */
import 'server-only';
import type { LedgerAccess } from '@kitstak/ledger-bridge/types';
import { ledgerAccessFor } from '@/server/domain/access';
import { toDomainContext, type DomainContext } from '@/server/domain/_shared';
import { requirePageContext, type LedgerContext } from '@/server/session';
import { NAV, canSee, type NavId } from '@/lib/nav';
import type { LedgerRight } from '@/lib/permissions';

export interface LedgerPage {
  readonly ctx: DomainContext;
  readonly context: LedgerContext;
  readonly access: LedgerAccess;
  /** True when this person's role does not get this page (for example a submitter on Invoices). */
  readonly blocked: boolean;
  readonly can: (right: LedgerRight) => boolean;
}

export async function ledgerPage(returnTo: string, nav?: NavId): Promise<LedgerPage> {
  const context = await requirePageContext(returnTo);
  const ctx = toDomainContext(context);
  const access = await ledgerAccessFor(ctx);
  const entry = nav ? NAV.find((item) => item.id === nav) : undefined;
  const blocked = access.role === 'none' || Boolean(entry && !canSee(entry, access.rights));
  return { ctx, context, access, blocked, can: (right) => access.rights.includes(right) };
}
