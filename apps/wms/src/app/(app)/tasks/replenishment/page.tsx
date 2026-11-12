import type { Metadata } from 'next';
import { Suspense } from 'react';
import { JobsPageSkeleton } from '@/components/jobs/jobs-page-skeleton';
import { TasksListPage } from '@/components/tasks/tasks-list-page';

export const metadata: Metadata = { title: 'Replenishment tasks' };

export default function Page() {
  return (
    <Suspense
      fallback={
        <JobsPageSkeleton title="Task details" chip={{ label: 'Job status', value: 'Pending, Started' }} />
      }
    >
      <TasksListPage kind="replenishment" />
    </Suspense>
  );
}
