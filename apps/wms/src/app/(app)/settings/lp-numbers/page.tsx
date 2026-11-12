import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { LpNumbersPage } from '@/components/facility/lp-numbers/lp-numbers-page';
import { HydrationStallNotice, ServerPermsProvider } from '@/components/facility/facility-shared';
import { requirePagePermission } from '@/server/auth/permissions';

export const metadata: Metadata = { title: 'LP numbers' };

/** Server-side gate: roles without view permission land on /forbidden instead of a spinning grid. */
async function Gated() {
  const grant = await requirePagePermission(
    ['settings.lp_numbers.view', 'inventory.inventory_by_location.view'],
    '/settings/lp-numbers',
  );
  return (
    <ServerPermsProvider keys={[...grant.permissions]}>
      <LpNumbersPage />
    </ServerPermsProvider>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <>
          <PageSkeleton />
          <HydrationStallNotice />
        </>
      }
    >
      <Gated />
    </Suspense>
  );
}
