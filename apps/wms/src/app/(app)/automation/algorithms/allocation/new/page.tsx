import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { AlgorithmEditor } from '@/components/automation/algorithms/algorithm-editor';
import { requirePagePermission } from '@/server/auth/permissions';

export const metadata: Metadata = { title: 'Create Allocation Algorithm' };

/** Server-side gate: roles without create permission land on /forbidden (the API also rejects the save). */
async function Gated() {
  await requirePagePermission('automation.algorithms.create', '/automation/algorithms/allocation/new');
  return <AlgorithmEditor slug="allocation" id={null} />;
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Gated />
    </Suspense>
  );
}
