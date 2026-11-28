import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Export' };

export default function Page() {
  return <PhasePage id="export" path="/export" />;
}
