import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Attendance' };

export default function Page() {
  return <PhasePage id="attendance" path="/attendance" />;
}
