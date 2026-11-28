import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'My work' };

export default function Page() {
  return <PhasePage id="me" path="/me" />;
}
