import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Today' };

export default function Page() {
  return <PhasePage id="today" path="/today" />;
}
