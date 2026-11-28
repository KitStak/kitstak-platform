import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Shift requests' };

export default function Page() {
  return <PhasePage id="schedule-requests" path="/schedule/requests" />;
}
