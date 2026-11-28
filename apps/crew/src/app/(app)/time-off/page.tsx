import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Time off' };

export default function Page() {
  return <PhasePage id="time-off" path="/time-off" />;
}
