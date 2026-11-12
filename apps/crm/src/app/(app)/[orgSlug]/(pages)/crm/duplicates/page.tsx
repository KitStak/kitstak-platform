import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DuplicatesPage } from '@/features/crm/duplicates/duplicates-page';

export const metadata: Metadata = { title: 'Duplicates' };

export default function Page() {
  return (
    <Suspense>
      <DuplicatesPage />
    </Suspense>
  );
}
