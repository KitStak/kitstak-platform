import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ListingsPage } from '@/components/products/listings-page';
import { ListPageSkeleton } from '@/components/products/page-skeletons';

export const metadata: Metadata = { title: 'Product Listings' };

export default function Page() {
  return (
    <Suspense fallback={<ListPageSkeleton title="Product Listings" />}>
      <ListingsPage />
    </Suspense>
  );
}
