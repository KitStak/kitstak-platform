import { PlanSummaryCard } from '@kitstak/ui/plan-summary';
import { getUserPrefs, integrationLinkSummary, listSpaces } from '@/server/domain';
import { pageContext } from '@/server/page';
import { getPlanSummary } from '@/server/plan';
import { SettingsView } from './settings-view';

export async function SettingsPage() {
  const { ctx, context } = await pageContext('/settings');
  const [spaces, prefs, summary, plan] = await Promise.all([
    listSpaces(ctx),
    getUserPrefs(ctx),
    integrationLinkSummary(ctx),
    // The "Plan and payment" row (docs/billing/SPEC.md section 9.5). A read failure hides the row,
    // it never breaks Settings.
    getPlanSummary({ orgId: context.org.id, userId: context.user.id, role: context.org.roleString }).catch(() => null),
  ]);
  return (
    <SettingsView
      spaces={spaces}
      notificationPrefs={prefs.notifications ?? {}}
      emailDigest={prefs.emailDigest ?? 'instant'}
      integrationSummary={summary}
      planCard={plan ? <PlanSummaryCard summary={plan} headingLevel={3} /> : null}
    />
  );
}
