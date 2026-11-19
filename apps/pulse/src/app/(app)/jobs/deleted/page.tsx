import type { Metadata } from 'next';
import { DeletedJobsPage } from '@/features/jobs';

export const metadata: Metadata = { title: 'Deleted jobs' };

export default function Page() {
  return <DeletedJobsPage />;
}
