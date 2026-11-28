import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Import' };

export default function Page() {
  return <PhasePage id="import" path="/import" />;
}
