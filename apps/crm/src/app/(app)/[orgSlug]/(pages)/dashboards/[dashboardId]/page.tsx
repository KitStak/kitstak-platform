import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { DashboardPage } from '@/features/dashboards/dashboard-page';
import { DashboardSkeleton } from '@/features/dashboards/components/dashboard-skeleton';

export const metadata: Metadata = { title: 'Dashboard' };

interface PageProps {
  readonly params: Promise<{ orgSlug: string; dashboardId: string }>;
}

const idSchema = z.string().uuid();

export default async function Page({ params }: PageProps) {
  const { dashboardId } = await params;
  if (!idSchema.safeParse(dashboardId).success) notFound();
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardPage dashboardId={dashboardId} />
    </Suspense>
  );
}
