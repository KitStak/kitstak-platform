/**
 * Page helper for server components:
 *   const page = await pulsePage('/jobs', 'jobs');
 *   if (page.blocked) return <PageBlocked />;
 * Redirects to sign-in when signed out (returning to `returnTo`), builds the DomainContext and
 * resolves the person's Pulse role, so a page can hide what the role may not do. The domain
 * layer re-checks every read and write.
 */
import 'server-only';
import { pulseAccessFor, type PulseAccess } from '@/server/domain/access';
import { toDomainContext, type DomainContext } from '@/server/domain/_shared';
import { integrationAvailability, type IntegrationAvailability } from '@/server/integrations';
import { requirePageContext, type PulseContext } from '@/server/session';
import { NAV, type NavId } from '@/lib/nav';
import { canPulse, type PulseAction } from '@/lib/permissions';

export async function pageContext(returnTo: string): Promise<{ ctx: DomainContext; context: PulseContext }> {
  const context = await requirePageContext(returnTo);
  return { ctx: toDomainContext(context), context };
}

export interface PulsePage {
  readonly ctx: DomainContext;
  readonly context: PulseContext;
  readonly access: PulseAccess;
  /** True when this person's role does not get this page (for example a supervisor on Profit). */
  readonly blocked: boolean;
  readonly can: (action: PulseAction) => boolean;
  /** Which sibling apps can be read for this org. Loaded on first use. */
  readonly integrations: () => Promise<IntegrationAvailability>;
}

export async function pulsePage(returnTo: string, nav?: NavId): Promise<PulsePage> {
  const { ctx, context } = await pageContext(returnTo);
  const access = await pulseAccessFor(ctx);
  const entry = nav ? NAV.find((item) => item.id === nav) : undefined;
  const blocked = access.role === 'none' || Boolean(entry?.hiddenFor?.includes(access.role));
  let integrations: Promise<IntegrationAvailability> | undefined;
  return {
    ctx,
    context,
    access,
    blocked,
    can: (action) => canPulse(access.role, action),
    integrations: () => (integrations ??= integrationAvailability(ctx)),
  };
}
