import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { ShipmentPackagesPage } from '@/components/facility/shipment-packages/shipment-packages-page';
import { HydrationStallNotice, ServerPermsProvider } from '@/components/facility/facility-shared';
import { requirePagePermission } from '@/server/auth/permissions';

export const metadata: Metadata = { title: 'Shipment packages' };

/** Server-side gate: roles without view permission land on /forbidden instead of a spinning grid. */
async function Gated() {
  const grant = await requirePagePermission(
    ['settings.shipment_packages.view', 'inventory.inventory_by_location.view'],
    '/settings/shipment-packages',
  );
  return (
    <ServerPermsProvider keys={[...grant.permissions]}>
      <ShipmentPackagesPage />
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
