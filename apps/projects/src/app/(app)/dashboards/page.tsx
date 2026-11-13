import type { Metadata } from 'next';
import { DashboardsPage } from '@/features/dashboards';

export const metadata: Metadata = { title: 'Dashboards' };

const str = (value: string | string[] | undefined): string | undefined => (typeof value === 'string' && value ? value : undefined);

export default async function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <DashboardsPage project={str(params.project)} space={str(params.space)} weeks={str(params.weeks)} />;
}
