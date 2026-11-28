import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Shift templates' };

export default function Page() {
  return <PhasePage id="schedule-templates" path="/schedule/templates" />;
}
