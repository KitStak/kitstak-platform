import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { HospitalLocationsPage } from '@/components/packing/hospital-locations-page';

export const metadata: Metadata = { title: 'Hospital locations' };

/** Hospital locations: stock moved there by Report Issue, with resolve / move-back actions. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <HospitalLocationsPage />
    </Suspense>
  );
}
