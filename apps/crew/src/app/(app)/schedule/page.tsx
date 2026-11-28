import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Schedule' };

export default function Page() {
  return <PhasePage id="schedule" path="/schedule" />;
}
