import type { Metadata } from 'next';
import { NewJobPage } from '@/features/jobs';

export const metadata: Metadata = { title: 'New job' };

export default function Page() {
  return <NewJobPage />;
}
