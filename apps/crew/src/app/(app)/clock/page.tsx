import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Phone clock' };

export default function Page() {
  return <PhasePage id="clock" path="/clock" />;
}
