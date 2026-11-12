import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { CompanyPage } from '@/components/admin/company/company-page';
import { requirePagePermission } from '@/server/auth/permissions';

export const metadata: Metadata = { title: 'Company Settings' };

async function Guard() {
  await requirePagePermission('settings.company_settings.view', '/settings/company');
  return <CompanyPage />;
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Guard />
    </Suspense>
  );
}
