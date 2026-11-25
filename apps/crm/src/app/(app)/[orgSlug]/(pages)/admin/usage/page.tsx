import type { Metadata } from 'next';
import { PlanSummaryCard } from '@kitstak/ui/plan-summary';
import { UsageSection } from '@/features/admin/sections/usage-section';
import { getPageOrgMembership } from '@/server/auth/session';
import { getPlanSummary } from '@/server/plan';

export const metadata: Metadata = { title: 'Admin · Usage & billing' };

/**
 * Usage and the "Plan and payment" row (docs/billing/SPEC.md section 9.5): the plan badge, the next
 * charge line and seats in use, with one link to billing in the Portal. The row is rendered on the
 * server from `@kitstak/billing`, so it says the same as the Portal and the other apps.
 */
export default async function Page({ params }: { readonly params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const result = await getPageOrgMembership(orgSlug);
  // The org layout has already sent signed out visitors and non members away.
  const summary = result
    ? await getPlanSummary({
        orgId: result.membership.organization.id,
        userId: result.session.user.id,
        role: result.membership.roleString,
      }).catch(() => null)
    : null;
  return <UsageSection planCard={summary ? <PlanSummaryCard summary={summary} /> : null} />;
}
