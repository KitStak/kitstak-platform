import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DetailPageSkeleton } from '@/components/layout/shell-skeleton';
import { LocationDetailPage } from '@/components/locations/location-detail-page';
import { HydrationStallNotice } from '@/components/facility/facility-shared';
import { requirePagePermission } from '@/server/auth/permissions';

export const metadata: Metadata = { title: 'Location details' };

async function Detail({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePagePermission(
    ['settings.locations.view', 'inventory.inventory_by_location.view'],
    `/locations/${id}`,
  );
  return (
    <>
      <HydrationStallNotice />
      <LocationDetailPage id={id} />
    </>
  );
}

export default function Page({ params }: { readonly params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <>
          <DetailPageSkeleton />
          <HydrationStallNotice />
        </>
      }
    >
      <Detail params={params} />
    </Suspense>
  );
}
