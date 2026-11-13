import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CyclesView } from '@/features/projects/cycles-view';

export const metadata: Metadata = { title: 'Cycles' };

export default function Page() {
  return (
    <Suspense>
      <CyclesView />
    </Suspense>
  );
}
