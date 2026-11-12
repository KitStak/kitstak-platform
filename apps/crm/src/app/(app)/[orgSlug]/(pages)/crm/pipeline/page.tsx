import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PipelinePage } from '@/features/crm/pipeline/pipeline-page';

export const metadata: Metadata = { title: 'Pipeline' };

export default function Page() {
  return (
    <Suspense>
      <PipelinePage />
    </Suspense>
  );
}
