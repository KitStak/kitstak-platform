import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { AlgorithmTypePicker } from '@/components/automation/algorithms/algorithm-type-picker';

export const metadata: Metadata = { title: 'Algorithms' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AlgorithmTypePicker />
    </Suspense>
  );
}
