import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { CodeGenerationPage } from '@/components/admin/data-setup/code-generation-page';
import { requirePagePermission } from '@/server/auth/permissions';

export const metadata: Metadata = { title: 'Auto Code Generation' };

async function Guard() {
  await requirePagePermission('settings.data_setup.view', '/settings/data-setup/code-generation');
  return <CodeGenerationPage />;
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Guard />
    </Suspense>
  );
}
