import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Time' };

export default function Page() {
  return <PhasePage id="time" path="/time" />;
}
