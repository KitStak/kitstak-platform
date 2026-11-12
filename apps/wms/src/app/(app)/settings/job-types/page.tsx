import type { Metadata } from 'next';
import { Suspense } from 'react';
import { JobsPageSkeleton } from '@/components/jobs/jobs-page-skeleton';
import { JobTypesPage } from '@/components/job-types/job-types-page';
import { requirePagePermission } from '@/server/auth/permissions';

export const metadata: Metadata = { title: 'Job Types' };

// Same gate as every other settings page: roles without Job Types · View go to /forbidden.
async function Guard() {
  await requirePagePermission('settings.job_types.view', '/settings/job-types');
  return <JobTypesPage />;
}

export default function Page() {
  return (
    <Suspense fallback={<JobsPageSkeleton title="Job Types" />}>
      <Guard />
    </Suspense>
  );
}
