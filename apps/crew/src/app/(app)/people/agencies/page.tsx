import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Agencies' };

export default function Page() {
  return <PhasePage id="agencies" path="/people/agencies" />;
}
