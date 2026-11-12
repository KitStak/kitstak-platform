import type { Metadata } from 'next';
import { DashboardsList } from '@/features/dashboards/dashboards-list';

export const metadata: Metadata = { title: 'Dashboards' };

export default function Page() {
  return <DashboardsList />;
}
