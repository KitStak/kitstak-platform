import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { WarehousesPage } from '@/components/facility/warehouses/warehouses-page';
import { HydrationStallNotice, ServerPermsProvider } from '@/components/facility/facility-shared';
import { requirePagePermission } from '@/server/auth/permissions';

export const metadata: Metadata = { title: 'Warehouse' };

/** Server-side gate: roles without view permission land on /forbidden instead of a spinning grid. */
async function Gated() {
  const grant = await requirePagePermission(
    ['settings.warehouse.view', 'inventory.inventory_by_location.view'],
    '/settings/warehouses',
  );
  return (
    <ServerPermsProvider keys={[...grant.permissions]}>
      <WarehousesPage />
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
