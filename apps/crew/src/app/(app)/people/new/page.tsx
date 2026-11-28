import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Add a person' };

export default function Page() {
  return <PhasePage id="people-new" path="/people/new" />;
}
