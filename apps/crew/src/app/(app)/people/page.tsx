import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'People' };

export default function Page() {
  return <PhasePage id="people" path="/people" />;
}
