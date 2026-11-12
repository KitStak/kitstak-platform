import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ProductsPage } from '@/components/products/products-page';
import { ListPageSkeleton } from '@/components/products/page-skeletons';

export const metadata: Metadata = { title: 'Products' };

export default function Page() {
  return (
    <Suspense fallback={<ListPageSkeleton title="Products" />}>
      <ProductsPage />
    </Suspense>
  );
}
