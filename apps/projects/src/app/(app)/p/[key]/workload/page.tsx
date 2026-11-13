import type { Metadata } from 'next';
import { WorkloadView } from '@/features/workload';

export const metadata: Metadata = { title: 'Workload' };

export default function Page() {
  return <WorkloadView />;
}
