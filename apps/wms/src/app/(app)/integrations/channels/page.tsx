import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { IntegrationCatalogPage } from '@/components/integrations/catalog/integration-catalog-page';

export const metadata: Metadata = { title: 'Channel Integrations' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <IntegrationCatalogPage kind="channel" />
    </Suspense>
  );
}
