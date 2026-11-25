import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { SettingsHub } from '@/components/admin/settings-hub';
import { settingsHubPermissions, settingsHubSections } from '@/components/admin/settings-hub-data';
import { PlanSummaryCard } from '@kitstak/ui/plan-summary';
import { getPlatformDb } from '@/server/api/db';
import { getPlanSummary } from '@/server/auth/plan';
import { requirePagePermission } from '@/server/auth/permissions';
import { isPermissionKey } from '@/server/auth/permission-catalog';

export const metadata: Metadata = { title: 'Settings' };

async function Hub() {
  const auth = await requirePagePermission(settingsHubPermissions().filter(isPermissionKey), '/settings');
  // The "Plan" card (docs/billing/SPEC.md section 9.5): the plan badge, the next charge line and
  // warehouses in use, with one link to the Portal. In the WMS "billing" means 3PL client billing,
  // so this area is called "Plan". A read failure hides the card, it never breaks Settings.
  const plan = await getPlanSummary(await getPlatformDb(), { orgId: auth.user.orgId, userId: auth.user.id }).catch(
    () => null,
  );
  return (
    <SettingsHub
      sections={settingsHubSections(auth.permissions as ReadonlySet<string>)}
      planCard={plan ? <PlanSummaryCard summary={plan} title="Plan" /> : null}
    />
  );
}

/** `/settings` is a hub listing every section the user can open (round 4; was a redirect to Users). */
export default function SettingsIndexPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Hub />
    </Suspense>
  );
}
