import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { KitComponentsPage } from '@/components/kits/kit-components-page';

export const metadata: Metadata = { title: 'Kit Component Inventory Availability' };

/** Kit Component Inventory Availability report (live). Grid state lives in the URL, so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <KitComponentsPage />
    </Suspense>
  );
}
