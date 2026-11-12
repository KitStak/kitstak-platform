import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { LpTypesPage } from '@/components/facility/lp-types/lp-types-page';
import { HydrationStallNotice, ServerPermsProvider } from '@/components/facility/facility-shared';
import { requirePagePermission } from '@/server/auth/permissions';

export const metadata: Metadata = { title: 'LP types' };

/** Server-side gate: roles without view permission land on /forbidden instead of a spinning grid. */
async function Gated() {
  const grant = await requirePagePermission(
    [
      'settings.lp_types.view',
      'settings.lp_numbers.view',
      'settings.locations.view',
      'inventory.inventory_by_location.view',
    ],
    '/settings/lp-types',
  );
  return (
    <ServerPermsProvider keys={[...grant.permissions]}>
      <LpTypesPage />
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
