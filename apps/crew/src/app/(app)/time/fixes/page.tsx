import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Needs a fix' };

export default function Page() {
  return <PhasePage id="time-fixes" path="/time/fixes" />;
}
