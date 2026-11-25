import { unstable_rethrow } from 'next/navigation';
import type { ProductId } from '@kitstak/billing/catalog';
import { getOrgModuleStates } from '@/server/entitlements';
import { getInviteViewOnce } from '@/server/signup';
import { InviteHero, SignInHero } from '../../../_components/auth-hero';

/**
 * The panel beside an invite: the organization, who sent the invite and the role in plain words.
 * An invited person never pays, so no price is shown. A link that does not work, or an invite that
 * was used or ran out, gets the plain sign in panel.
 */
export default async function Hero({ params }: { readonly params: Promise<{ invitationId: string }> }) {
  const { invitationId } = await params;
  const view = await getInviteViewOnce(invitationId);
  if (!view || view.status !== 'pending') return <SignInHero />;
  // The apps the team has. A billing only invite opens none of them, so none is shown.
  let products: readonly ProductId[] = [];
  if (view.roleKey !== 'billing') {
    try {
      const { modules } = await getOrgModuleStates(view.orgId);
      products = modules.filter((state) => state.badge !== 'not_in_plan').map((state) => state.module);
    } catch (error: unknown) {
      // Next's own signals (a redirect, "this page reads the request") are not failures: hand them back.
      unstable_rethrow(error);
      console.error('[portal] invite panel: plan read failed', error instanceof Error ? error.message : error);
    }
  }
  return <InviteHero orgName={view.orgName} inviterName={view.inviterName} roleKey={view.roleKey} products={products} />;
}
