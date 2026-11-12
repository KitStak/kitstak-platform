import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { LocationsPage } from '@/components/locations/locations-page';
import { HydrationStallNotice, ServerPermsProvider } from '@/components/facility/facility-shared';
import { requirePagePermission } from '@/server/auth/permissions';

export const metadata: Metadata = { title: 'Locations' };

/** Server-side gate: roles without view permission land on /forbidden instead of a spinning grid. */
async function Gated() {
  const grant = await requirePagePermission(
    ['settings.locations.view', 'inventory.inventory_by_location.view'],
    '/locations',
  );
  return (
    <ServerPermsProvider keys={[...grant.permissions]}>
      <LocationsPage />
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
